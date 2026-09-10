import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unverifiedQuotes, validatePlan } from '../api/submit.js'

const docs = [
  { text: '느린 구간을 뜯어봤습니다.\n◾ p95 820ms. 스테이징 · 동시 10 기준입니다.' },
  { text: '공지에 나갈 문구 초안입니다.\n◾ 검색 응답 250ms로 개선' },
]

const plan = (over = {}) => ({
  task: { title: '[수치 감사] 검색 응답시간 250ms — 근거를 못 찾음', contents: '인용: "검색 응답 250ms로 개선"' },
  subtasks: [{ title: '250ms 확인', contents: '인용: "검색 응답 250ms로 개선"' }],
  ...over,
})

test('원문에 있는 인용만 통과시킨다 — 내 키로 쓰기 때문에 클라이언트를 믿지 않는다', () => {
  assert.deepEqual(unverifiedQuotes('인용: "p95 820ms."', docs).unverified, [])
})

test('원문에 없는 인용은 걸러낸다', () => {
  assert.deepEqual(unverifiedQuotes('인용: "p95 999ms."', docs).unverified, ['p95 999ms.'])
})

test('공백 차이는 통과시킨다 — 게이트와 같은 정규화를 쓴다', () => {
  assert.deepEqual(unverifiedQuotes('인용: "p95  820ms."', docs).unverified, [])
})

test('정상 계획은 통과하고 인용 수를 센다', () => {
  const v = validatePlan(plan(), docs)
  assert.equal(v.error, undefined)
  assert.equal(v.quotes, 2, '업무 본문과 하위업무 본문 둘 다 센다')
})

// 🔑 한 번 뚫렸던 자리. 업무 본문만 검사하면 실제 내용의 대부분인 하위업무가 무방비다.
test('하위업무 본문도 검증한다 — 제목만 맞추고 하위업무로 아무거나 올릴 수 없다', () => {
  const v = validatePlan(plan({ subtasks: [{ title: '아무거나', contents: '인용: "이 방에 없는 문장"' }] }), docs)
  assert.match(v.error, /하위업무 1/)
  assert.deepEqual(v.detail, ['이 방에 없는 문장'])
})

test('인용이 없는 하위업무도 막는다', () => {
  const v = validatePlan(plan({ subtasks: [{ title: 'x', contents: '그냥 텍스트' }] }), docs)
  assert.match(v.error, /하위업무 1에 인용이 없다/)
})

test('제목 접두사가 다르면 막는다 — 도구 출력 표식이다', () => {
  assert.match(validatePlan(plan({ task: { title: '공지', contents: '인용: "p95 820ms."' } }), docs).error, /로 시작해야/)
})

test('하위업무 개수·길이 상한을 건다', () => {
  const many = Array.from({ length: 21 }, () => ({ title: 'x', contents: '인용: "p95 820ms."' }))
  assert.match(validatePlan(plan({ subtasks: many }), docs).error, /20건까지/)
  assert.match(validatePlan(plan({ subtasks: [{ title: 'x'.repeat(121), contents: '인용: "p95 820ms."' }] }), docs).error, /제목이/)
  assert.match(validatePlan(plan({ subtasks: [{ title: 'x', contents: '인용: "p95 820ms."' + 'y'.repeat(8000) }] }), docs).error, /본문이/)
})

test('plan 이 아니면 막는다', () => {
  assert.match(validatePlan(null, docs).error, /plan 이 없다/)
  assert.match(validatePlan({ task: { title: '[수치 감사] x' } }, docs).error, /plan 이 없다/)
})
