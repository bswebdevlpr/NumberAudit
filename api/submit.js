import { flow } from '../src/flow.js'
import { collectProject } from '../src/collect.js'
import { submitPlan, workerIndex, TOOL_TITLE_PREFIX } from '../src/task.js'
import { tight, loose } from '../src/gate.js'
import { DEMO_PROJECT_ID, json, readBody, keysReady } from './_lib.js'

/**
 * 화면의 「플로우에 등록」이 실제로 업무를 만든다.
 *
 * 🔑 클라이언트가 보낸 몸통을 그대로 믿지 않는다.
 *    이 함수는 내 키로 쓰기 때문에, 검증 없이 받으면 **아무 내용이나 내 계정으로 올리는 통로**가 된다.
 *    본문에 적힌 인용이 **그 프로젝트 원문에 실재하는지** 게이트 ①(인용 실재)과 같은 대조로 다시 확인한다.
 *
 * ⚠️ 한 번 뚫렸던 자리다. 처음엔 `task.contents` 만 봤는데, 실제 내용의 대부분은 `subtasks[]` 에 있다.
 *    제목만 접두사를 맞추고 본문에 실재하는 인용 하나만 넣으면 하위업무로 아무거나 올릴 수 있었다.
 *    **검증은 보내는 것 전부에 건다.**
 */
const LIMITS = { subtasks: 20, title: 120, contents: 8000 }

/** 본문에 적힌 인용 중 어느 문서 원문에도 없는 것을 돌려준다. 게이트 ① 과 같은 대조다. */
export function unverifiedQuotes(contents, docs) {
  const quotes = [...String(contents ?? '').matchAll(/인용:\s*"([^"]+)"/g)].map((m) => m[1])
  const bodies = docs.map((d) => ({ t: tight(d.text), l: loose(d.text) }))
  return { quotes, unverified: quotes.filter((q) => !bodies.some((b) => b.t.includes(tight(q)) || b.l.includes(loose(q)))) }
}

/**
 * 보낼 몸통 전체를 검사한다. 업무 본문과 **모든 하위업무 본문**이 대상이다.
 * @returns {{error?: string, detail?: any, quotes?: number}}
 */
export function validatePlan(plan, docs) {
  if (!plan?.task?.title || !Array.isArray(plan.subtasks)) return { error: 'plan 이 없다' }
  if (!String(plan.task.title).startsWith(TOOL_TITLE_PREFIX)) {
    return { error: `제목은 ${TOOL_TITLE_PREFIX} 로 시작해야 한다` }
  }
  if (plan.subtasks.length > LIMITS.subtasks) {
    return { error: `하위업무는 ${LIMITS.subtasks}건까지다 (지금 ${plan.subtasks.length}건)` }
  }

  const parts = [
    { where: '업무 본문', title: plan.task.title, contents: plan.task.contents },
    ...plan.subtasks.map((s, i) => ({ where: `하위업무 ${i + 1}`, title: s?.title, contents: s?.contents })),
  ]

  let total = 0
  for (const p of parts) {
    if (String(p.title ?? '').length > LIMITS.title) return { error: `${p.where} 제목이 ${LIMITS.title}자를 넘는다` }
    if (String(p.contents ?? '').length > LIMITS.contents) return { error: `${p.where} 본문이 ${LIMITS.contents}자를 넘는다` }
    const { quotes, unverified } = unverifiedQuotes(p.contents, docs)
    if (!quotes.length) return { error: `${p.where}에 인용이 없다` }
    if (unverified.length) {
      return { error: `${p.where}에 원문에서 확인되지 않는 인용 ${unverified.length}건`, detail: unverified }
    }
    total += quotes.length
  }
  return { quotes: total }
}

/**
 * 🟠 쓰기 제한. 읽기(`try.js`)보다 쓰기가 위험한데 한동안 방어가 읽기에만 있었다.
 *    플로우에 삭제 API 가 없어 잘못 만든 업무를 코드로 지울 수 없다 — 그래서 여기서 막는다.
 *    다만 이 카운터도 **인스턴스 메모리**라 「하루 N회」가 아니라 「인스턴스당 N회」다. 알고 안 늘린 것이다.
 */
const DAILY = Number(process.env.SUBMIT_DAILY_BUDGET ?? 10)
const PER_IP_MS = Number(process.env.SUBMIT_PER_IP_MS ?? 30_000)
let day = new Date().toISOString().slice(0, 10)
let used = 0
const lastByIp = new Map()

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST 만 받는다' })
  const missing = keysReady()
  if (missing) return json(res, 503, { error: missing })

  const today = new Date().toISOString().slice(0, 10)
  if (today !== day) { day = today; used = 0 }
  if (used >= DAILY) {
    return json(res, 429, { error: `오늘 등록이 ${DAILY}건을 채웠습니다. 플로우에 삭제 API 가 없어 만든 업무를 되돌릴 수 없기 때문입니다.` })
  }
  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'local'
  const since = Date.now() - (lastByIp.get(ip) ?? 0)
  if (since < PER_IP_MS) {
    return json(res, 429, { error: `${Math.ceil((PER_IP_MS - since) / 1000)}초 뒤에 다시 눌러 주세요.` })
  }

  // 실패한 시도도 간격에 걸리게 한다 — 검증 자체가 플로우 읽기를 태운다
  lastByIp.set(ip, Date.now())

  const { plan } = await readBody(req)
  const docs = await collectProject(DEMO_PROJECT_ID)
  const v = validatePlan(plan, docs)
  if (v.error) return json(res, 400, { error: v.error, unverified: v.detail })

  used += 1
  try {
    // 담당자를 **여기서 정한다.** 계획이 가리킨 문서들의 글쓴이를 방금 읽은 원문에서 찾고,
    // 그 이름을 참여자 목록에 대조해 계정 id 를 얻는다. 클라이언트는 이름도 id 도 보내지 않는다.
    const participants = (await flow.listParticipants(DEMO_PROJECT_ID))?.participants ?? []
    const index = workerIndex(participants)
    const authors = [...new Set((plan.docIds ?? [])
      .map((id) => docs.find((d) => d.docId === id)?.author).filter(Boolean))]
    const name = authors.find((n) => index.get(n))
    const worker = name ? { name, userId: index.get(name) } : null
    const created = await submitPlan(flow, DEMO_PROJECT_ID, plan, { worker })
    return json(res, 200, { ...created, title: plan.task.title, verifiedQuotes: v.quotes })
  } catch (e) {
    used -= 1
    return json(res, 502, { error: String(e.message ?? e) })
  }
}
