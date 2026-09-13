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
          contexts: {
            type: 'array',
            description: '이 그룹 안에서 같은 조건으로 잰 값끼리 다시 묶은 것',
            items: {
              type: 'object',
              properties: {
                condition: { type: 'string', description: '그 조건을 원문 표현 그대로 짧게. 원문에 없으면 「조건 미기재」' },
                claimIds: { type: 'array', items: { type: 'string' } },
              },
              required: ['condition', 'claimIds'],
            },
          },
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
  '- 같은 종류를 세더라도 **센 자리가 다르면** 다른 그룹이다 — 다른 회의, 다른 기간, 다른 모집단.',
  '- 목표값과 측정값은 같은 지표로 묶는다. 어느 쪽인지는 이미 표시돼 있다.',
  '- 어느 그룹에도 안 들어가는 주장은 그대로 둔다. 억지로 묶지 않는다.',
  '- 주어진 claimId 만 쓴다. 없는 ID를 만들지 않는다.',
  '- 각 줄의 원문 구절을 보고 판단한다. 글쓴이가 수식어를 생략했어도 같은 것을 가리키면 같은 그룹이다.',
  '',
  '그리고 **각 그룹 안에서 같은 조건으로 잰 값끼리 다시 묶어라**(contexts).',
  '- 조건은 원문에 적힌 측정 방법·기준이다. 표현이 달라도 같은 조건을 가리키면 한 묶음이다.',
  '- 조건이 원문에 안 적힌 값이라도, **다른 글에 적힌 같은 측정을 옮겨 적은 것이 분명하면** 그 조건 묶음에 넣어라.',
  '  판단 근거는 원문뿐이다 — 같은 지표에 **같은 값**이고 한쪽에 조건이 적혀 있을 때다.',
  '- 그 밖의 값은 「조건 미기재」 한 묶음으로 모은다. **조건을 지어내지 않는다.**',
  '- **애매하면 미기재다.** 잘못 넣으면 근거 없는 값이 근거 있는 것으로 넘어간다.',
  '- 한 그룹의 claimId 는 정확히 한 묶음에만 들어간다. 그룹 밖 ID 를 넣지 않는다.',
].join('\n')

/**
 * 🔑 참조 게이트 — 판정이 가리킨 claimId 가 실재하는지 코드가 되짚는다.
 * 인용 게이트와 같은 원리다. 모델에게 「확실하냐」고 되묻지 않고, 코드가 볼 수 있는 사실만 본다.
 */
export async function clusterClaims(claims) {
  if (claims.length === 0) return { groups: [], dangling: [], ungrouped: [] }

  // 🔑 **한 주장은 한 줄이다.** 줄은 `|` 로 나뉘고 `\n` 으로 갈린다 — 그 두 글자가 필드 안에 들어오면
  //    주장 하나가 여러 줄로 갈라져 **없던 주장을 프롬프트에 심을 수 있다.**
  //    필드 값은 모델이 붙여넣은 글에서 뽑아 온 것이라 공격자가 고를 수 있다.
  //    참조 게이트가 「없는 claimId」는 걸러 주지만, 실재하는 id 에 남의 지표명을 붙이는 건 못 막는다.
  //    그래서 구분자를 필드에서 빼고 길이도 자른다.
  const cell = (v, max = 200) => String(v ?? '').replace(/[\r\n|]/g, ' ').slice(0, max)
  const lines = claims.map((c) =>
    `${cell(c.claimId, 12)} | ${cell(c.metric) || '-'} | ${cell(c.valueText, 40)}${cell(c.unit, 20)} | 범위:${cell(c.scope) || '없음'} | ${c.isTarget ? '목표' : '측정'}` +
    ` | 방법:${cell(c.method) || '원문에 없음'} | 「${cell(c.title)}」 | 원문: ${cell(c.quote, 400)}`
  )
  const { groups } = await generateJson({
    system: SYSTEM,
    prompt: `다음 수치 주장들을 같은 지표끼리 묶어라.\n\n${lines.join('\n')}`,
    schema: SCHEMA,
  })

  const known = new Set(claims.map((c) => c.claimId))
  const seen = new Set()
  const dangling = []      // 없는 ID를 가리킨 것
  const duplicated = []    // 두 그룹(또는 두 조건 묶음)에 동시에 들어간 것
  const outOfGroup = []    // 조건 묶음이 **제 그룹 밖** ID를 가리킨 것 — 없는 ID와는 다른 사건이다

  const clean = (groups ?? []).map((g) => {
    const ids = []
    for (const id of g.claimIds ?? []) {
      if (!known.has(id)) { dangling.push(id); continue }
      if (seen.has(id)) { duplicated.push(id); continue }
      seen.add(id); ids.push(id)
    }
    return { metric: g.metric, claimIds: ids, contexts: cleanContexts(g.contexts, ids, outOfGroup, duplicated) }
  }).filter((g) => g.claimIds.length > 0)

  const ungrouped = claims.filter((c) => !seen.has(c.claimId)).map((c) => c.claimId)
  return { groups: clean, dangling, duplicated, outOfGroup, ungrouped }
}

export const NO_CONDITION = '조건 미기재'

/**
 * 🔑 참조 게이트, 세 번째 — 조건 묶음에도 같은 대조를 건다.
 *
 * 그룹 밖 ID·없는 ID·한 그룹 안 중복 배정을 코드가 되짚고, **어느 묶음에도 안 들어간 값은
 * 「조건 미기재」로 모은다.** 판정이 그룹을 빠짐없이 덮어야 해서 분할이 전체를 덮어야 한다.
 *
 * ⚠️ 모델이 조건을 못 가르면 `contexts` 가 비어서 나온다. 그때는 **조건 축을 안 쓴 것과 같다** —
 *    판정이 예전 동작으로 떨어지고 화면은 그대로 산다.
 */
export function cleanContexts(contexts, groupIds, outOfGroup = [], duplicated = []) {
  if (!Array.isArray(contexts) || contexts.length === 0) return []
  const inGroup = new Set(groupIds)
  const placed = new Set()
  const out = []
  for (const c of contexts) {
    const ids = []
    for (const id of c?.claimIds ?? []) {
      if (!inGroup.has(id)) { outOfGroup.push(id); continue }
      if (placed.has(id)) { duplicated.push(id); continue }
      placed.add(id); ids.push(id)
    }
    if (ids.length) out.push({ condition: String(c?.condition ?? '').trim() || NO_CONDITION, claimIds: ids })
  }
  const left = groupIds.filter((id) => !placed.has(id))
  if (left.length) {
    const bucket = out.find((c) => c.condition === NO_CONDITION)
    if (bucket) bucket.claimIds.push(...left)
    else out.push({ condition: NO_CONDITION, claimIds: left })
  }
  return out
}
