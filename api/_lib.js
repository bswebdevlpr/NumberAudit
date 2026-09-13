import { requireEnv } from '../src/env.js'

/**
 * 서버가 만질 수 있는 프로젝트는 **하나로 고정한다.**
 * 클라이언트가 projectId 를 넘기게 두면, 배포된 함수가 내 키로 아무 프로젝트나 읽고 쓰는 통로가 된다.
 */
export const DEMO_PROJECT_ID = String(process.env.FLOW_DEMO_PROJECT_ID ?? '')

export const json = (res, code, obj) => {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(obj))
}

/**
 * 🔑 **읽으면서 자른다.** 다 읽고 나서 길이를 재면 이미 메모리에 올라간 뒤다 —
 *    큰 POST 하나로 함수를 밀어낼 수 있다. 상한을 넘으면 그 자리에서 멈춘다.
 */
const MAX_BODY = Number(process.env.MAX_BODY_BYTES ?? 256 * 1024)

export async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > MAX_BODY) { const e = new Error('요청이 너무 큽니다.'); e.tooLarge = true; throw e }
    chunks.push(c)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  try { return raw ? JSON.parse(raw) : {} } catch { return {} }
}

/**
 * 설정이 갖춰졌는지 먼저 본다. 없으면 조용히 실패하는 대신 사유를 말한다.
 * ⚠️ `FLOW_DEMO_PROJECT_ID` 도 여기서 본다. 한때 없으면 하드코딩 id 로 떨어졌는데,
 *    그러면 배포에 변수를 안 넣어도 **틀린 프로젝트를 감사하면서 정상으로 보인다.**
 *
 * 🔑 **환경변수 이름은 화면으로 안 내보낸다.** 설정 메시지는 만든 사람이 읽을 것이지
 *    이 페이지를 연 사람이 읽을 것이 아니다 — 서버 로그로 보내고 화면에는 사람 말로 적는다.
 */
export function keysReady() {
  try { requireEnv('FLOW_API_KEY'); requireEnv('GEMINI_API_KEY'); requireEnv('FLOW_DEMO_PROJECT_ID'); return null }
  catch (e) {
    console.warn('[설정]', String(e.message))
    return '서버 설정이 아직 안 끝났습니다.'
  }
}

/** 사용자에게 보일 실패 사유. 스택·내부 경로·변수 이름을 화면으로 내보내지 않는다. */
export function userFacing(e, fallback) {
  const m = String(e?.message ?? e ?? '')
  console.warn('[실패]', m)
  // 한도·모델 장애처럼 **사용자가 알아야 뜻이 통하는 것**만 그대로 내보낸다.
  if (/RESOURCE_EXHAUSTED|한도|quota/i.test(m)) return '오늘 모델 호출 한도를 다 썼습니다. 내일 다시 열립니다.'
  return fallback
}

/**
 * 🔑 **브라우저가 보낸 교차 사이트 요청을 거른다.**
 *    이 엔드포인트들은 인증이 없어서 훔칠 세션은 없다. 그래도 남의 페이지가 방문자 브라우저로
 *    이쪽에 POST 를 시킬 수 있고, 그러면 **내 하루 한도를 남의 IP 로 태운다.**
 *
 *    브라우저는 교차 출처 POST 에 `Origin` 을 반드시 붙인다. 그러니 **있으면 대조하고, 없으면 통과**시킨다 —
 *    없는 쪽은 브라우저가 아니다(curl·CLI·상태 점검). 브라우저만 막으면 되는 문제라 그걸로 충분하다.
 *    ⚠️ 인증이 붙는 날에는 이 판단을 다시 해야 한다. 그때는 없는 `Origin` 도 막아야 한다.
 */
export function crossSite(req) {
  const origin = req.headers.origin
  if (!origin) return null
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  try {
    if (new URL(origin).host === String(host)) return null
  } catch { /* 파싱 안 되면 아래로 */ }
  console.warn('[교차출처]', origin, '→', host)
  return '다른 사이트에서 온 요청은 받지 않습니다.'
}

/**
 * 🔑 **클라이언트가 정할 수 없는 값부터 본다.**
 *    `x-forwarded-for` 는 요청자가 직접 넣을 수 있는 헤더다. 플랫폼이 덮어써 주는 환경에서는 첫 값이 맞지만,
 *    안 덮는 곳에 올리면 **간격 제한이 헤더 한 줄로 뚫린다.** 프록시가 넣는 값을 먼저 쓰고,
 *    `x-forwarded-for` 밖에 없으면 **맨 뒤**를 쓴다 — 앞쪽은 요청자가 채울 수 있고 뒤쪽은 프록시가 채운다.
 */
export function clientIp(req) {
  const h = req.headers
  const first = (v) => String(v ?? '').split(',')[0].trim()
  const proxied = first(h['x-real-ip']) || first(h['x-vercel-forwarded-for'])
  if (proxied) return proxied
  const chain = String(h['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return chain[chain.length - 1] || 'local'
}
