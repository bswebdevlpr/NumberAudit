import { generateJson } from './gemini.js'
import { checkClaim } from './gate.js'

/**
 * ①-b·c 추출 — 문서 여러 건을 한 번에 넣는다.
 *
 * 왜 배치인가: 무료 티어가 **모델당 하루 20회**다(실측 2026-09-09).
 * 문서당 1회 구조는 하루 20문서가 천장이고, 실제 프로젝트방은 글이 수백 건이다.
 * **한도가 구조를 정했다.**
 *
 * 배치가 만든 새 실패 모드: **오귀속** — 모델이 주장을 엉뚱한 문서에 붙인다.
 * 인용 게이트가 그대로 잡는다. quote 를 **그 docId 의 원문**에 대고 보기 때문이다.
 *
 * 측정 하네스의 통제군은 `bench/arm-batch.js` 에 그대로 둔다. 이 파일은 구현물이다.
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

/**
 * 배치 예산 — 병목은 입력이 아니라 **출력**이다.
 *
 *   입력 상한 1,048,576 토큰 · 출력 상한 65,536 토큰 (실측 2026-09-09)
 *   문서 12건 배치 실측: 입력 1,353 / 출력 1,825 → 문서당 입력 ~113 · 출력 ~152
 *
 * 출력은 실측(≈254, 라운드 2 기준의 더 큰 값)에 **안전계수 2** 를 곱해 문서당 508 로 잡는다.
 * 65,536 / 508 ≈ 129 → 내림해서 100. 입력은 1M 의 20% 만 쓴다.
 * ⚠️ 이 값들은 12건 표본에서 왔다. 100건에서 같은 비율이 나온다는 근거는 아직 없다.
 */
export const BUDGET = {
  docsPerBatch: 100,
  outputTokensPerDoc: 508,
  inputTokenCap: 200_000,
  tokensPerChar: 1.5,   // 한국어 실측 ≈1.3. 올려 잡는다
}

const estimateInputTokens = (docs) =>
  docs.reduce((a, d) => a + (d.text.length + (d.title?.length ?? 0) + 40), 0) * BUDGET.tokensPerChar

/** 예산 안에 들어가도록 문서를 나눈다. 나누는 기준은 감이 아니라 위 실측이다. */
export function planBatches(docs, budget = BUDGET) {
  const batches = []
  let cur = []
  for (const d of docs) {
    const next = [...cur, d]
    const tooMany = next.length > budget.docsPerBatch
    const tooBig = estimateInputTokens(next) > budget.inputTokenCap
    if (cur.length && (tooMany || tooBig)) { batches.push(cur); cur = [d] } else { cur = next }
  }
  if (cur.length) batches.push(cur)
  return batches
}

/** 한 배치를 실제로 호출한다. 잘렸으면(MAX_TOKENS) 반으로 쪼개 다시 넣는다. */
async function extractOneBatch(docs, depth = 0) {
  // 작성자를 넣지 않는다. 추출에 쓰이지 않고, 프롬프트 원문이 화면과 저장소에 그대로 실린다.
  const body = docs.map((d) => `### ${d.docId}\n제목: ${d.title}\n본문:\n${d.text}`).join('\n\n')
  try {
    const { claims } = await generateJson({
      system: SYSTEM,
      prompt: `다음 문서들에서 수치 주장을 전부 뽑아라.\n\n${body}`,
      schema: SCHEMA,
    })
    return claims ?? []
  } catch (e) {
    // 🔴 출력이 잘린 걸 조용히 넘기면 「주장이 없다」로 집계된다. 쪼개서 다시 넣는다.
    if (e.code === 'MAX_TOKENS' && docs.length > 1 && depth < 4) {
      const mid = Math.ceil(docs.length / 2)
      process.stderr.write(`  ✂ 출력이 잘렸다 — ${docs.length}건을 ${mid}/${docs.length - mid} 로 쪼갠다\n`)
      return [...await extractOneBatch(docs.slice(0, mid), depth + 1),
              ...await extractOneBatch(docs.slice(mid), depth + 1)]
    }
    throw e
  }
}

/**
 * 문서 집합 → 게이트를 통과한 주장.
 * @returns {{claims, rejected, stats, batches}}
 */
export async function extractClaims(docs) {
  const byId = new Map(docs.map((d) => [d.docId, d]))
  const batches = planBatches(docs)

  const raw = []
  for (const b of batches) raw.push(...await extractOneBatch(b))

  const claims = []
  const rejected = []
  const stats = { raw: 0, tier1: 0, tier2: 0, misattributed: 0, unknownDoc: 0, byReason: {}, batches: batches.length }

  for (const c of raw) {
    stats.raw += 1
    const doc = byId.get(c.docId)
    if (!doc) {
      stats.unknownDoc += 1
      stats.byReason['없는 docId'] = (stats.byReason['없는 docId'] ?? 0) + 1
      rejected.push({ ...c, reason: '없는 docId' })
      continue
    }

    const v = checkClaim({ sourceText: doc.text, quote: c.quote, valueText: c.valueText })
    if (v.ok) {
      v.tier === '1차' ? (stats.tier1 += 1) : (stats.tier2 += 1)
      claims.push({ ...c, title: doc.title, url: doc.url, kind: doc.kind,
        claimId: `C${String(claims.length + 1).padStart(3, '0')}`, gateTier: v.tier })
      continue
    }

    // 인용이 이 문서엔 없는데 다른 문서엔 있다 → 오귀속. 배치가 만든 실패 모드다.
    const elsewhere = docs.find((d) => d.docId !== c.docId &&
      checkClaim({ sourceText: d.text, quote: c.quote, valueText: c.valueText }).ok)
    const reason = elsewhere ? `오귀속 (실제로는 ${elsewhere.docId})` : v.reason
    if (elsewhere) stats.misattributed += 1
    stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1
    rejected.push({ ...c, title: doc.title, reason })
  }

  return { claims, rejected, stats, batches: batches.map((b) => b.length) }
}
