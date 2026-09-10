import { json, readBody, keysReady } from './_lib.js'

/**
 * 쓰는 사람이 **자기 글**로 파이프라인을 돌려 보는 자리.
 *
 * 플로우도 내 데이터도 거치지 않는다 — 붙여넣은 글 하나에 추출과 게이트를 건다.
 * ⚠️ 내 Gemini 한도를 쓴다(모델당 하루 20회). 그래서 세 겹으로 막는다 —
 *    입력 길이 · 같은 IP 의 짧은 간격 · 하루 총량. 막힐 때는 **사유를 그대로 말한다.**
 *
 * 🟠 다만 뒤의 둘은 **이 인스턴스의 메모리**에 있다. 서버리스는 인스턴스가 여러 개고 콜드스타트마다 초기화되므로
 *    실제로는 「하루 12회」가 아니라 「인스턴스당 12회」다. 진짜 방어선은 Gemini 자체 한도다.
 *    공유 저장소를 두면 정확해지지만 이 규모에 부품을 늘리지 않았다 — **알고 안 한 것이라 적어 둔다.**
 */
process.env.GEMINI_MODEL ??= process.env.LIVE_GEMINI_MODEL ?? 'gemini-3.1-flash-lite'
const { auditText } = await import('../src/audit.js')

const MAX_CHARS = Number(process.env.TRY_MAX_CHARS ?? 4000)
const DAILY_BUDGET = Number(process.env.TRY_DAILY_BUDGET ?? 12)
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
  if (req.method !== 'POST') return json(res, 405, { error: 'POST 만 받는다' })
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

  const { text } = await readBody(req)
  const body = String(text ?? '').trim()
  if (!body) return json(res, 400, { error: '글을 붙여넣어 주세요.', budget: budget() })
  if (body.length > MAX_CHARS) return json(res, 400, { error: `${MAX_CHARS}자까지만 받습니다 (지금 ${body.length}자).`, budget: budget() })
  if (!/\d/.test(body)) return json(res, 400, { error: '숫자가 없는 글입니다. 수치 감사는 숫자가 있어야 합니다.', budget: budget() })

  lastByIp.set(ip, Date.now())
  used += 1
  try {
    const snapshot = await auditText(body)
    return json(res, 200, { ...snapshot, budget: budget() })
  } catch (e) {
    used -= 1
    return json(res, 502, { error: String(e.message ?? e), budget: budget() })
  }
}
