/**
 * ③ 판정 — **코드가 하는 자리다.**
 *
 * 「이 숫자가 근거 있나」를 모델에게 물으면 그건 다시 모델을 믿는 것이다.
 * 여기서는 게이트를 통과한 주장들만 놓고, 코드가 볼 수 있는 사실로만 가른다.
 */

import { valueKey } from './value.js'
import { NO_CONDITION } from './cluster.js'

const norm = (s) => String(s ?? '').replace(/\s/g, '').replace(/(\d),(?=\d{3}\b)/g, '$1').toLowerCase()
const valueOf = (c) => valueKey(c)
const hasMethod = (c) => Boolean(String(c.method ?? '').trim())
const unitOf = (c) => norm(c.unit ?? '')

/**
 * 🔑 「근거 없음」의 코드적 정의.
 *
 *   측정값인데(목표가 아님)
 *   ∧ 이 값에 측정 방법이 안 적혀 있고
 *   ∧ **같은 조건 묶음 안에** 방법이 적힌 값이 없고
 *   ∧ 같은 지표에 방법이 적힌 다른 값은 존재한다
 *
 * 마지막 조건이 있어야 「아무도 방법을 안 적은 지표」 전체가 통째로 걸리지 않는다.
 *
 * 🔑 **면제는 「같은 값」이 아니라 「같은 조건 묶음」으로 준다.**
 *    예전에는 같은 숫자가 어딘가 방법과 함께 있으면 면제했다. 그건 **「같은 숫자면 같은 측정이다」라는 가정**이었고,
 *    조건 축(`findDisagreement`)이 방법을 따지는 것과 어긋났다.
 *    지금은 모델이 「같은 측정을 옮겨 적은 것」이라고 판단해 같은 묶음에 넣은 값만 면제된다.
 *    묶음에 못 들어간 값은 걸린다 — **모르는 것을 안다고 하지 않는다.** (`docs/decisions/0011-*`)
 *
 *    `contexts` 가 없으면 묶음이 하나뿐이라 「이 지표에 방법 적힌 값이 있나」만 보는 셈이 된다.
 *
 * ⚠️ 이건 「그 숫자가 틀렸다」가 아니다. **「감사한 글에서 근거를 못 찾았다」**까지다. 화면 문구도 그렇게 쓴다.
 */
export function findUnsourced(groupClaims, contexts) {
  if (!groupClaims.some(hasMethod)) return []          // 아무도 안 적은 지표는 통째로 둔다

  // 🔴 조건 묶음이 없으면 **옛 규칙(같은 값이면 면제)으로 떨어진다.**
  //    묶음이 하나뿐이라고 보면 그 묶음에 방법 적힌 값이 있어서 1차가 통째로 꺼진다 —
  //    모델이 조건을 못 가르면 판정이 조용히 사라지는 셈이라, 없을 때는 예전 동작을 남긴다.
  if (!contexts?.length) {
    const grounded = new Set(groupClaims.filter(hasMethod).map(valueOf))
    return groupClaims.filter((c) => !c.isTarget && !hasMethod(c) && !grounded.has(valueOf(c)))
  }

  const out = []
  for (const cs of splitByContext(groupClaims, contexts)) {
    if (cs.some(hasMethod)) continue                    // 이 묶음 안에 근거가 있다 → 면제
    out.push(...cs.filter((c) => !c.isTarget && !hasMethod(c)))
  }
  return out
}

/**
 * 🔑 2차 — **그룹 밖 대조.** 단위만 같은 값들과 견준다.
 *
 * 1차는 모델이 만든 지표 그룹 안에서만 본다. 그런데 글쓴이가 수식어를 빼고 쓰면
 * (`p95 응답시간` → `검색 응답`) 모델은 다른 지표로 가르고, 그러면 대조할 상대가 사라진다.
 * 실측: 상위 모델(3.6-flash)로 묶어도 갈렸다. **모델을 올려서 해결되는 문제가 아니다.**
 *
 * 그래서 축을 하나 더 둔다 — 같은 단위. 라운드 1에서 단위축 **묶기**는 졌다
 * (`ms` 라는 이유로 응답시간과 타임아웃이 한 그룹이 됐다). 여기서는 묶는 게 아니라
 * **「이 값과 견줄 만한 것이 감사 범위 안에 있나」**를 묻는 용도로만 쓴다. 그래도 오염 위험은 그대로다 —
 * 그래서 1차와 등급을 나눠 표시하고, 화면에 「단위만 같다」고 적는다.
 *
 * 조건: 측정값 · 방법 없음 · 같은 값이 방법과 함께 어디에도 없음 · **같은 단위**에 방법 있는 값이 존재.
 */
export function findUnsourcedByUnit(allClaims, alreadyFlagged = new Set()) {
  const groundedValues = new Set(allClaims.filter(hasMethod).map(valueOf))
  const groundedUnits = new Set(allClaims.filter(hasMethod).map((c) => unitOf(c)).filter(Boolean))
  return allClaims.filter((c) =>
    !alreadyFlagged.has(c.claimId) &&
    !c.isTarget && !hasMethod(c) &&
    !groundedValues.has(valueOf(c)) &&
    groundedUnits.has(unitOf(c)))
}

