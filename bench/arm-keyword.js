/**
 * 라운드 2 통제군 — 「이 문장에 측정 방법이 적혀 있나」를 키워드로만 판정한다.
 *
 * ⚠️ 이 키워드 목록은 **이 데이터를 보고 골랐다.** 과적합이다.
 *    홀드아웃이 필요한데 표본이 작아 못 쪼갰다. 성적은 낙관값으로 읽어야 한다.
 *    (`YourAiWorkforce/docs/metrics/countable-or-not.md:32` 가 같은 한계를 적어뒀다)
 */
const METHOD_WORDS = [
  '기준', '측정', '평균', '대비', '환경', '동시', '워밍', '표본',
  '스테이징', '프로덕션', '로컬', '재측정', '회 평균', 'n=', '±',
]

/** 값이 들어 있는 줄에 측정 어휘가 있으면 method 가 있다고 본다. */
export function keywordMethod(sourceText, valueText) {
  const v = String(valueText ?? '').replace(/\s/g, '')
  for (const raw of String(sourceText).split('\n')) {
    const line = raw.replace(/\s/g, '')
    if (!v || !line.includes(v)) continue
    const hits = METHOD_WORDS.filter((w) => raw.includes(w))
    if (hits.length) return { has: true, hits }
  }
  return { has: false, hits: [] }
}
