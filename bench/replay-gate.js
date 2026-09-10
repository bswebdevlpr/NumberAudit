import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SYNTHETIC, EXTERNAL } from './docs.js'
import { checkClaim } from '../src/gate.js'

/** 저장된 주장 전부에 새 게이트를 다시 돌린다. Gemini 를 부르지 않는다 — 게이트만 바뀐 걸 검증할 수 있다. */
const here = dirname(fileURLToPath(import.meta.url))
const R1 = JSON.parse(readFileSync(resolve(here, 'out/result.json'), 'utf8'))
const R2 = JSON.parse(readFileSync(resolve(here, 'out/result-round2.json'), 'utf8'))
const byId = new Map([...SYNTHETIC, ...EXTERNAL].map((d) => [d.docId, d.text]))

const sets = [
  ['라운드1 합성', [...R1.gemini.claims, ...R1.gemini.rejected]],
  ['라운드1 외부', [...(R1.external?.claims ?? []), ...(R1.external?.rejected ?? [])]],
  ['라운드2 합성', [...R2.synthetic.claims, ...R2.synthetic.rejected]],
  ['라운드2 외부', [...R2.external.claims, ...R2.external.rejected]],
]

console.log('='.repeat(60))
console.log('새 게이트 재생 — 길이 하한 → 문맥 하한')
console.log('='.repeat(60))
let flipped = []
for (const [name, claims] of sets) {
  const stat = { pass: 0, tier1: 0, tier2: 0, reasons: {} }
  for (const c of claims) {
    const src = byId.get(c.docId)
    if (!src) { stat.reasons['없는 docId'] = (stat.reasons['없는 docId'] ?? 0) + 1; continue }
    const v = checkClaim({ sourceText: src, quote: c.quote, valueText: c.valueText })
    if (v.ok) { stat.pass += 1; v.tier === '1차' ? stat.tier1++ : stat.tier2++ }
    else stat.reasons[v.reason] = (stat.reasons[v.reason] ?? 0) + 1
    const wasPassing = !('reason' in c)
    if (wasPassing !== v.ok) flipped.push({ set: name, quote: c.quote, value: c.valueText, before: wasPassing ? '통과' : '폐기', after: v.ok ? '통과' : '폐기', why: v.reason })
  }
  const rej = Object.entries(stat.reasons).map(([k, n]) => `${k} ${n}`).join(' · ') || '없음'
  console.log(`\n■ ${name}  ${claims.length}건 → 통과 ${stat.pass} (1차 ${stat.tier1} · 2차 ${stat.tier2})`)
  console.log(`  폐기: ${rej}`)
}
console.log(`\n■ 판정이 뒤집힌 것 ${flipped.length}건`)
for (const f of flipped) console.log(`  ${f.before}→${f.after}  ${JSON.stringify(f.quote)} (값 ${JSON.stringify(f.value)}) ${f.why ?? ''}`)
