/** 저장된 flow 실행 결과를 다시 채점한다. Gemini 호출 0회 — 채점만 바뀐 걸 검증할 수 있다. */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const F = JSON.parse(readFileSync(resolve(here, process.argv[2] ?? 'out/flow-noisy-after-newline-fix.json'), 'utf8'))
const M = JSON.parse(readFileSync(resolve(here, 'out/seed-map-noisy.json'), 'utf8'))
const R2 = JSON.parse(readFileSync(resolve(here, 'out/result-round2.json'), 'utf8'))
const R3 = JSON.parse(readFileSync(resolve(here, 'out/result-round3-gemini-flash-lite-latest.json'), 'utf8'))

const toSynth = new Map(Object.entries(M.docs).map(([s, m]) =>
  [m.kind === 'post' ? `post:${m.postId}` : `comment:${m.commentId}`, s]))
const norm = (s) => String(s ?? '').replace(/\s/g, '').replace(/(\d),(?=\d{3}\b)/g, '$1')
const vkey = (d, v) => `${d}|${norm(v)}`

const mine = new Set(F.claims.map((c) => vkey(toSynth.get(c.docId) ?? c.docId, c.valueText)))
const sets = [['라운드2 (gemini-3-flash-preview · 합성 원문)', R2.synthetic.claims], ['라운드3 (flash-lite · 합성 원문)', R3.claims]]

console.log(`flow 노이즈판 (${F.modelChain ? Object.keys(F.usage.byModel).join(',') : '?'}) 통과 ${mine.size}건`)
for (const [name, claims] of sets) {
  const theirs = new Set(claims.map((c) => vkey(c.docId, c.valueText)))
  const missed = [...theirs].filter((k) => !mine.has(k))
  const extra = [...mine].filter((k) => !theirs.has(k))
  console.log(`\n■ ${name} ${theirs.size}건`)
  console.log(`  겹침 ${theirs.size - missed.length} · 저쪽에만 ${missed.length} · 이쪽에만 ${extra.length}`)
  console.log(`  저쪽에만: ${missed.join(', ') || '없음'}`)
  console.log(`  이쪽에만: ${extra.join(', ') || '없음'}`)
}
