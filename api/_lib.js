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

export async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
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
