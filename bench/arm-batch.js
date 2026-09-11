import { generateJson } from '../src/gemini.js'
import { checkClaim } from '../src/gate.js'

/**
 * 배치 추출 — 문서 전부를 한 번에 넣는다.
 *
 * 왜 바꿨나: 무료 티어가 **모델당 하루 20회**다(실측 2026-09-09).
 * 문서당 1회 구조는 하루 20문서가 천장이고, 실제 프로젝트는 글이 수백 건이다.
 * 한도가 구조를 정했다.
 *
 * 배치가 만든 새 실패 모드: **오귀속** — 모델이 주장을 엉뚱한 문서에 붙인다.
 * 인용 게이트가 그대로 잡는다. quote 를 **그 docId 의 원문**에 대고 보기 때문이다.
 */
const SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          docId: { type: 'string', description: '이 수치가 나온 문서의 ID. 주어진 ID 중 하나여야 한다' },
          metric: { type: 'string', description: '지표를 짧은 명사구로' },
          valueText: { type: 'string', description: '글에 적힌 값 그대로' },
          unit: { type: 'string' },
          scope: { type: 'string', description: '이 숫자가 어디의 것인가 — 단계·구간·대상. 없으면 빈 문자열' },
          method: { type: 'string', description: '무엇과 비교해 어떤 환경·표본으로 쟀는가. 원문에 없으면 반드시 빈 문자열' },
          isTarget: { type: 'boolean' },
          quote: { type: 'string', description: '그 문서의 원문 구절을 글자 그대로' },
        },
        required: ['docId', 'metric', 'valueText', 'unit', 'scope', 'method', 'isTarget', 'quote'],
      },
    },
  },
  required: ['claims'],
}

const SYSTEM = [
  '너는 여러 글에서 「수치 주장」을 한 번에 뽑는 추출기다.',
  '- 글에 실제로 적힌 수치만 뽑는다. 계산하거나 환산하지 않는다.',
  '- quote 는 그 문서의 원문을 글자 그대로 복사한다. valueText 는 quote 안에 있어야 한다.',
  '- docId 는 그 수치가 실제로 나온 문서의 것이어야 한다. 다른 문서 ID를 붙이지 않는다.',
  '',
  'scope 와 method 를 엄격히 가른다.',
  '- scope = 이 숫자가 **어디의 것인가**. 단계·구간·대상. 예: "요구사항 정의 단계", "검색 API"',
  '- method = **무엇과 비교해 어떤 환경·표본으로 쟀는가**. 예: "스테이징 · 동시 10 · 캐시 미적용", "3회 평균"',
  '- 단계 이름·구간 이름은 method 가 아니다. scope 다.',
  '- 원문에 측정 방법이 안 적혀 있으면 method 는 **반드시 빈 문자열**이다. 추측해서 채우지 않는다.',
].join('\n')

export async function extractBatch(docs) {
  const byId = new Map(docs.map((d) => [d.docId, d]))
  const body = docs.map((d) => `### ${d.docId}\n제목: ${d.title}\n작성자: ${d.author}\n본문:\n${d.text}`).join('\n\n')

  const { claims: raw } = await generateJson({
    system: SYSTEM,
    prompt: `다음 문서들에서 수치 주장을 전부 뽑아라.\n\n${body}`,
    schema: SCHEMA,
  })

  const claims = []
  const rejected = []
  const stats = { raw: 0, tier1: 0, tier2: 0, misattributed: 0, unknownDoc: 0, byReason: {} }

  for (const c of raw ?? []) {
    stats.raw += 1
    const doc = byId.get(c.docId)

    // 없는 문서 ID를 지어냈나
    if (!doc) {
      stats.unknownDoc += 1
      stats.byReason['없는 docId'] = (stats.byReason['없는 docId'] ?? 0) + 1
      rejected.push({ ...c, reason: '없는 docId' })
      continue
    }

    const v = checkClaim({ sourceText: doc.text, quote: c.quote, valueText: c.valueText })
    if (v.ok) {
      v.tier === '1차' ? (stats.tier1 += 1) : (stats.tier2 += 1)
      claims.push({ ...c, title: doc.title, claimId: `B${String(claims.length + 1).padStart(3, '0')}`, gateTier: v.tier })
      continue
    }

    // 인용이 이 문서엔 없는데 다른 문서엔 있다 → 오귀속. 배치가 만든 실패 모드다.
    const elsewhere = docs.find((d) => d.docId !== c.docId &&
      checkClaim({ sourceText: d.text, quote: c.quote, valueText: c.valueText }).ok)
    const reason = elsewhere ? `오귀속 (실제로는 ${elsewhere.docId})` : v.reason
    if (elsewhere) stats.misattributed += 1
    stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1
    rejected.push({ ...c, reason })
  }

  return { claims, rejected, stats }
}
