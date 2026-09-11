/**
 * 인용 게이트 — 모델이 낸 주장을 원문으로 되짚는다.
 *
 * 모델에게 「이 수치가 근거 있나」를 묻지 않는다. 그건 다시 모델을 믿는 것이다.
 * 코드가 볼 수 있는 사실만 본다 — 인용이 원문에 있나, 값이 인용 안에 있나.
 */

const ZERO_WIDTH = /[​-‍﻿]/g

/** 1차 정규화 — 공백·제로폭만 없앤다. 원문을 최대한 그대로 본다. */
export function tight(s) {
  return String(s ?? '').replace(/ /g, ' ').replace(ZERO_WIDTH, '').replace(/\s+/g, '')
}

/** 2차 정규화 — 표기 흔들림을 흡수한다. 느슨해진 만큼 따로 센다. */
export function loose(s) {
  return tight(s)
    .replace(/(\d),(?=\d{3}\b)/g, '$1')          // 1,284 → 1284
    .replace(/[—–ー-]/g, '-')                     // 대시 통일
    .replace(/[·・‧]/g, '·')                       // 가운뎃점 통일
    .replace(/[「」『』"'"']/g, '')                 // 따옴표 제거
    .toLowerCase()
}

/**
 * ③ 자리를 특정하나 — **길이로 재지 않는다.**
 *
 * 두 번 틀렸다.
 *  1. 처음엔 인용의 **절대 길이** 하한(6자)을 뒀다. 감이었고 `'참석 5명.'`(5자)을 잘랐다.
 *  2. 다음엔 **값 외 문맥 3자**로 바꿨다. 실측에서 나온 값이라 감은 아니었지만, **재는 축이 여전히 대리 지표였다.**
 *
 * 묻고 싶은 건 길이가 아니라 「이 인용으로 자리가 찾아지나」다. 그건 **세면 된다.**
 *
 * 저장된 주장 33건을 다시 걸어 비교했다 (`node bench/gate-rules.js`, 모델 호출 0회):
 *   - 길이 규칙은 통과 30건 중 **2건이 자리를 못 잡았다** (`"배포 3회"` 는 그 글에 2번, `"p95 320ms"` 는 다른 글에도)
 *   - 세는 규칙은 **같은 30건을 통과시키면서 그 2건이 없다**
 *   - 길이 규칙이 버린 `"4시간"` · `"47회면"` 은 둘 다 그 글에 한 번뿐이라 자리가 특정된다
 *
 * 길이 규칙은 **모호한 걸 통과시키고 명확한 걸 버렸다.** 그래서 축을 바꿨다.
 * 남은 하한 1자는 인용이 값 문자열과 **완전히 같은** 경우만 막는다.
 *
 * ⚠️ 합성 원문 58건에서는 다섯 규칙이 전부 같은 결과였다. **이 차이는 실제 flow 데이터에서만 드러났다.**
 */
export const MIN_CONTEXT_CHARS = 1

const occurrences = (hay, needle) => {
  if (!needle) return 0
  let n = 0, i = 0
  while ((i = hay.indexOf(needle, i)) >= 0) { n++; i++ }
  return n
}

/**
 * @param {object} p
 * @param {{docId: string, title?: string, text: string}[]} [p.otherDocs]
 *   같은 감사에 들어온 **다른 문서들.** 주면 귀속까지 본다. 안 주면 그 검사만 건너뛴다
 *   (화면의 「직접 해보기」는 문서가 하나뿐이라 안 준다).
 * @returns {{ok, tier: '1차'|'2차'|null, reason, alsoIn: {docId, title}[]}}
 *   `alsoIn` 은 **폐기 사유가 아니다.** 같은 문장이 다른 글에도 실재해서
 *   어느 쪽 것인지 못 가렸다는 뜻이고, 화면에 출처를 적는다. 버리지 않는다.
 *
 * 귀속 검사는 주장마다 다른 문서를 전부 훑는다. 배치 상한(100문서)에서 재 봤다 —
 * 문서 100 · 주장 300 에 **484ms**. 같은 배치의 모델 호출이 50~90초라 문제되는 자리가 아니다.
 */
export function checkClaim({ sourceText, quote, valueText, otherDocs = [] }) {
  const q = String(quote ?? '')
  if (!tight(q)) return { ok: false, tier: null, reason: '인용이 비어 있음' }

  // ① 인용이 그 문서 원문에 실재하나
  let tier = null
  if (tight(sourceText).includes(tight(q))) tier = '1차'
  else if (loose(sourceText).includes(loose(q))) tier = '2차'
  else return { ok: false, tier: null, reason: '인용이 원문에 없음', alsoIn: [] }

  // ② 값이 인용 안에 실재하나 — 이게 없으면 원문 아무 문장이나 복사하고 값은 지어내도 통과한다
  const v = String(valueText ?? '')
  if (!v) return { ok: false, tier, reason: '값이 비어 있음', alsoIn: [] }
  if (!loose(q).includes(loose(v))) {
    return { ok: false, tier, reason: '값이 인용 안에 없음', alsoIn: [] }
  }

  // ③ 이 인용으로 자리가 찾아지나 — 그 글에 두 번 이상 나오면 어느 자리인지 못 가린다
  const hits = tier === '1차'
    ? occurrences(tight(sourceText), tight(q))
    : occurrences(loose(sourceText), loose(q))
  if (hits > 1) {
    return { ok: false, tier, reason: `같은 인용이 이 글에 ${hits}번 나옴`, alsoIn: [] }
  }
  if (tight(q).length - tight(v).length < MIN_CONTEXT_CHARS) {
    return { ok: false, tier, reason: '값만 인용함', alsoIn: [] }
  }

  // 🔑 귀속 — 다른 글에도 같은 문장이 있으면 **버리지 않고 출처를 적는다.**
  //    가짜 인용이 아니라 어느 쪽 것인지 못 가린 것이다.
  const alsoIn = (otherDocs ?? [])
    .filter((d) => tight(d.text ?? '').includes(tight(q)) || loose(d.text ?? '').includes(loose(q)))
    .map((d) => ({ docId: d.docId, title: d.title ?? '' }))

  return { ok: true, tier, reason: null, alsoIn }
}
