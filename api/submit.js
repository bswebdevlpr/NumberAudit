import { flow } from '../src/flow.js'
import { collectProject } from '../src/collect.js'
import { submitPlan, workerIndex, TOOL_TITLE_PREFIX } from '../src/task.js'
import { tight, loose } from '../src/gate.js'
import { DEMO_PROJECT_ID, json, readBody, keysReady, userFacing } from './_lib.js'

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
const LIMITS = { subtasks: 20, title: 120, contents: 8000, line: 400 }

/**
 * 🔑 **인용만 검증하면 인용 사이가 뚫린다.**
 *    한동안 `인용: "…"` 만 원문에 대조했다. 그런데 업무 본문은 클라이언트가 통째로 보내는 문자열이라,
 *    **진짜 인용 한 줄만 끼워 넣으면 나머지 8,000자는 아무 내용이나 올릴 수 있었다.**
 *    인용은 공개된 `snapshot.json` 에서 그냥 집어 올 수 있으니 진입 장벽도 없다.
 *    실제로 피싱 문구 + 진짜 인용 한 줄로 검증을 통과시켜 봤다.
 *
 *    그래서 **줄 모양까지 검사한다.** 이 도구가 내는 본문은 기계가 만든 고정 서식이다(`src/task.js`).
 *    그 서식에 없는 줄은 사람이 손으로 넣은 것이고, 손으로 넣은 것은 안 받는다.
 */
const LINE_SHAPES = [
  /^$/,                                    // 빈 줄
  /^---$/,                                 // 구분선
  /^지표: /,
  /^■ /,
  /^- /,                                   // 항목 — 바로 다음 줄이 인용이어야 한다
  /^ {2}인용: "/,
  /^ {2}↑ /,                                // 조건이 달라 견주지 않았다는 안내
  /^수치 감사 도구가 만든 업무입니다/,
  /^숫자가 틀렸다는 뜻이 아니라/,
]

/** 링크는 이 도구가 한 번도 안 만든다. 본문에 있으면 손으로 넣은 것이다. */
const LINKISH = /(:\/\/|www\.|@[\w-]+\.[a-z]{2,})/i

/** 본문이 **도구가 내는 서식 그대로인지** 본다. 인용 대조와 별개다. */
export function checkShape(contents) {
  const lines = String(contents ?? '').split('\n')
  for (const [i, line] of lines.entries()) {
    if (line.length > LIMITS.line) return `${i + 1}번째 줄이 ${LIMITS.line}자를 넘습니다.`
    if (!LINE_SHAPES.some((re) => re.test(line))) return `${i + 1}번째 줄이 이 도구가 만드는 서식이 아닙니다.`
    // 항목 줄은 **반드시 인용을 데리고 온다.** 이게 없으면 인용 없는 서술을 줄줄이 넣을 수 있다.
    if (/^- /.test(line) && !/^ {2}인용: "/.test(lines[i + 1] ?? '')) {
      return `${i + 1}번째 항목에 인용이 붙어 있지 않습니다.`
    }
  }
  if (LINKISH.test(contents)) return '본문에 링크가 들어 있습니다. 이 도구는 링크를 만들지 않습니다.'
  return null
}

/** 업무 속성도 클라이언트가 보낸다. 도구가 실제로 쓰는 값만 받는다. */
const ALLOWED_STATUS = new Set(['request'])
const ALLOWED_PRIORITY = new Set(['high', 'normal'])

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
  if (!plan?.task?.title || !Array.isArray(plan.subtasks)) return { error: '보낼 업무 내용이 없습니다.' }
  if (!String(plan.task.title).startsWith(TOOL_TITLE_PREFIX)) {
    return { error: `제목은 ${TOOL_TITLE_PREFIX} 로 시작해야 합니다.` }
  }
  if (plan.subtasks.length > LIMITS.subtasks) {
    return { error: `하위업무는 ${LIMITS.subtasks}건까지입니다 (지금 ${plan.subtasks.length}건).` }
  }
  if (LINKISH.test(plan.task.title)) return { error: '제목에 링크가 들어 있습니다.' }
  if (!ALLOWED_STATUS.has(plan.task.status)) return { error: '업무 상태가 이 도구가 쓰는 값이 아닙니다.' }
  if (!ALLOWED_PRIORITY.has(plan.task.priority)) return { error: '우선순위가 이 도구가 쓰는 값이 아닙니다.' }
  if (!/^\d{8}$/.test(String(plan.task.endDate ?? ''))) return { error: '마감일 형식이 아닙니다.' }

  const parts = [
    { where: '업무 본문', title: plan.task.title, contents: plan.task.contents },
    ...plan.subtasks.map((s, i) => ({ where: `하위업무 ${i + 1}`, title: s?.title, contents: s?.contents })),
  ]

  let total = 0
  for (const p of parts) {
    if (String(p.title ?? '').length > LIMITS.title) return { error: `${p.where} 제목이 ${LIMITS.title}자를 넘습니다.` }
    if (String(p.contents ?? '').length > LIMITS.contents) return { error: `${p.where} 본문이 ${LIMITS.contents}자를 넘습니다.` }
    const shape = checkShape(p.contents)
    if (shape) return { error: `${p.where}: ${shape}` }
    const { quotes, unverified } = unverifiedQuotes(p.contents, docs)
    if (!quotes.length) return { error: `${p.where}에 인용이 없습니다.` }
    if (unverified.length) {
      return { error: `${p.where}에 원문에서 확인되지 않는 인용이 ${unverified.length}건 있습니다.`, detail: unverified }
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
  if (req.method !== 'POST') return json(res, 405, { error: 'POST 만 받습니다.' })
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

  let plan
  try { ({ plan } = await readBody(req)) }
  catch (e) { return json(res, e.tooLarge ? 413 : 400, { error: '요청이 너무 큽니다.' }) }
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
    return json(res, 502, { error: userFacing(e, '플로우에 등록하지 못했습니다.') })
  }
}
