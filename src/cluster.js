import { generateJson } from './gemini.js'

/**
 * ② 같은 지표끼리 묶는다 — 모델이 하는 자리.
 *
 * 코드로 해 봤고 졌다(라운드 1): 단위축으로 묶으면 `ms` 라는 이유만으로
 * 응답시간과 타임아웃 설정값이 한 그룹이 됐다. 오염 2건.
 * 모델은 오염 0건이었다. **지표 동일성 판단은 어휘가 아니라 의미다.**
 *
 * 다만 모델이 낸 그룹을 그대로 믿지는 않는다 — 아래 참조 게이트가 되짚는다.
 */

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

/**
 * ⚠️ 두 번째 줄은 실패를 보고 고친 것이다.
 * 첫 판은 같은 지표를 이름만 다르게 부른 것들을 **세 그룹으로 쪼갰다**(`p95 응답시간` /
 * `검색 API p95 응답시간` / `검색 응답 시간`). 쪼개지면 서로 대조할 상대가 없어져서
 * 「근거가 안 보이는 값」이 통째로 안 잡힌다.
 * 예시는 데모 데이터의 문구를 쓰지 않았다 — 그러면 이 표본에만 맞는 프롬프트가 된다.
 */
const SYSTEM = [
  '너는 여러 글에서 뽑은 수치 주장들을 「같은 지표끼리」 묶는 분류기다.',
  '- 같은 대상을 가리키면 **이름이 달라도 한 그룹**이다. 수식어가 붙거나 빠진 것, 줄여 부른 것,',
  '  띄어쓰기만 다른 것은 전부 같은 지표다. 이름이 아니라 **무엇을 잰 숫자인가**로 판단한다.',
  '- 반대로 단위가 같아도 잰 대상이 다르면 다른 그룹이다. 예: 응답시간과 타임아웃 설정값은 다르다.',
  '- 목표값과 측정값은 같은 지표로 묶는다. 어느 쪽인지는 이미 표시돼 있다.',
  '- 어느 그룹에도 안 들어가는 주장은 그대로 둔다. 억지로 묶지 않는다.',
  '- 주어진 claimId 만 쓴다. 없는 ID를 만들지 않는다.',
  '- 각 줄의 원문 구절을 보고 판단한다. 글쓴이가 수식어를 생략했어도 같은 것을 가리키면 같은 그룹이다.',
].join('\n')

/**
 * 🔑 참조 게이트 — 판정이 가리킨 claimId 가 실재하는지 코드가 되짚는다.
 * 인용 게이트와 같은 원리다. 모델에게 「확실하냐」고 되묻지 않고, 코드가 볼 수 있는 사실만 본다.
 */
export async function clusterClaims(claims) {
  if (claims.length === 0) return { groups: [], dangling: [], ungrouped: [] }

  const lines = claims.map((c) =>
    `${c.claimId} | ${c.metric ?? '-'} | ${c.valueText}${c.unit ?? ''} | 범위:${c.scope || '없음'} | ${c.isTarget ? '목표' : '측정'} | 「${c.title ?? ''}」 | 원문: ${c.quote}`
  )
  const { groups } = await generateJson({
    system: SYSTEM,
    prompt: `다음 수치 주장들을 같은 지표끼리 묶어라.\n\n${lines.join('\n')}`,
    schema: SCHEMA,
  })

  const known = new Set(claims.map((c) => c.claimId))
  const seen = new Set()
  const dangling = []      // 없는 ID를 가리킨 것
  const duplicated = []    // 두 그룹에 동시에 들어간 것

  const clean = (groups ?? []).map((g) => {
    const ids = []
    for (const id of g.claimIds ?? []) {
      if (!known.has(id)) { dangling.push(id); continue }
      if (seen.has(id)) { duplicated.push(id); continue }
      seen.add(id); ids.push(id)
    }
    return { metric: g.metric, claimIds: ids }
  }).filter((g) => g.claimIds.length > 0)

  const ungrouped = claims.filter((c) => !seen.has(c.claimId)).map((c) => c.claimId)
  return { groups: clean, dangling, duplicated, ungrouped }
}
