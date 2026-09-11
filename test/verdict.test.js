import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findUnsourced, findUnsourcedByUnit, findDisagreement, findCrossContext, judgeRoom } from '../src/verdict.js'

const c = (claimId, valueText, unit, method = '', isTarget = false, metric = 'p95 응답시간') =>
  ({ claimId, valueText, unit, method, isTarget, metric })

// 데모의 핵심 사례를 그대로 재현한다
const ROOM = [
  c('A', '820', 'ms'),                                     // 킥오프 — 방법 없음
  c('B', '300', 'ms', '', true),                           // 목표
  c('C', '820', 'ms', '스테이징 · 동시 10'),                  // 같은 값 + 방법
  c('D', '320', 'ms', '스테이징 · 동시 10'),
  c('E', '280', 'ms', '캐시 워밍 후 3회 평균'),
  c('F', '250', 'ms', '', false, '검색 응답시간'),            // 공지 초안 — 근거 없음
  c('G', '99', '%'),                                       // 커버리지 — 같은 단위에 방법 있는 값이 없다
  c('H', '96.4', '%'),
]

test('1차 — 같은 그룹에서 방법이 적힌 값이 있는데 이 값만 없으면 걸린다', () => {
  const group = [ROOM[0], ROOM[2], ROOM[3]]   // 820(방법없음) · 820(방법) · 320(방법)
  const out = findUnsourced(group)
  assert.equal(out.length, 0, '같은 값이 방법과 함께 어딘가 있으면 걸리지 않는다')
})

test('1차 — 목표값은 대상이 아니다', () => {
  assert.equal(findUnsourced([c('x', '300', 'ms', '', true), c('y', '320', 'ms', '스테이징')]).length, 0)
})

test('1차 — 그룹에 방법이 하나도 없으면 걸리지 않는다', () => {
  assert.equal(findUnsourced([ROOM[6], ROOM[7]]).length, 0, '아무도 방법을 안 적은 지표를 통째로 걸면 안 된다')
})

test('2차 — 그룹이 갈려도 같은 단위로 견줘 잡는다', () => {
  const out = findUnsourcedByUnit(ROOM)
  assert.deepEqual(out.map((x) => x.claimId), ['F'], '250ms 하나만 걸려야 한다')
})

test('2차 — 같은 단위에 방법 있는 값이 없으면 걸리지 않는다', () => {
  const out = findUnsourcedByUnit([ROOM[6], ROOM[7]])
  assert.equal(out.length, 0, '99% · 96.4% 는 견줄 상대가 없다')
})

test('2차 — 1차가 이미 잡은 것은 다시 잡지 않는다', () => {
  const out = findUnsourcedByUnit(ROOM, new Set(['F']))
  assert.equal(out.length, 0)
})

test('값이 갈리는지는 측정값만 본다 — 목표는 갈림이 아니다', () => {
  assert.equal(findDisagreement([c('x', '320', 'ms'), c('y', '300', 'ms', '', true)]).length, 0)
  assert.equal(findDisagreement([c('x', '320', 'ms'), c('y', '820', 'ms')]).length, 2)
})

test('1,200 과 1200 은 같은 값으로 센다', () => {
  assert.equal(findDisagreement([c('x', '1,200', '개'), c('y', '1200', '개')]).length, 0)
})

test('방 전체 판정 — 1차 다음에 2차를 돌린다', () => {
  const groups = [
    { metric: 'p95 응답시간', claimIds: ['A', 'B', 'C', 'D', 'E'] },
    { metric: '검색 응답시간', claimIds: ['F'] },
    { metric: '커버리지', claimIds: ['G', 'H'] },
  ]
  const { verdicts, byUnit } = judgeRoom(ROOM, groups)
  assert.equal(verdicts.flatMap((v) => v.unsourced).length, 0, '1차로는 안 잡힌다 — 그룹이 갈려 있다')
  assert.deepEqual(byUnit.map((x) => x.claimId), ['F'])
})


// ── 조건 축 — 잰 방법이 다르면 견주지 않는다 ────────────────────────────────
const MS = [c('C', '820', 'ms', '스테이징 · 동시 10'), c('D', '320', 'ms', '스테이징 · 동시 10'),
            c('E', '280', 'ms', '캐시 워밍 후 3회 평균')]
