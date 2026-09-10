import { generateJson } from '../src/gemini.js'
import { checkClaim } from '../src/gate.js'

/**
 * 라운드 2 실험군 — condition 을 scope / method 로 쪼갠다.
 *
 * 라운드 1에서 외부 문서의 절감률 7건에 condition 이 전부 채워졌다.
 * 그런데 내용은 「요구사항 정의 단계」처럼 **어디의 숫자인가**였다.
 * 조건이 채워졌다고 근거가 생긴 게 아니었다.
 */
const SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          metric: { type: 'string', description: '지표를 짧은 명사구로' },
          valueText: { type: 'string', description: '글에 적힌 값 그대로' },
          unit: { type: 'string' },
          scope: { type: 'string', description: '이 숫자가 어디의 것인가 — 단계·구간·대상. 없으면 빈 문자열' },
          method: { type: 'string', description: '무엇과 비교해 어떤 환경·표본으로 쟀는가. 원문에 없으면 반드시 빈 문자열' },
          isTarget: { type: 'boolean' },
          quote: { type: 'string', description: '원문 구절을 글자 그대로' },
        },
        required: ['metric', 'valueText', 'unit', 'scope', 'method', 'isTarget', 'quote'],
      },
    },
  },
  required: ['claims'],
}

const SYSTEM = [
  '너는 글에서 「수치 주장」을 뽑는 추출기다.',
  '- 글에 실제로 적힌 수치만 뽑는다. 계산하거나 환산하지 않는다.',
  '- quote 는 원문을 글자 그대로 복사한다. valueText 는 quote 안에 있어야 한다.',
  '',
  'scope 와 method 를 엄격히 가른다.',
  '- scope = 이 숫자가 **어디의 것인가**. 단계·구간·대상. 예: "요구사항 정의 단계", "검색 API"',
  '- method = **무엇과 비교해 어떤 환경·표본으로 쟀는가**. 예: "스테이징 · 동시 10 · 캐시 미적용", "3회 평균"',
  '- 단계 이름·구간 이름은 method 가 아니다. scope 다.',
  '- 원문에 측정 방법이 안 적혀 있으면 method 는 **반드시 빈 문자열**이다. 추측해서 채우지 않는다.',
].join('\n')

export async function extractSplit(docs) {
  const claims = []
  const rejected = []
  const stats = { raw: 0, tier1: 0, tier2: 0, byReason: {} }

  for (const doc of docs) {
    const { claims: raw } = await generateJson({
      system: SYSTEM,
      prompt: `다음 글에서 수치 주장을 뽑아라.\n\n제목: ${doc.title}\n작성자: ${doc.author}\n본문:\n${doc.text}`,
      schema: SCHEMA,
    })
    for (const c of raw ?? []) {
      stats.raw += 1
      const base = { ...c, docId: doc.docId, title: doc.title }
      const v = checkClaim({ sourceText: doc.text, quote: c.quote, valueText: c.valueText })
      if (v.ok) {
        v.tier === '1차' ? (stats.tier1 += 1) : (stats.tier2 += 1)
        claims.push({ ...base, claimId: `S${String(claims.length + 1).padStart(3, '0')}`, gateTier: v.tier })
      } else {
        stats.byReason[v.reason] = (stats.byReason[v.reason] ?? 0) + 1
        rejected.push({ ...base, reason: v.reason })
      }
    }
  }
  return { claims, rejected, stats }
}
