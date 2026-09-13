import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crossSite, clientIp } from '../api/_lib.js'

const req = (headers) => ({ headers })

test('같은 출처는 통과한다', () => {
  assert.equal(crossSite(req({ origin: 'https://x.vercel.app', host: 'x.vercel.app' })), null)
})
test('Origin 이 없으면 통과한다 — 브라우저가 아니다(curl·CLI)', () => {
  assert.equal(crossSite(req({ host: 'x.vercel.app' })), null)
})
test('다른 사이트에서 온 브라우저 요청은 막는다', () => {
  assert.match(crossSite(req({ origin: 'https://evil.example', host: 'x.vercel.app' })), /다른 사이트/)
})
test('프록시 뒤 호스트도 본다', () => {
  assert.equal(crossSite(req({ origin: 'https://x.app', host: 'internal', 'x-forwarded-host': 'x.app' })), null)
})
test('Origin 이 URL 이 아니면 막는다', () => {
  assert.match(crossSite(req({ origin: 'null', host: 'x.app' })), /다른 사이트/)
})

test('프록시가 넣는 값을 먼저 쓴다 — 요청자가 못 정하는 값이다', () => {
  assert.equal(clientIp(req({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })), '2.2.2.2')
})
test('x-forwarded-for 밖에 없으면 맨 뒤를 쓴다 — 앞쪽은 요청자가 채울 수 있다', () => {
  assert.equal(clientIp(req({ 'x-forwarded-for': '9.9.9.9, 2.2.2.2' })), '2.2.2.2')
})
test('헤더가 없으면 local', () => {
  assert.equal(clientIp(req({})), 'local')
})
