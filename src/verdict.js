/**
 * ③ 판정 — **코드가 하는 자리다.**
 *
 * 「이 숫자가 근거 있나」를 모델에게 물으면 그건 다시 모델을 믿는 것이다.
 * 여기서는 게이트를 통과한 주장들만 놓고, 코드가 볼 수 있는 사실로만 가른다.
 */

const norm = (s) => String(s ?? '').replace(/\s/g, '').replace(/(\d),(?=\d{3}\b)/g, '$1').toLowerCase()
const valueOf = (c) => norm(`${c.valueText}${c.unit ?? ''}`)
const hasMethod = (c) => Boolean(String(c.method ?? '').trim())
const unitOf = (c) => norm(c.unit ?? '')

/**
 * 🔑 「근거 없음」의 코드적 정의.
 *
 *   측정값인데(목표가 아님)
 *   ∧ 같은 값이 **측정 방법과 함께** 적힌 곳이 어디에도 없고
 *   ∧ 같은 지표에 방법이 적힌 다른 값은 존재한다
 *
 * 마지막 조건이 있어야 「아무도 방법을 안 적은 지표」 전체가 통째로 걸리지 않는다.
 * 두 번째 조건이 있어야 킥오프 글의 820ms 처럼 **다른 글에서 방법과 함께 재등장하는 값**이 안 걸린다.
 *
 * ⚠️ 이건 「그 숫자가 틀렸다」가 아니다. **「감사한 글에서 근거를 못 찾았다」**까지다. 화면 문구도 그렇게 쓴다.
 */
export function findUnsourced(groupClaims) {
  const grounded = new Set(groupClaims.filter(hasMethod).map(valueOf))
  if (grounded.size === 0) return []
  return groupClaims.filter((c) => !c.isTarget && !hasMethod(c) && !grounded.has(valueOf(c)))
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

/** 같은 지표 안에서 측정값이 갈리나. 판정이 아니라 **나열**이다 — 시점 차이일 수 있다. */
export function findDisagreement(groupClaims) {
  const measured = groupClaims.filter((c) => !c.isTarget)
  const values = [...new Set(measured.map(valueOf))]
  return values.length > 1 ? measured : []
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
      unsourced: findUnsourced(cs),
      disagreement: findDisagreement(cs),
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
