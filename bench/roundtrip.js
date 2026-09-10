/**
 * flow 를 한 바퀴 돌고 온 텍스트가 심은 원문과 같은가.
 *
 * 이 스크립트는 Gemini 를 부르지 않는다. 저장된 주장(라운드 2)의 인용을
 * **flow 에서 읽어온 본문**에 다시 대조할 뿐이다. 게이트가 깨지는지만 본다.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectProject, normalizeText } from '../src/collect.js'
import { checkClaim } from '../src/gate.js'

const here = dirname(fileURLToPath(import.meta.url))
const NOISY = process.argv.includes('--noisy')
const MAP_FILE = NOISY ? 'out/seed-map-noisy.json' : 'out/seed-map.json'
const map = JSON.parse(readFileSync(resolve(here, MAP_FILE), 'utf8'))
const R2 = JSON.parse(readFileSync(resolve(here, 'out/result-round2.json'), 'utf8'))

const docs = await collectProject(map.projectId)
console.log(`■ ${NOISY ? '노이즈판' : '평문판'} · flow 에서 읽은 문서 ${docs.length}건 (심은 것 ${Object.keys(map.docs).length}건)\n`)

// flow docId → 합성 docId
const flowToSynth = new Map()
for (const [synthId, m] of Object.entries(map.docs)) {
  flowToSynth.set(m.kind === 'post' ? `post:${m.postId}` : `comment:${m.commentId}`, synthId)
}

const readById = new Map(docs.map((d) => [d.docId, d]))
const cp = (s) => [...s].map((c) => c.codePointAt(0))

let same = 0, differ = 0, missing = 0
const diffs = []
for (const [synthId, m] of Object.entries(map.docs)) {
  const flowId = m.kind === 'post' ? `post:${m.postId}` : `comment:${m.commentId}`
  const got = readById.get(flowId)
  if (!got) { missing++; console.log(`  ✗ ${synthId} — 읽히지 않음 (${flowId})`); continue }

  const a = normalizeText(m.planted)   // 심은 원문에 같은 정제를 건다
  const b = got.text
  if (a === b) { same++; continue }
  differ++
  const ca = cp(a), cb = cp(b)
  const i = ca.findIndex((x, k) => x !== cb[k])
  diffs.push({ synthId, flowId, planted: a, read: b, at: i,
    plantedAround: a.slice(Math.max(0, i - 20), i + 20),
    readAround: b.slice(Math.max(0, i - 20), i + 20),
    plantedCp: ca.slice(i, i + 6), readCp: cb.slice(i, i + 6) })
}
console.log(`  일치 ${same} · 다름 ${differ} · 못 읽음 ${missing}`)
for (const d of diffs) {
  console.log(`\n  ✗ ${d.synthId} (${d.flowId}) — ${d.at}번째 문자부터`)
  console.log(`    심은 것: ${JSON.stringify(d.plantedAround)}  cp=${d.plantedCp}`)
  console.log(`    읽은 것: ${JSON.stringify(d.readAround)}  cp=${d.readCp}`)
}

// ── 게이트 재생: 저장된 주장을 flow 본문에 대조한다 ────────────────
const claims = [...R2.synthetic.claims, ...R2.synthetic.rejected]
const synthText = new Map()
for (const d of docs) {
  const s = flowToSynth.get(d.docId)
  if (s) synthText.set(s, d.text)
}

const stat = { total: 0, pass: 0, tier1: 0, tier2: 0, reasons: {} }
const flipped = []
for (const c of claims) {
  const src = synthText.get(c.docId)
  if (src === undefined) { stat.reasons['flow 에 없는 docId'] = (stat.reasons['flow 에 없는 docId'] ?? 0) + 1; continue }
  stat.total++
  const v = checkClaim({ sourceText: src, quote: c.quote, valueText: c.valueText })
  if (v.ok) { stat.pass++; v.tier === '1차' ? stat.tier1++ : stat.tier2++ }
  else stat.reasons[v.reason] = (stat.reasons[v.reason] ?? 0) + 1
  const wasPassing = !('reason' in c)
  if (wasPassing !== v.ok) flipped.push({ claimId: c.claimId, docId: c.docId, quote: c.quote, value: c.valueText,
    before: wasPassing ? '통과' : '폐기', after: v.ok ? '통과' : '폐기', why: v.reason })
}

console.log('\n' + '='.repeat(64))
console.log('게이트 재생 — 합성 원문 → flow 본문')
console.log('='.repeat(64))
console.log(`주장 ${stat.total}건 → 통과 ${stat.pass} (1차 ${stat.tier1} · 2차 ${stat.tier2})`)
console.log(`폐기: ${Object.entries(stat.reasons).map(([k, n]) => `${k} ${n}`).join(' · ') || '없음'}`)
console.log(`\n판정이 뒤집힌 것 ${flipped.length}건`)
for (const f of flipped) console.log(`  ${f.before}→${f.after}  [${f.claimId}] ${JSON.stringify(f.quote)} (값 ${JSON.stringify(f.value)}) ${f.why ?? ''}`)

writeFileSync(resolve(here, NOISY ? 'out/roundtrip-noisy.json' : 'out/roundtrip.json'), JSON.stringify({
  at: new Date().toISOString(), projectId: map.projectId,
  text: { same, differ, missing, diffs }, gate: stat, flipped,
}, null, 2))