const CTX = [
  { condition: '스테이징 · 동시 10', claimIds: ['C', 'D'] },
  { condition: '캐시 워밍 후 3회 평균', claimIds: ['E'] },
]

test('조건이 같은 값끼리만 갈림으로 센다 — 320 과 280 은 견줄 수 없다', () => {
  const ids = findDisagreement(MS, CTX).map((x) => x.claimId).sort()
  assert.deepEqual(ids, ['C', 'D'])            // 같은 조건의 820·320 만
})

test('조건이 달라 견주지 않은 값은 지우지 않고 따로 담는다', () => {
  assert.deepEqual(findCrossContext(MS, CTX).map((x) => x.claimId), ['E'])
})

test('조건 묶음이 없으면 예전 동작 그대로다 — 화면이 죽지 않는다', () => {
  assert.equal(findDisagreement(MS).length, 3)
  assert.equal(findCrossContext(MS, []).length, 0)
})

test('조건이 하나뿐이면 갈림 판정이 그대로 선다', () => {
  const one = [{ condition: '스테이징 · 동시 10', claimIds: ['C', 'D'] }]
  assert.equal(findDisagreement(MS.slice(0, 2), one).length, 2)
  assert.equal(findCrossContext(MS.slice(0, 2), one).length, 0)
})

// ── 값 + 단위 — 모델이 단위를 값에 같이 넣어도 두 번 붙지 않는다 ──────────────
test('valueText 에 단위가 이미 들어 있으면 다시 붙이지 않는다', async () => {
  const { valueLabel, valueKey } = await import('../src/value.js')
  assert.equal(valueLabel({ valueText: '320', unit: 'ms' }), '320ms')
  assert.equal(valueLabel({ valueText: '320ms', unit: 'ms' }), '320ms')   // 실측: 실행마다 흔들린다
  assert.equal(valueLabel({ valueText: '42', unit: '' }), '42')
  assert.equal(valueKey({ valueText: '1,284', unit: '케이스' }), '1284케이스')
})

// ── 참조 게이트 ③ — 조건 묶음도 코드가 되짚는다 ─────────────────────────────
test('조건 묶음의 그룹 밖 ID·중복 배정을 걸러내고, 남은 값은 「조건 미기재」로 모은다', async () => {
  const { cleanContexts, NO_CONDITION } = await import('../src/cluster.js')
  const out = [], dup = []
  const got = cleanContexts([
    { condition: '캐시 미적용', claimIds: ['A', 'ZZZ', 'B'] },   // ZZZ 는 이 그룹에 없다
    { condition: '캐시 워밍', claimIds: ['B', 'C'] },            // B 는 이미 배정됐다
  ], ['A', 'B', 'C', 'D'], out, dup)
  assert.deepEqual(out, ['ZZZ'])
  assert.deepEqual(dup, ['B'])
  assert.deepEqual(got, [
    { condition: '캐시 미적용', claimIds: ['A', 'B'] },
    { condition: '캐시 워밍', claimIds: ['C'] },
    { condition: NO_CONDITION, claimIds: ['D'] },                // 어디에도 안 든 값
  ])
})

test('조건 묶음이 비면 분할을 만들지 않는다 — 예전 동작으로 떨어진다', async () => {
  const { cleanContexts } = await import('../src/cluster.js')
  assert.deepEqual(cleanContexts([], ['A', 'B']), [])
  assert.deepEqual(cleanContexts(undefined, ['A', 'B']), [])
})

test('조건이 안 적힌 값은 「조건이 다르다」로 말하지 않는다 — 모르는 것이지 다른 것이 아니다', async () => {
  const { NO_CONDITION } = await import('../src/cluster.js')
  const m = (id, v, meth = '') => ({ claimId: id, valueText: v, unit: 'ms', method: meth, isTarget: false, metric: 'X' })
  const cs = [m('A', '320', '캐시 미적용'), m('B', '820', '캐시 미적용'), m('C', '500')]
  const ctx = [{ condition: '캐시 미적용', claimIds: ['A', 'B'] }, { condition: NO_CONDITION, claimIds: ['C'] }]
  assert.deepEqual(findDisagreement(cs, ctx).map((x) => x.claimId), ['A', 'B'])
  assert.deepEqual(findCrossContext(cs, ctx).map((x) => x.claimId), [])   // C 는 여기 안 온다
})
