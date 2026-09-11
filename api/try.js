import { json, readBody, keysReady, userFacing } from './_lib.js'

/**
 * 쓰는 사람이 **자기 글**로 파이프라인을 돌려 보는 자리.
 *
 * 플로우도 내 데이터도 거치지 않는다 — 붙여넣은 글 하나에 추출과 게이트를 건다.
 * ⚠️ 내 Gemini 한도를 쓴다(모델당 하루 20회). 그래서 세 겹으로 막는다 —
 *    입력 길이 · 같은 IP 의 짧은 간격 · 하루 총량. 막힐 때는 **사유를 그대로 말한다.**
 *
 * 🟠 다만 뒤의 둘은 **이 인스턴스의 메모리**에 있다. 서버리스는 인스턴스가 여러 개고 콜드스타트마다 초기화되므로
 *    실제로는 「하루 6회」가 아니라 「인스턴스당 6회」다. 진짜 방어선은 Gemini 자체 한도다.
 *    공유 저장소를 두면 정확해지지만 이 규모에 부품을 늘리지 않았다 — **알고 안 한 것이라 적어 둔다.**
 */
const { auditText } = await import('../src/audit.js')

/**
 * 🔑 **붙여넣기는 상위 모델로 돈다.** 프로젝트 감사(`api/audit.js`)가 빠른 모델로 고정된 이유는
 *    13문서 2회 호출이 상위 체인에서 23~105초라 함수 상한(60초)을 넘겼기 때문이다.
 *    여기는 **짧은 글 하나에 호출 1회**라 그 이유가 안 맞는다.
 *
 * 실측(2026-09-11): 빠른 모델은 「공지 초안에는 150ms로 개선이라고 적었습니다」를 **목표값으로 분류**해
 * 판정에서 통째로 빼 버렸다. 사용자가 자기 글로 확인하는 자리라 여기서 지면 도구가 안 도는 것처럼 보인다.
 */
const TRY_CHAIN = (process.env.TRY_GEMINI_MODEL ?? 'gemini-3.6-flash,gemini-3.5-flash,gemini-3.1-flash-lite')
  .split(',').map((s) => s.trim()).filter(Boolean)

/**
 * 🔑 비교군 — **저장된 스냅샷의 원문과 주장을 그대로 쓴다.** 모델을 다시 부르지 않는다.
 *    붙여넣은 글 안에서만 견주면 「내 초안의 숫자가 이 프로젝트와 맞나」를 못 본다.
 *    저장본이라 라이브보다 오래됐을 수 있다 — 그건 화면이 적는다.
 */
let cachedBase = null
async function baseline() {
  if (cachedBase) return cachedBase
  try {
    const { readFile } = await import('node:fs/promises')
    const url = new URL('../public/snapshot.json', import.meta.url)
    const j = JSON.parse(await readFile(url, 'utf8'))
    cachedBase = { docs: j.docs ?? [], claims: j.claims ?? [], rejected: j.rejected ?? [] }
  } catch (e) {
    // 🔴 조용히 넘기면 **비교군 없이 돈 결과가 정상처럼 보인다.** 로그에 남긴다.
    //    배포에서 이게 나면 `vercel.json` 의 `includeFiles` 를 확인해야 한다 —
    //    함수 번들은 정적 파일(`public/`)을 자동으로 안 담는다.
    console.warn('[비교군] 스냅샷을 못 읽었다 — 붙여넣은 글만 본다:', String(e.message ?? e))
    cachedBase = { docs: [], claims: [], rejected: [] }
  }
  return cachedBase
}

const MAX_CHARS = Number(process.env.TRY_MAX_CHARS ?? 4000)
// 🔑 비교군을 붙이면서 호출이 1회 → 2회가 됐다(추출 + 묶기). 하루 총량을 그만큼 줄인다.
const DAILY_BUDGET = Number(process.env.TRY_DAILY_BUDGET ?? 6)
const PER_IP_MS = Number(process.env.TRY_PER_IP_MS ?? 20_000)

let day = new Date().toISOString().slice(0, 10)
let used = 0
const lastByIp = new Map()

/** 오늘 이 인스턴스가 몇 번 썼는지. 날이 바뀌면 0 으로 돌린다. */
function budget() {
  const today = new Date().toISOString().slice(0, 10)
  if (today !== day) { day = today; used = 0 }
  return { used, limit: DAILY_BUDGET, remaining: Math.max(0, DAILY_BUDGET - used), maxChars: MAX_CHARS, perIpMs: PER_IP_MS }
}

export default async function handler(req, res) {
  // GET 은 남은 횟수만 알려준다. 호출을 쓰지 않는다.
  if (req.method === 'GET') return json(res, 200, budget())
  if (req.method !== 'POST') return json(res, 405, { error: 'POST 만 받습니다.' })
  const missing = keysReady()
  if (missing) return json(res, 503, { error: missing })

  budget()
  if (used >= DAILY_BUDGET) {
    return json(res, 429, { error: `오늘 시험 실행이 ${DAILY_BUDGET}회를 채웠습니다. 무료 티어 한도(모델당 하루 20회)를 나눠 쓰기 때문입니다.`, budget: budget() })
  }

  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'local'
  const since = Date.now() - (lastByIp.get(ip) ?? 0)
  if (since < PER_IP_MS) {
    return json(res, 429, { error: `${Math.ceil((PER_IP_MS - since) / 1000)}초 뒤에 다시 눌러 주세요.`, budget: budget() })
  }

  let text
  try { ({ text } = await readBody(req)) }
  catch (e) { return json(res, e.tooLarge ? 413 : 400, { error: '요청이 너무 큽니다.', budget: budget() }) }
  const body = String(text ?? '').trim()
  if (!body) return json(res, 400, { error: '글을 붙여넣어 주세요.', budget: budget() })
  if (body.length > MAX_CHARS) return json(res, 400, { error: `${MAX_CHARS}자까지만 받습니다 (지금 ${body.length}자).`, budget: budget() })
  if (!/\d/.test(body)) return json(res, 400, { error: '숫자가 없는 글입니다. 수치 감사는 숫자가 있어야 합니다.', budget: budget() })

  lastByIp.set(ip, Date.now())
  used += 1
  try {
    // 목록에 「붙여넣은 글」이 제목으로 또 나오면 같은 말이 두 번이다. 첫 줄을 제목으로 쓴다.
    const head = body.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
    const title = head.slice(0, 40) + (head.length > 40 ? '…' : '')
    const snapshot = await auditText(body, { chain: TRY_CHAIN, baseline: await baseline(), title: title || '붙여넣은 글' })
    return json(res, 200, { ...snapshot, budget: budget() })
  } catch (e) {
    used -= 1
    return json(res, 502, { error: userFacing(e, '감사에 실패했습니다. 잠시 뒤 다시 눌러 주세요.'), budget: budget() })
  }
}
