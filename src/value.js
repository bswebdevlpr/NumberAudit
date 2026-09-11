/**
 * 값 + 단위를 한 문자열로 만든다 — **화면·판정·업무가 같은 규칙을 쓴다.**
 *
 * ⚠️ 모델이 `valueText` 에 단위를 같이 넣을 때가 있다. 스키마 설명을 좁혀도 실행마다 흔들린다
 *    (실측: 같은 모델·같은 입력에서 `"320"/"ms"` 로도, `"320ms"/"ms"` 로도 왔다).
 *    그대로 이으면 `320msms` 가 화면과 업무 제목에 그대로 나간다.
 *    **프롬프트로 부탁하고, 코드로 되짚는다.** 이 파일이 그 되짚는 자리다.
 */
export function valueLabel(c) {
  const v = String(c?.valueText ?? '').trim()
  const u = String(c?.unit ?? '').trim()
  if (!u) return v
  return v.toLowerCase().endsWith(u.toLowerCase()) ? v : `${v}${u}`
}

/** 값이 같은지 견줄 때 쓰는 열쇠. 공백과 천 단위 쉼표를 지운다. */
export const valueKey = (c) => valueLabel(c).replace(/\s/g, '').replace(/(\d),(?=\d{3}\b)/g, '$1').toLowerCase()
