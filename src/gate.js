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
 * ③ 문맥 하한 — 인용이 값 그 자체면 안 된다.
 *
 * 처음엔 인용의 **절대 길이** 하한(6자)을 뒀다. 감이었고, 실제로 물었다 —
 * `'참석 5명.'`(5자)이 잘렸는데 정당한 인용이었다.
 *
 * 재보니 축이 틀렸다 (`node bench/quote-len.js`):
 *   - 통과 인용 82건 중 다른 문서에도 들어맞는 것 **0건** → 길이 하한이 막은 게 없다
 *   - 실제 인용의 문맥량(인용 길이 − 값 길이)은 **최소 3자 · 중앙 19자**
 *   - 반면 값만 있으면 위험하다 — `47회`는 3개 문서에, `320`은 2개 문서에 있다
 *
 * 그래서 막을 것은 「짧은 인용」이 아니라 **「문맥 없는 인용」**이다.
 * ⚠️ 3은 이 표본의 실측 최소값이다. 감은 아니지만 표본 하나에서 나왔다 — 더 짧은 정당한 인용이 있으면 잘린다.
 */
export const MIN_CONTEXT_CHARS = 3

/**
 * @returns {{ok: boolean, tier: '1차'|'2차'|null, reason: string|null}}
 *   tier 를 나눠 돌려주는 이유: 느슨한 규칙으로 통과한 건수가 곧 게이트의 실제 강도다.
 */
export function checkClaim({ sourceText, quote, valueText }) {
  const q = String(quote ?? '')
  if (!tight(q)) return { ok: false, tier: null, reason: '인용이 비어 있음' }

  // ① 인용이 그 문서 원문에 실재하나
  let tier = null
  if (tight(sourceText).includes(tight(q))) tier = '1차'
  else if (loose(sourceText).includes(loose(q))) tier = '2차'
  else return { ok: false, tier: null, reason: '인용이 원문에 없음' }

  // ② 값이 인용 안에 실재하나 — 이게 없으면 원문 아무 문장이나 복사하고 값은 지어내도 통과한다
  const v = String(valueText ?? '')
  if (!v) return { ok: false, tier, reason: '값이 비어 있음' }
  if (!loose(q).includes(loose(v))) {
    return { ok: false, tier, reason: '값이 인용 안에 없음' }
  }

  // ③ 값 주변에 문맥이 있나 — 값 자체만 인용하면 어느 문서 것인지 못 가린다
  const context = tight(q).length - tight(v).length
  if (context < MIN_CONTEXT_CHARS) {
    return { ok: false, tier, reason: `문맥 없음 (값 외 ${context}자)` }
  }

  return { ok: true, tier, reason: null }
}
