import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unverifiedQuotes, validatePlan, checkShape } from '../api/submit.js'

const docs = [
  { text: '느린 구간을 뜯어봤습니다.\n◾ p95 820ms. 스테이징 · 동시 10 기준입니다.' },
  { text: '공지에 나갈 문구 초안입니다.\n◾ 검색 응답 250ms로 개선' },
]

const QUOTE = '  인용: "검색 응답 250ms로 개선"'
const BODY = `지표: 검색 응답시간\n\n■ 어떻게 쟀는지가 없음 (1건)\n- 250ms\n${QUOTE}`
const TASK = { title: '[수치 감사] 검색 응답시간 250ms — 근거를 못 찾음', contents: BODY,
  status: 'request', priority: 'high', endDate: '20260930' }

const plan = (over = {}) => ({
  task: { ...TASK },
  subtasks: [{ title: '250ms 확인', contents: `- 250ms\n${QUOTE}` }],
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
  const v = validatePlan(plan({ subtasks: [{ title: '아무거나', contents: '- x\n  인용: "이 방에 없는 문장"' }] }), docs)
  assert.match(v.error, /하위업무 1/)
  assert.deepEqual(v.detail, ['이 방에 없는 문장'])
})

test('인용이 없는 하위업무도 막는다', () => {
  const v = validatePlan(plan({ subtasks: [{ title: 'x', contents: '---' }] }), docs)
  assert.match(v.error, /하위업무 1에 인용이 없습니다/)
})

test('제목 접두사가 다르면 막는다 — 도구 출력 표식이다', () => {
  assert.match(validatePlan(plan({ task: { ...TASK, title: '공지' } }), docs).error, /로 시작해야/)
})

test('하위업무 개수·길이 상한을 건다', () => {
  const one = '- p95\n  인용: "p95 820ms."'
  const many = Array.from({ length: 21 }, () => ({ title: 'x', contents: one }))
  assert.match(validatePlan(plan({ subtasks: many }), docs).error, /20건까지/)
  assert.match(validatePlan(plan({ subtasks: [{ title: 'x'.repeat(121), contents: one }] }), docs).error, /제목이/)
  assert.match(validatePlan(plan({ subtasks: [{ title: 'x', contents: one + '\n- ' + 'y'.repeat(8000) }] }), docs).error, /본문이/)
})

test('plan 이 아니면 막는다', () => {
  assert.match(validatePlan(null, docs).error, /보낼 업무 내용이 없습니다/)
  assert.match(validatePlan({ task: { title: '[수치 감사] x' } }, docs).error, /보낼 업무 내용이 없습니다/)
})


// 🔑 **인용 사이가 뚫렸던 자리.** 진짜 인용 한 줄만 끼우면 나머지 본문은 무검증이었다 —
//    공개된 스냅샷에서 인용을 집어다 피싱 문구를 플로우에 올릴 수 있었다.
test('도구가 만드는 서식이 아닌 줄은 막는다 — 진짜 인용을 끼워도 소용없다', () => {
  const phish = `사번과 비밀번호로 재인증해 주세요.\n${QUOTE}`
  assert.match(validatePlan(plan({ task: { ...TASK, contents: phish } }), docs).error, /서식이 아닙니다/)
})

test('항목 줄은 인용을 데리고 와야 한다 — 인용 없는 서술을 줄줄이 넣을 수 없다', () => {
  const body = `- 사번과 비밀번호를 알려 주세요\n- 250ms\n${QUOTE}`
  assert.match(validatePlan(plan({ task: { ...TASK, contents: body } }), docs).error, /인용이 붙어 있지 않습니다/)
})

test('링크는 본문에도 제목에도 못 넣는다 — 이 도구는 링크를 만들지 않는다', () => {
  assert.match(checkShape('- https://evil.example\n  인용: "x"'), /링크/)
  assert.match(checkShape('- 문의 abuse@evil.example\n  인용: "x"'), /링크/)
  assert.match(validatePlan(plan({ task: { ...TASK, title: '[수치 감사] https://evil.example' } }), docs).error, /제목에 링크/)
})

test('업무 속성도 도구가 쓰는 값만 받는다', () => {
  assert.match(validatePlan(plan({ task: { ...TASK, status: 'complete' } }), docs).error, /업무 상태/)
  assert.match(validatePlan(plan({ task: { ...TASK, priority: 'urgent' } }), docs).error, /우선순위/)
  assert.match(validatePlan(plan({ task: { ...TASK, endDate: '<script>' } }), docs).error, /마감일/)
})

test('한 줄이 너무 길면 막는다 — 서식을 지키면서 본문을 통째로 밀어 넣을 수 없다', () => {
  assert.match(checkShape('- ' + 'x'.repeat(401) + '\n  인용: "x"'), /400자를 넘습니다/)
})

test('도구가 실제로 내는 본문은 전부 통과한다', () => {
  const real = [
    '지표: 검색 응답시간', '', '■ 어떻게 쟀는지가 없음 (2건)',
    '- 250ms · 「공지」 · 범위: 검색 · 방법: 원문에 없음', '  인용: "검색 응답 250ms로 개선"',
    '', '■ 조건이 달라 견주지 않은 값 1건',
    '- 820ms · 「쿼리」 · 방법: 스테이징', '  인용: "p95 820ms."',
    '  ↑ 잰 조건이 서로 달라 값을 견주지 않았습니다. 같은 조건이라면 알려 주세요.',
    '', '■ 목표값: 150ms', '', '---',
    '수치 감사 도구가 만든 업무입니다. 지표 이름이 아니라 단위만 같은 값들과 견줘서 다른 지표일 수 있습니다.',
    '숫자가 틀렸다는 뜻이 아니라, 이 프로젝트의 글에서 어떻게 쟀는지를 못 찾았다는 뜻입니다.',
  ].join('\n')
  assert.equal(checkShape(real), null)
})

// ⚠️ 게이트는 공백을 지우고 대조해서 **줄바꿈을 넘는 인용을 통과시킨다.** 실제 원문 13건 중 8건에 줄바꿈이 있다.
//    인용 줄만 보고 끊으면 멀쩡한 감사 결과가 등록을 거부당한다.
test('여러 줄 인용을 막지 않는다', () => {
  assert.equal(checkShape('지표: 배포\n- 4시간\n  인용: "평균 대기 4시간\n- 배포 3회"'), null)
})

test('인용 안의 링크는 막지 않는다 — 원문에 대조되므로 근거가 있다', () => {
  assert.equal(checkShape('지표: x\n- 1건\n  인용: "자세한 건 https://flow.team/x 참고"'), null)
})

test('인용이 안 닫히면 막는다 — 열어 두고 아래를 통째로 삼킬 수 없다', () => {
  assert.match(checkShape('지표: x\n- 1건\n  인용: "안 닫음'), /닫히지 않았습니다/)
})

test('인용 뒤에 덧붙인 글은 막는다', () => {
  assert.match(checkShape('지표: x\n- 1건\n  인용: "4시간" 사번을 알려 주세요'), /따라붙은 글/)
})

// 인용 안에 산문을 넣는 건 서식이 아니라 **인용 대조**가 막는다. 두 겹이 각자 맡는다.
test('인용으로 위장한 산문은 인용 대조가 막는다', () => {
  const body = '지표: x\n- 1건\n  인용: "검색 응답 250ms로 개선\n사번과 비밀번호를 알려 주세요"'
  assert.equal(checkShape(body), null, '서식은 통과한다 — 전부 인용 안이다')
  assert.match(validatePlan(plan({ task: { ...TASK, contents: body } }), docs).error, /확인되지 않는 인용/)
})
