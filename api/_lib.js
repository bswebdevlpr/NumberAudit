import { requireEnv } from '../src/env.js'

/**
 * 서버가 만질 수 있는 프로젝트는 **하나로 고정한다.**
 * 클라이언트가 projectId 를 넘기게 두면, 배포된 함수가 내 키로 아무 방이나 읽고 쓰는 통로가 된다.
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
 */
export function keysReady() {
  try { requireEnv('FLOW_API_KEY'); requireEnv('GEMINI_API_KEY'); requireEnv('FLOW_DEMO_PROJECT_ID'); return null }
  catch (e) { return String(e.message) }
}
