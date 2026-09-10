/**
 * 통제군 — 모델 없이 정규식으로만 수치를 뽑고 묶는다.
 *
 * 이 팔이 존재하는 이유: 「수치 추출」은 셀 수 있는 일에 가깝다.
 * 셀 수 있는 자리에 모델을 붙이면 대개 진다. 그러니 먼저 재고, 진 자리에서만 모델을 쓴다.
 */

// 숫자 + 단위. 쉼표·소수점 허용.
const NUM = String.raw`\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?`
const UNIT_RE = new RegExp(String.raw`(${NUM})\s*(ms|초|분|%|개|건|회|케이스|줄|명)`, 'g')
const DATE_RE = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/g

/** 단위별로 묶는다 — 정규식이 알 수 있는 최대치다. 「무슨 지표인가」는 모른다. */
const UNIT_AXIS = {
  ms: '시간', 초: '시간', 분: '시간',
  '%': '비율',
  개: '개수', 건: '개수', 회: '개수', 케이스: '개수', 줄: '개수', 명: '개수',
  날짜: '날짜',
}

export function baselineExtract(docs) {
  const claims = []
  const push = (doc, valueText, unit, index) => {
    const from = Math.max(0, index - 30)
    claims.push({
      claimId: `B${String(claims.length + 1).padStart(3, '0')}`,
      docId: doc.docId, postId: doc.postId, title: doc.title,
      valueText, unit, axis: UNIT_AXIS[unit] ?? '기타',
      quote: doc.text.slice(from, index + valueText.length + 20).replace(/\n/g, ' ').trim(),
    })
  }

  for (const doc of docs) {
    for (const m of doc.text.matchAll(UNIT_RE)) push(doc, `${m[1]}${m[2]}`, m[2], m.index)
    for (const m of doc.text.matchAll(DATE_RE)) push(doc, `${m[1]}월 ${m[2]}일`, '날짜', m.index)
  }
  return claims
}

/** 단위 축으로만 묶는다. 「p95 응답시간」과 「목표 300ms」를 못 가른다 — 그게 이 팔의 천장이다. */
export function baselineGroup(claims) {
  const groups = new Map()
  for (const c of claims) {
    if (!groups.has(c.axis)) groups.set(c.axis, [])
    groups.get(c.axis).push(c)
  }
  return [...groups.entries()].map(([axis, items]) => ({ key: axis, claims: items }))
}
