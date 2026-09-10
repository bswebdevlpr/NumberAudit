import './_setup.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { flow, trace } = await import('../src/flow.js')

const stub = (payload, status = 200) => {
  global.fetch = async () => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

// 🔑 실측 함정: 플로우는 실패도 HTTP 200 으로 준다. res.ok 로 판정하면 조용히 통과한다.
test('실패는 HTTP 200 이어도 예외로 만든다', async () => {
  stub({ response: { success: false, code: 400, error: { code: 'VALIDATION_ERROR', message: '동일한 값' } } })
  await assert.rejects(() => flow.listProjects(), /VALIDATION_ERROR/)
})

test('성공은 data 를 돌려준다', async () => {
  stub({ response: { success: true, code: 200, data: { hasNext: false, lastCursor: 0, projects: [{ projectId: '1', title: 'a' }] } } })
  const out = await flow.listProjects()
  assert.equal(out.length, 1)
})

test('호출 흔적에 키를 남기지 않는다', async () => {
  trace.length = 0
  stub({ response: { success: true, code: 200, data: { projects: [], hasNext: false } } })
  await flow.listProjects()
  assert.equal(JSON.stringify(trace).includes('test-key'), false)
  assert.equal(trace[0].success, true)
})

test('JSON 이 아니면 사유를 밝히고 던진다', async () => {
  global.fetch = async () => new Response('<html>502</html>', { status: 502 })
  await assert.rejects(() => flow.listProjects(), /JSON 아님/)
})
