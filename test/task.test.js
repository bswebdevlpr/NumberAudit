import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planTasks, workerIndex, TOOL_TITLE_PREFIX, KIND } from '../src/task.js'

const snap = {
  docs: [
    { docId: 'post:1', title: '[공지] 고객 공지 문구 초안', author: '기획자' },
    { docId: 'post:2', title: '[업무] 쿼리 프로파일링', author: '개발자' },
    { docId: 'post:3', title: '[회의록] 릴리스 판정', author: '팀장' },
  ],
  claims: [
    { claimId: 'F', docId: 'post:1', metric: '검색 응답시간', valueText: '250', unit: 'ms', method: '', isTarget: false, quote: '검색 응답 250ms로 개선', title: '[공지] 고객 공지 문구 초안' },
    { claimId: 'C', docId: 'post:2', metric: 'p95 응답시간', valueText: '820', unit: 'ms', method: '스테이징 · 동시 10', isTarget: false, quote: 'p95 820ms.', title: '[업무] 쿼리 프로파일링' },
    { claimId: 'D', docId: 'post:3', metric: 'p95 응답시간', valueText: '320', unit: 'ms', method: '', isTarget: false, quote: 'p95 320ms', title: '[회의록] 릴리스 판정' },
    { claimId: 'E', docId: 'post:2', metric: 'p95 응답시간', valueText: '320', unit: 'ms', method: '', isTarget: false, quote: 'p95 320ms 나왔습니다', title: '[업무] 쿼리 프로파일링' },
  ],
  verdicts: [
    { metric: 'p95 응답시간', claimIds: ['C', 'D', 'E'], unsourcedIds: [], disagreementIds: ['C', 'D', 'E'], targetIds: [] },
  ],
  byUnitIds: ['F'],
}

test('되돌릴 것이 없으면 업무도 없다', () => {
  assert.equal(planTasks({ docs: [], claims: [], verdicts: [], byUnitIds: [] }).length, 0)
})

test('근거 없음이 값 갈림보다 앞에 온다 — 먼저 볼 것이 먼저다', () => {
  const plans = planTasks(snap)
  assert.equal(plans[0].kind, KIND.UNSOURCED.code)
  assert.equal(plans[1].kind, KIND.CONFLICT.code)
})

test('제목은 도구 접두사로 시작한다 — 감사 대상에서 빼는 표식이다', () => {
  for (const p of planTasks(snap)) assert.ok(p.task.title.startsWith(TOOL_TITLE_PREFIX))
})

test('판정 종류가 우선순위와 마감으로 간다', () => {
  const [unsourced, conflict] = planTasks(snap)
  assert.equal(unsourced.task.priority, 'high')
  assert.equal(conflict.task.priority, 'normal')
  assert.match(unsourced.task.endDate, /^\d{8}$/)
  assert.ok(unsourced.task.endDate < conflict.task.endDate, '근거 없음이 더 급하다')
})

test('상태는 요청이다 — 확인해 달라는 것이지 진행이 아니다', () => {
  for (const p of planTasks(snap)) assert.equal(p.task.status, 'request')
})

test('하위업무는 값 하나가 한 건이다 — 같은 값이 두 글에 있어도 할 일은 하나다', () => {
  const conflict = planTasks(snap)[1]
  const titles = conflict.subtasks.map((s) => s.title)
  assert.equal(titles.length, 2, '820 과 320 두 건')
  assert.ok(titles.some((t) => t.startsWith('320ms') && t.includes('2곳')))
})

test('담당자는 그 수치를 쓴 사람이다 — 참여자 목록에 없으면 비운다', () => {
  const withWorker = planTasks(snap, { workers: workerIndex([{ name: '기획자', userId: 'a@b.c' }]) })
  assert.equal(withWorker[0].worker.name, '기획자')
  assert.equal(planTasks(snap)[0].worker, null, '못 찾으면 아무나 넣지 않는다')
})

test('계획은 어느 문서에서 나왔는지를 남긴다 — 담당자를 서버가 다시 정할 근거다', () => {
  const [p] = planTasks(snap)
  assert.deepEqual(p.docIds, ['post:1'])
})

test('계획에 계정 id 를 담지 않는다 — 스냅샷은 브라우저로 내려가고 저장소에도 들어간다', () => {
  const plans = planTasks(snap, { workers: workerIndex([{ name: '기획자', userId: 'a@b.c' }]) })
  assert.equal(JSON.stringify(plans).includes('a@b.c'), false)
})

test('본문에 인용이 들어간다 — 쓰기 전에 원문과 대조할 근거다', () => {
  const body = planTasks(snap)[0].task.contents
  assert.match(body, /인용: "검색 응답 250ms로 개선"/)
})

test('본문에 마크다운 표식을 쓰지 않는다 — 플로우에는 플레인으로 올라간다', () => {
  for (const p of planTasks(snap)) assert.equal(/\*\*/.test(p.task.contents), false)
})

test('2차 판정 업무는 견준 근거를 같이 적는다', () => {
  const body = planTasks(snap)[0].task.contents
  assert.match(body, /같은 단위\(ms\)로 「어떻게 쟀는지」가 적힌 값/)
  assert.match(body, /820ms/)
})
