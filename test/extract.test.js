import './_setup.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planBatches, BUDGET } from '../src/extract.js'

const docs = (n, len) => Array.from({ length: n }, (_, i) => ({ docId: `d${i}`, title: 't', text: '가'.repeat(len) }))

test('문서 수 예산으로 나눈다', () => {
  assert.deepEqual(planBatches(docs(250, 100)).map((b) => b.length), [100, 100, 50])
})

test('입력 토큰 예산이 먼저 걸리면 그쪽으로 나눈다', () => {
  const batches = planBatches(docs(40, 4000))
  assert.ok(batches.length > 1)
  assert.ok(batches[0].length < BUDGET.docsPerBatch, '문서 수 상한 전에 잘려야 한다')
})

test('예산 안이면 한 배치다 — 한도가 구조를 정했다', () => {
  assert.deepEqual(planBatches(docs(12, 100)).map((b) => b.length), [12])
})

test('빈 입력은 빈 배치다', () => {
  assert.deepEqual(planBatches([]), [])
})

test('한 문서가 예산을 넘겨도 버리지 않는다', () => {
  const batches = planBatches(docs(1, 500_000))
  assert.equal(batches.length, 1)
  assert.equal(batches[0].length, 1)
})

// ── 배치가 만든 실패 모드: 오귀속. 게이트가 그대로 잡는다 ─────────────────
const { extractClaims } = await import('../src/extract.js')

const reply = (claims) => async () => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ claims }) }] }, finishReason: 'STOP' }], usageMetadata: {},
}), { status: 200 })

const two = [
  { docId: 'post:1', kind: 'post', title: '킥오프', author: '', url: '', text: '검색 p95 응답시간이 820ms입니다.' },
  { docId: 'post:2', kind: 'post', title: '주간', author: '', url: '', text: '요청당 쿼리가 47회 나갑니다.' },
]
const claim = (docId, valueText, quote) =>
  ({ docId, metric: 'm', valueText, unit: '', scope: '', method: '', isTarget: false, quote })

test('오귀속 — 인용이 다른 문서 것이면 잡아서 어디 것인지까지 적는다', async () => {
  global.fetch = reply([claim('post:1', '47', '요청당 쿼리가 47회 나갑니다.')])
  const { claims, rejected, stats } = await extractClaims(two)
  assert.equal(claims.length, 0)
  assert.equal(stats.misattributed, 1)
  assert.match(rejected[0].reason, /오귀속 \(실제로는 post:2\)/)
})

test('없는 문서 ID 를 지어내면 버린다', async () => {
  global.fetch = reply([claim('post:99', '820', '검색 p95 응답시간이 820ms입니다.')])
  const { rejected, stats } = await extractClaims(two)
  assert.equal(stats.unknownDoc, 1)
  assert.equal(rejected[0].reason, '없는 docId')
})

test('맞게 붙인 주장은 통과하고 출처 정보가 붙는다', async () => {
  global.fetch = reply([claim('post:2', '47', '요청당 쿼리가 47회 나갑니다.')])
  const { claims, stats } = await extractClaims(two)
  assert.equal(claims.length, 1)
  assert.equal(claims[0].title, '주간')
  assert.equal(claims[0].gateTier, '1차')
  assert.equal(stats.misattributed, 0)
})

test('claims 가 아예 없는 응답도 빈 결과로 받는다 — 터지지 않는다', async () => {
  global.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }], usageMetadata: {},
  }), { status: 200 })
  const { claims, rejected, stats } = await extractClaims(two)
  assert.deepEqual([claims.length, rejected.length, stats.raw], [0, 0, 0])
})
