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
 * 🔑 **모델을 부르기 전에 플로우를 먼저 읽는다.**
 *    Gemini 무료 티어는 모델당 하루 20회고 감사 한 번이 2회(추출+묶기)를 쓴다 — **하루 10번**이다.
 *    10분 TTL 만으로는 부족하다: 서버리스는 인스턴스가 여럿이라 콜드스타트마다 캐시가 비고,
 *    새로고침 몇 번에 하루치가 마른다. 마르면 「지금도 돈다」는 증거가 통째로 사라진다.
 *
 *    그래서 글 목록만 읽어 **지문**을 만든다(플로우 호출 1회 — Gemini 예산과 무관).
 *    지문이 같으면 모델을 **한 번도 안 부르고** 캐시를 돌려준다.
 *    방이 안 바뀌면 감사 결과도 안 바뀌니, 다시 부를 이유가 없다.
 */
const TTL_MS = Number(process.env.AUDIT_CACHE_MS ?? 60 * 60 * 1000)
let cache = null   // { at, fingerprint, snapshot }

/** 글 목록의 지문 — 글이 늘거나 수정되거나 댓글이 붙으면 달라진다. */
async function fingerprint() {
  const { flow } = await import('../src/flow.js')
  const list = await flow.listPosts(DEMO_PROJECT_ID)
  return list
    .map((p) => `${p.postId}:${p.editedDateTime ?? p.registeredDateTime ?? ''}:${p.remarkCount ?? 0}`)
    .sort().join('|')
}

export default async function handler(req, res) {
  const missing = keysReady()
  if (missing) return json(res, 503, { error: missing })

  const fresh = cache && Date.now() - cache.at < TTL_MS
  if (fresh) {
    // 🔑 지문이 같으면 모델을 안 부른다. 플로우 조회가 실패하면 TTL 판정만 믿고 캐시를 쓴다 —
    //    여기서 터져서 라이브 경로 전체가 죽는 것보다 낫다.
    try {
      if (await fingerprint() === cache.fingerprint) {
        return json(res, 200, {
          ...cache.snapshot, live: true, cached: true,
          cachedAt: new Date(cache.at).toISOString(), unchanged: true,
        })
      }
    } catch {
      return json(res, 200, { ...cache.snapshot, live: true, cached: true, cachedAt: new Date(cache.at).toISOString() })
    }
  }

  try {
    const snapshot = await auditProject(DEMO_PROJECT_ID)
    let fp = null
    try { fp = await fingerprint() } catch { /* 지문을 못 만들면 다음 요청이 다시 감사한다 */ }
    cache = { at: Date.now(), fingerprint: fp, snapshot }
    return json(res, 200, { ...snapshot, live: true, cached: false })
  } catch (e) {
    // 한도 소진·모델 장애는 실패가 아니라 **폴백 사유**다. 화면이 저장된 스냅샷을 그대로 쓰면 된다.
    return json(res, 502, { error: String(e.message ?? e) })
  }
}
