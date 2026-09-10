import { DEMO_PROJECT_ID, json, keysReady } from './_lib.js'

/**
 * 라이브 경로의 모델을 **빠른 쪽으로 고정한다.**
 * 실측(2026-09-09~10): 상위 체인(3.6→3.5)은 23~105초로 흔들리고 절반 이상이 60초를 넘었다.
 * 배포 함수 상한이 60초라 그대로 두면 자주 잘린다 — 잘리면 Gemini 호출만 태우고 결과가 없다.
 * 저장된 스냅샷은 상위 모델로 만든 것이고, 라이브는 **「지금도 돈다」를 증명하는 경로**다.
 * 어느 모델이 돌았는지는 화면에 그대로 적힌다.
 */
process.env.GEMINI_MODEL ??= process.env.LIVE_GEMINI_MODEL ?? 'gemini-3.1-flash-lite'
const { auditProject } = await import('../src/audit.js')

/**
 * 데모 방을 **지금** 다시 감사한다.
 *
 * 화면은 저장된 스냅샷을 먼저 그리고, 이 응답이 오면 갈아 끼운다.
 * 그래서 링크는 어떤 경우에도 죽지 않고, 살아 있으면 방금 돈 결과가 보인다.
 *
 * ⚠️ Gemini 무료 티어는 모델당 하루 20회다. 새로고침마다 부르면 금방 마른다 —
 *    한 인스턴스 안에서 TTL 동안 결과를 재사용하고, 재사용했다는 사실을 응답에 적는다.
 */
const TTL_MS = Number(process.env.AUDIT_CACHE_MS ?? 10 * 60 * 1000)
let cache = null   // { at, snapshot }

export default async function handler(req, res) {
  const missing = keysReady()
  if (missing) return json(res, 503, { error: missing })

  if (cache && Date.now() - cache.at < TTL_MS) {
    return json(res, 200, { ...cache.snapshot, live: true, cached: true, cachedAt: new Date(cache.at).toISOString() })
  }

  try {
    const snapshot = await auditProject(DEMO_PROJECT_ID)
    cache = { at: Date.now(), snapshot }
    return json(res, 200, { ...snapshot, live: true, cached: false })
  } catch (e) {
    // 한도 소진·모델 장애는 실패가 아니라 **폴백 사유**다. 화면이 저장된 스냅샷을 그대로 쓰면 된다.
    return json(res, 502, { error: String(e.message ?? e) })
  }
}
