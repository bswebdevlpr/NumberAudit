import './_setup.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.GEMINI_MODEL = 'model-a,model-b'
const { generateJson, usage, trace } = await import('../src/gemini.js')

const SCHEMA = { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] }
const ok = (text) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: {} })
const err = (status, message, details = []) => ({ error: { status, message, details } })
const dailyQuota = () => err('RESOURCE_EXHAUSTED', 'quota', [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
  { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '46s' },
])

const route = (fn) => { global.fetch = async (url, init) => new Response(JSON.stringify(fn(String(url), init)), { status: 200 }) }

test('스키마대로 JSON 을 돌려준다', async () => {
  route(() => ok('{"n":1}'))
  assert.deepEqual(await generateJson({ prompt: 'x', schema: SCHEMA }), { n: 1 })
})

// 🔑 실측: 일일 소진에도 서버는 retryDelay 46s 를 준다. 그 말을 믿고 5회 기다려 5분을 태운 적이 있다.
test('일일 한도는 기다리지 않고 다음 모델로 내려간다', async () => {
  const before = usage.retries
  route((url) => (url.includes('model-a') ? dailyQuota() : ok('{"n":2}')))
  const t0 = Date.now()
  assert.deepEqual(await generateJson({ prompt: 'x', schema: SCHEMA }), { n: 2 })
  assert.equal(usage.retries - before, 0, '재시도하지 않아야 한다')
  assert.ok(Date.now() - t0 < 1000, '대기 없이 폴백해야 한다')
})

// 🔑 출력이 잘린 걸 조용히 넘기면 「주장이 없다」로 집계된다. 호출부가 배치를 쪼갤 수 있어야 한다.
test('MAX_TOKENS 는 코드를 달아 던진다', async () => {
  global.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '{"n":' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: {},
  }), { status: 200 })
  await assert.rejects(() => generateJson({ prompt: 'x', schema: SCHEMA }), (e) => e.code === 'MAX_TOKENS')
})

test('빈 응답은 실패가 아니라 무효다', async () => {
  route(() => ({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }], usageMetadata: {} }))
  await assert.rejects(() => generateJson({ prompt: 'x', schema: SCHEMA }), /빈 응답/)
})

test('진짜 오류는 삼키지 않는다 — 폴백으로 감추면 원인이 사라진다', async () => {
  route(() => err('INVALID_ARGUMENT', '스키마가 틀렸다'))
  await assert.rejects(() => generateJson({ prompt: 'x', schema: SCHEMA }), /INVALID_ARGUMENT/)
})

test('프롬프트와 응답 원문을 남긴다 — 화면이 그대로 편다', async () => {
  trace.length = 0
  route(() => ok('{"n":3}'))
  await generateJson({ system: '시스템', prompt: '프롬프트', schema: SCHEMA })
  assert.equal(trace.at(-1).system, '시스템')
  assert.equal(trace.at(-1).response, '{"n":3}')
})

test('키를 흔적에 남기지 않는다', async () => {
  trace.length = 0
  route(() => ok('{"n":4}'))
  await generateJson({ prompt: 'test-key 가 섞인 프롬프트', schema: SCHEMA })
  assert.equal(JSON.stringify(trace).includes('test-key'), false)
})

test('JSON 이 아닌 응답은 스키마 위반으로 던진다 — 조용히 빈 결과로 만들지 않는다', async () => {
  route(() => ok('여기 응답이 있습니다: {n:1}'))
  await assert.rejects(() => generateJson({ prompt: 'x', schema: SCHEMA }), /스키마 위반 응답/)
})

test('스키마를 요청 몸통에 실어 보낸다 — 형태 강제는 서버에서 먼저 건다', async () => {
  let sent
  global.fetch = async (url, init) => {
    sent = JSON.parse(init.body)
    return new Response(JSON.stringify(ok('{"n":5}')), { status: 200 })
  }
  await generateJson({ prompt: 'x', schema: SCHEMA })
  assert.equal(sent.generationConfig.responseMimeType, 'application/json')
  assert.deepEqual(sent.generationConfig.responseSchema, SCHEMA)
  assert.equal(sent.generationConfig.temperature, 0)
})
