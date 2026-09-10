import { generateJson } from '../src/gemini.js'

const SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          metric: { type: 'string', description: '이 그룹이 가리키는 지표를 짧은 명사구로' },
          claimIds: { type: 'array', items: { type: 'string' }, description: '이 지표에 속하는 주장 ID' },
        },
        required: ['metric', 'claimIds'],
      },
    },
  },
  required: ['groups'],
}

const SYSTEM = [
  '너는 여러 글에서 뽑은 수치 주장들을 「같은 지표끼리」 묶는 분류기다.',
  '- 단위가 같아도 지표가 다르면 다른 그룹이다. 예: 응답시간과 타임아웃 설정값은 다르다.',
  '- 목표값과 측정값은 같은 지표로 묶는다. 어느 쪽인지는 이미 표시돼 있다.',
  '- 어느 그룹에도 안 들어가는 주장은 그대로 둔다. 억지로 묶지 않는다.',
  '- 주어진 claimId 만 쓴다. 없는 ID를 만들지 않는다.',
].join('\n')

/** 참조 게이트 — 판정이 가리킨 claimId 가 실재하는지 코드가 되짚는다. */
export async function clusterClaims(claims) {
  const lines = claims.map((c) =>
    `${c.claimId} | ${c.metric ?? '-'} | ${c.valueText} | 조건:${c.condition || '없음'} | ${c.isTarget ? '목표' : '측정'} | 출처:${c.docId}`
  )
  const { groups } = await generateJson({
    system: SYSTEM,
    prompt: `다음 수치 주장들을 같은 지표끼리 묶어라.\n\n${lines.join('\n')}`,
    schema: SCHEMA,
  })

  const known = new Set(claims.map((c) => c.claimId))
  const dangling = []
  const clean = (groups ?? []).map((g) => {
    const ids = []
    for (const id of g.claimIds ?? []) (known.has(id) ? ids : dangling).push(id)
    return { metric: g.metric, claimIds: ids }
  }).filter((g) => g.claimIds.length > 0)

  return { groups: clean, dangling }
}
