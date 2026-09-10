import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkClaim, MIN_CONTEXT_CHARS } from '../src/gate.js'

const SRC = '검색 API p95 응답시간이 현재 820ms입니다.\n목표는 300ms입니다.'

test('원문에 있는 인용과 값은 통과한다', () => {
  const v = checkClaim({ sourceText: SRC, quote: '검색 API p95 응답시간이 현재 820ms입니다.', valueText: '820' })
  assert.equal(v.ok, true)
  assert.equal(v.tier, '1차')
})

test('① 인용이 원문에 없으면 폐기한다 — 배치의 오귀속을 잡는 조건', () => {
  const v = checkClaim({ sourceText: SRC, quote: '응답시간이 현재 999ms입니다.', valueText: '999' })
  assert.equal(v.ok, false)
  assert.match(v.reason, /인용이 원문에 없음/)
})

test('② 값이 인용 안에 없으면 폐기한다 — 인용은 진짜인데 값을 지어낸 경우', () => {
  const v = checkClaim({ sourceText: SRC, quote: '목표는 300ms입니다.', valueText: '250' })
  assert.equal(v.ok, false)
  assert.match(v.reason, /값이 인용 안에 없음/)
})

test('③ 값만 인용하면 폐기한다 — 어느 문서 것인지 못 가린다', () => {
  const v = checkClaim({ sourceText: SRC, quote: '820', valueText: '820' })
  assert.equal(v.ok, false)
  assert.match(v.reason, /문맥/)
})

test(`문맥 하한은 ${MIN_CONTEXT_CHARS}자다 — 짧고 정당한 인용을 자르지 않는다`, () => {
  const src = '릴리스 여부를 논의했습니다. 참석 5명.'
  const v = checkClaim({ sourceText: src, quote: '참석 5명.', valueText: '5' })
  assert.equal(v.ok, true, '「참석 5명.」은 정당한 인용이다')
})

// 실제 flow 데이터에서 온 노이즈 — 에디터 글에 실재한다
test('공백류 노이즈는 인용 안쪽에 있어도 흡수한다', () => {
  for (const [name, ch] of [['공백', ' '], ['nbsp', ' '], ['제로폭', '​'], ['개행', '\n']]) {
    const noisy = SRC.replace('820ms', `820${ch}ms`)
    const v = checkClaim({ sourceText: noisy, quote: '검색 API p95 응답시간이 현재 820ms입니다.', valueText: '820' })
    assert.equal(v.ok, true, `${name} 는 흡수해야 한다`)
  }
})

test('비공백 노이즈가 인용 안쪽에 끼면 깨진다 — 알려진 경계', () => {
  for (const ch of ['📌', '*', '|']) {
    const noisy = SRC.replace('820ms', `820${ch}ms`)
    const v = checkClaim({ sourceText: noisy, quote: '검색 API p95 응답시간이 현재 820ms입니다.', valueText: '820' })
    assert.equal(v.ok, false, `${ch} 는 1차·2차 모두 못 넘는다`)
  }
})

test('빈 인용·빈 값은 폐기한다', () => {
  assert.equal(checkClaim({ sourceText: SRC, quote: '', valueText: '820' }).ok, false)
  assert.equal(checkClaim({ sourceText: SRC, quote: '목표는 300ms입니다.', valueText: '' }).ok, false)
})
