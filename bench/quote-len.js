import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SYNTHETIC, EXTERNAL } from './docs.js'

/**
 * MIN_QUOTE_LEN 을 감으로 두지 않는다. 분포를 재고 정한다.
 *
 * 하한이 막으려는 것: 너무 짧은 인용이 **우연히** 원문에 포함되는 것.
 * 그래서 두 가지를 잰다 —
 *   ① 실제 인용의 길이 분포 (하한이 정당한 인용을 자르나)
 *   ② 길이별 우연 일치율 (짧은 문자열이 아무 문서에나 들어맞나)
 */
const here = dirname(fileURLToPath(import.meta.url))
const R1 = JSON.parse(readFileSync(resolve(here, 'out/result.json'), 'utf8'))
const R2 = JSON.parse(readFileSync(resolve(here, 'out/result-round2.json'), 'utf8'))
const DOCS = [...SYNTHETIC, ...EXTERNAL]
const tight = (s) => String(s ?? '').replace(/\s+/g, '')

const quotes = [
  ...R1.gemini.claims, ...R1.gemini.rejected,
  ...(R1.external?.claims ?? []), ...(R1.external?.rejected ?? []),
  ...R2.synthetic.claims, ...R2.synthetic.rejected,
  ...R2.external.claims, ...R2.external.rejected,
].map((c) => ({ len: tight(c.quote).length, docId: c.docId, quote: c.quote }))

console.log('='.repeat(60))
console.log('MIN_QUOTE_LEN — 감으로 둔 6 을 데이터로 다시 본다')
console.log('='.repeat(60))

console.log(`\n■ 실제 인용 ${quotes.length}건의 길이 분포 (공백 제거)`)
const lens = quotes.map((q) => q.len).sort((a, b) => a - b)
const q = (p) => lens[Math.floor((lens.length - 1) * p)]
console.log(`  최소 ${lens[0]} · p10 ${q(0.1)} · 중앙 ${q(0.5)} · p90 ${q(0.9)} · 최대 ${lens.at(-1)}`)
const short = quotes.filter((x) => x.len < 12).sort((a, b) => a.len - b.len)
console.log(`  12자 미만 ${short.length}건:`)
for (const x of short) console.log(`    ${String(x.len).padStart(2)}자  ${JSON.stringify(x.quote)}  @${x.docId}`)

// ② 길이별 우연 일치 — 원문에서 n자를 잘라 「다른 문서」에도 들어맞는 비율
console.log('\n■ 길이별 우연 일치율 — n자 조각이 다른 문서에도 들어맞나')
console.log('  (원문에서 모든 n자 조각을 잘라, 그중 다른 문서에도 있는 비율)')
const bodies = DOCS.map((d) => ({ id: d.docId, t: tight(d.text) }))
for (const n of [2, 3, 4, 5, 6, 8, 10, 12]) {
  let total = 0, collide = 0
  for (const b of bodies) {
    for (let i = 0; i + n <= b.t.length; i++) {
      const frag = b.t.slice(i, i + n)
      total += 1
      if (bodies.some((o) => o.id !== b.id && o.t.includes(frag))) collide += 1
    }
  }
  const bar = '█'.repeat(Math.round((collide / total) * 40))
  console.log(`  ${String(n).padStart(2)}자  ${((collide / total) * 100).toFixed(1).padStart(5)}%  ${bar}`)
}

// ③ 진짜 물음 — 「값을 포함한 인용」이 다른 문서에도 우연히 들어맞나
// 조건 ②(valueText 가 quote 안에 있어야 한다)가 이미 걸려 있으므로,
// 길이 하한이 막아야 할 나머지는 이것뿐이다.
console.log('\n■ 실제 인용이 다른 문서에도 들어맞나 — 조건 ② 통과분만')
const all = [
  ...R1.gemini.claims, ...(R1.external?.claims ?? []),
  ...R2.synthetic.claims, ...R2.external.claims,
]
let cross = 0
for (const c of all) {
  const qt = tight(c.quote)
  const others = bodies.filter((b) => b.id !== c.docId && b.t.includes(qt))
  if (others.length) {
    cross += 1
    console.log(`  🔴 ${String(qt.length).padStart(2)}자 ${JSON.stringify(c.quote)} @${c.docId} → 또 있음: ${others.map((o) => o.id).join(', ')}`)
  }
}
console.log(`  통과 인용 ${all.length}건 중 다른 문서에도 들어맞는 것: ${cross}건`)

// ④ 하한을 바꾸면 무엇이 잘리나
console.log('\n■ 하한별로 잘리는 정당한 인용')
for (const n of [0, 4, 5, 6, 8, 10]) {
  const cut = all.filter((c) => tight(c.quote).length < n)
  console.log(`  하한 ${String(n).padStart(2)}  잘림 ${String(cut.length).padStart(2)}건  ${cut.map((c) => JSON.stringify(c.quote)).join(' ') || '—'}`)
}

// ⑤ 절대 길이가 아니라 **문맥의 양**으로 보면 어떤가
//    quote 가 값 그 자체면(예: "3회") 우연 일치가 가능하다. 값 주변에 문맥이 있어야 한다.
console.log('\n■ 문맥의 양 = 인용 길이 − 값 길이')
const everything = [
  ...R1.gemini.claims, ...R1.gemini.rejected, ...(R1.external?.claims ?? []),
  ...R2.synthetic.claims, ...R2.synthetic.rejected, ...R2.external.claims,
].filter((c) => c.quote && c.valueText)
const ctx = everything.map((c) => ({
  ctx: tight(c.quote).length - tight(c.valueText).length,
  quote: c.quote, value: c.valueText, docId: c.docId,
})).sort((a, b) => a.ctx - b.ctx)
console.log(`  최소 ${ctx[0].ctx} · 중앙 ${ctx[Math.floor(ctx.length / 2)].ctx} · 최대 ${ctx.at(-1).ctx}`)
console.log('  문맥 5자 미만:')
for (const x of ctx.filter((x) => x.ctx < 5)) console.log(`    문맥 ${String(x.ctx).padStart(2)}자  값=${JSON.stringify(x.value)} 인용=${JSON.stringify(x.quote)} @${x.docId}`)

// 값만 있는 인용이 다른 문서에 우연히 있나
console.log('\n  값 자체(문맥 0)를 원문에서 찾으면 몇 개 문서에 있나:')
for (const v of ['3회', '47회', '320', '99%', '9월 13일']) {
  const inDocs = bodies.filter((b) => b.t.includes(tight(v))).map((b) => b.id)
  console.log(`    ${v.padEnd(10)}${inDocs.length}개 문서 — ${inDocs.join(', ')}`)
}