/**
 * 같은 지표 안에서 측정값이 갈리나. 판정이 아니라 **나열**이다 — 시점 차이일 수 있다.
 *
 * 🔑 **조건이 다르면 견주지 않는다.** `320ms(캐시 미적용)` 과 `280ms(캐시 워밍 후 3회 평균)` 는
 * 값이 다른 게 아니라 **애초에 견줄 수 없는 두 숫자**다. 조건 묶음(contexts)이 있으면 그 안에서만 본다.
 *
 * 조건 동일성은 문자열로 못 가른다 — `스테이징 · 동시 10 · 캐시 미적용` 과
 * `스테이징에서 동시 10 으로, 캐시 없이` 는 같은 조건인데 글자가 다르다. 완전 일치는 놓치고,
 * 유사도는 임계값을 감으로 정해야 한다(이 저장소가 인용 길이 `6자` 로 한 번 데인 자리다).
 * 그래서 **묶는 것은 모델이 하고, 갈렸는지 여부만 코드가 본다.**
 *
 * contexts 가 없으면 조건 축을 안 쓴 것과 같다 — 그룹 전체를 한 묶음으로 본다.
 */
export function findDisagreement(groupClaims, contexts) {
  const buckets = splitByContext(groupClaims, contexts)
  const out = []
  for (const cs of buckets) {
    const measured = cs.filter((c) => !c.isTarget)
    if ([...new Set(measured.map(valueOf))].length > 1) out.push(...measured)
  }
  return out
}

/**
 * 조건이 갈려서 **견주지 않은** 측정값들. 지우지 않고 등급만 달리 적기 위한 것이다 —
 * 모델이 조건을 잘못 갈랐을 때 사람이 뒤집을 수 있어야 한다.
 */
export function findCrossContext(groupClaims, contexts) {
  // ⚠️ **조건이 적혀 있지 않은 값은 여기 넣지 않는다.** 그건 조건이 「다른」 게 아니라 「모르는」 것이다.
  //    화면이 「조건이 달라 견주지 않았다」고 말하는데 사실은 안 적힌 것이면 거짓말이 된다.
  //    그 값들은 1차 「근거 없음」이 따로 본다.
  const named = (contexts ?? []).filter((ctx) => ctx.condition !== NO_CONDITION)
  if (named.length < 2) return []
  const within = new Set(findDisagreement(groupClaims, contexts).map((c) => c.claimId))
  const inNamed = new Set(named.flatMap((ctx) => ctx.claimIds ?? []))
  const measured = groupClaims.filter((c) => !c.isTarget)
  if ([...new Set(measured.map(valueOf))].length < 2) return []
  return measured.filter((c) => inNamed.has(c.claimId) && !within.has(c.claimId))
}

/** 조건 묶음대로 주장을 나눈다. 묶음이 없으면 통째로 한 묶음이다. */
function splitByContext(groupClaims, contexts) {
  if (!contexts?.length) return [groupClaims]
  const byId = new Map(groupClaims.map((c) => [c.claimId, c]))
  const buckets = contexts.map((ctx) => (ctx.claimIds ?? []).map((id) => byId.get(id)).filter(Boolean))
  const placed = new Set(contexts.flatMap((ctx) => ctx.claimIds ?? []))
  const left = groupClaims.filter((c) => !placed.has(c.claimId))
  if (left.length) buckets.push(left)
  return buckets.filter((b) => b.length)
}

/**
 * 그룹별 판정.
 * @returns {{metric, claims, unsourced, disagreement, targets}[]}
 */
export function judge(claims, groups) {
  const byId = new Map(claims.map((c) => [c.claimId, c]))
  return groups.map((g) => {
    const cs = g.claimIds.map((id) => byId.get(id)).filter(Boolean)
    return {
      metric: g.metric,
      claims: cs,
      targets: cs.filter((c) => c.isTarget),
      unsourced: findUnsourced(cs, g.contexts),
      disagreement: findDisagreement(cs, g.contexts),
      crossContext: findCrossContext(cs, g.contexts),
      contexts: (g.contexts ?? []).map((ctx) => ({ condition: ctx.condition, claimIds: [...(ctx.claimIds ?? [])] })),
    }
  }).sort((a, b) => (b.unsourced.length - a.unsourced.length) || (b.claims.length - a.claims.length))
}

/**
 * 프로젝트 전체 판정 — 1차(그룹 안) 다음에 2차(단위)를 돌린다.
 * @returns {{groups, byUnit}}
 */
export function judgeRoom(claims, groups) {
  const verdicts = judge(claims, groups)
  const flagged = new Set(verdicts.flatMap((v) => v.unsourced.map((c) => c.claimId)))
  return { verdicts, byUnit: findUnsourcedByUnit(claims, flagged) }
}

/**
 * 🚫 여기서 **안 하는 것** — 화면에도 그대로 적는다.
 *
 * - 목표 달성 여부를 판정하지 않는다. `300ms 목표 · 320ms 측정` 에서 어느 쪽이 좋은지는
 *   지표마다 방향이 다르고(작을수록 좋은 것 / 클수록 좋은 것), 원문에 방향이 안 적혀 있다.
 * - 숫자를 환산·비교해서 「2배 빨라졌다」의 진위를 따지지 않는다. 근거가 글 밖에 있다.
 * - 어느 값이 **맞는지** 고르지 않는다. 플로우에 글 본문 수정 API 가 없어 고칠 수도 없다.
 *   갈린 것을 사람에게 보여주는 데서 멈춘다. **취향이 아니라 경계다.**
 */
export const NOT_DONE = [
  '목표 달성 여부 판정 — 지표의 좋은 방향이 원문에 없다',
  '「2배 빨라졌다」류 파생 수치의 검산 — 근거가 글 밖에 있다',
  '어느 값이 맞는지 고르는 것 — 고칠 API 도 없고, 고를 근거도 없다',
]
