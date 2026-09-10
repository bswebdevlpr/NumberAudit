/**
 * 인용 **안쪽**에 노이즈가 끼면 게이트가 깨지나.
 *
 * flow 에 심은 노이즈판은 29/29 통과했다. 그런데 내가 넣은 노이즈는 대부분 문장 바깥에 붙었고,
 * 게이트의 1차 정규화가 공백류를 전부 지우므로 애초에 걸릴 수가 없었다.
 * 실제로 위험한 건 다른 모양이다 — **모델은 깨끗한 문장을 인용하는데 원문에는 노이즈가 박혀 있는** 경우.
 * (에디터에서 숫자만 굵게 하거나, 이모지를 문장 중간에 넣거나, 표 셀이 값을 감싸면 이렇게 된다)
 *
 * 그래서 저장된 주장의 인용을 그대로 두고, **원문 쪽 인용 구간 한가운데**에 노이즈 한 글자를 넣는다.
 * Gemini 호출 0회. 게이트만 바뀐다.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SYNTHETIC } from './docs.js'
import { checkClaim } from '../src/gate.js'

const here = dirname(fileURLToPath(import.meta.url))
const R2 = JSON.parse(readFileSync(resolve(here, 'out/result-round2.json'), 'utf8'))
const byId = new Map(SYNTHETIC.map((d) => [d.docId, d.text]))

/** 공백을 무시하고 원문에서 인용 구간 [start,end) 을 찾는다. */
function locate(source, quote) {
  const q = [...quote].filter((c) => !/\s/.test(c))
  if (!q.length) return null
  for (let s = 0; s < source.length; s++) {
    let i = s, k = 0
    while (i < source.length && k < q.length) {
      const c = source[i]
      if (/\s/.test(c)) { i++; continue }
      if (c !== q[k]) break
      i++; k++
    }
    if (k === q.length) return [s, i]
  }
  return null
}

const NOISES = [
  ['nbsp',    ' '],
  ['제로폭',   '​'],
  ['공백',     ' '],
  ['이모지',   '📌'],
  ['굵게(*)', '*'],
  ['표 구분자', '|'],
  ['줄바꿈',   '\n'],
]

const claims = [...R2.synthetic.claims, ...R2.synthetic.rejected]
const usable = []
for (const c of claims) {
  const src = byId.get(c.docId)
  if (!src) continue
  if (!checkClaim({ sourceText: src, quote: c.quote, valueText: c.valueText }).ok) continue  // 원래 통과하던 것만
  const at = locate(src, c.quote)
  if (at) usable.push({ c, src, at })
}

console.log(`■ 원래 통과하던 주장 ${usable.length}건 · 인용 구간 한가운데에 노이즈 1글자를 넣는다\n`)
console.log('노이즈'.padEnd(12) + '통과 / 대상   깨진 사유')
console.log('-'.repeat(56))

const table = []
for (const [name, ch] of NOISES) {
  let pass = 0
  const reasons = {}
  for (const { c, src, at } of usable) {
    const mid = Math.floor((at[0] + at[1]) / 2)
    const injected = src.slice(0, mid) + ch + src.slice(mid)
    const v = checkClaim({ sourceText: injected, quote: c.quote, valueText: c.valueText })
    if (v.ok) pass += 1
    else reasons[v.reason] = (reasons[v.reason] ?? 0) + 1
  }
  const why = Object.entries(reasons).map(([k, n]) => `${k} ${n}`).join(' · ') || '—'
  console.log(`${name.padEnd(12)}${String(pass).padStart(3)} / ${usable.length}      ${why}`)
  table.push({ noise: name, pass, total: usable.length, reasons })
}

console.log('\n갈리는 선: 게이트의 1차 정규화가 지우는 문자(공백·nbsp·제로폭·개행)냐 아니냐다.')
console.log('지우지 않는 문자가 인용 안쪽에 끼면 1차·2차 둘 다 못 넘는다.')
