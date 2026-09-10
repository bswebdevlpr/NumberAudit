/**
 * 추출이 왜 줄었나 — 변수를 하나씩 켠다.
 *
 * flow 노이즈판(모델 gemini-3.1-flash-lite)에서 17건이 나왔다. 라운드 3(깨끗한 합성, flash-lite)은 31건이었다.
 * 그 사이에 바뀐 게 셋이다: ① 모델 별칭 ② 개행 붕괴 ③ 노이즈.
 * ③ 만 남기고 ①② 를 고정해야 「노이즈가 얼마를 먹었나」를 말할 수 있다.
 *
 *   A 합성 원문 (개행 있음)          ← 라운드 3 조건, 모델만 고정
 *   B 합성 + 개행 붕괴               ← collect.normalizeText 가 하는 짓
 *   C flow 노이즈판 (이미 실행됨)     ← out/flow-noisy.json
 *
 * ⚠️ Gemini 2회 (A·B). C 는 저장된 결과를 읽는다.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SYNTHETIC } from './docs.js'
import { NOISY } from './docs-noisy.js'
import { extractBatch } from './arm-batch.js'
import { usage, modelChain } from '../src/gemini.js'

const here = dirname(fileURLToPath(import.meta.url))
const collapse = (d) => ({ ...d, text: d.text.replace(/\s+/g, ' ').trim() })
const norm = (s) => String(s ?? '').replace(/\s/g, '').replace(/(\d),(?=\d{3}\b)/g, '$1')
/** 값만으로 센다 — unit 을 키에 넣었더니 「4분 12초」가 누락·추가 양쪽에 잡혔다(내 대조 버그). */
const vkey = (docId, v) => `${docId}|${norm(v)}`

console.log(`모델 체인 ${JSON.stringify(modelChain)}`)

const A = await extractBatch(SYNTHETIC)
console.log(`A 합성 원문        추출 ${A.stats.raw} → 통과 ${A.claims.length} · 폐기 ${A.rejected.length} (오귀속 ${A.stats.misattributed})`)

const B = await extractBatch(SYNTHETIC.map(collapse))
console.log(`B 개행 붕괴        추출 ${B.stats.raw} → 통과 ${B.claims.length} · 폐기 ${B.rejected.length} (오귀속 ${B.stats.misattributed})`)

const Cfile = JSON.parse(readFileSync(resolve(here, 'out/flow-noisy.json'), 'utf8'))
const map = JSON.parse(readFileSync(resolve(here, 'out/seed-map-noisy.json'), 'utf8'))
const toSynth = new Map(Object.entries(map.docs).map(([s, m]) =>
  [m.kind === 'post' ? `post:${m.postId}` : `comment:${m.commentId}`, s]))
const C = {
  claims: Cfile.claims.map((c) => ({ ...c, docId: toSynth.get(c.docId) ?? c.docId })),
  rejected: Cfile.rejected.map((c) => ({ ...c, docId: toSynth.get(c.docId) ?? c.docId })),
  stats: Cfile.stats,
}
console.log(`C flow 노이즈판     추출 ${C.stats.raw} → 통과 ${C.claims.length} · 폐기 ${C.rejected.length} (오귀속 ${C.stats.misattributed})`)

const sets = { A, B, C }
const keys = Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, new Set(v.claims.map((c) => vkey(c.docId, c.valueText)))]))

console.log('\n' + '-'.repeat(64))
for (const [x, y] of [['A', 'B'], ['B', 'C'], ['A', 'C']]) {
  const lost = [...keys[x]].filter((k) => !keys[y].has(k))
  const gained = [...keys[y]].filter((k) => !keys[x].has(k))
  console.log(`${x}→${y}  잃은 것 ${lost.length} · 얻은 것 ${gained.length}`)
  if (lost.length) console.log(`   잃음: ${lost.join(', ')}`)
  if (gained.length) console.log(`   얻음: ${gained.join(', ')}`)
}

console.log(`\n호출 ${usage.calls} · 모델 ${JSON.stringify(usage.byModel)} · 입력 ${usage.promptTokens} · 출력 ${usage.outputTokens} · 재시도 ${usage.retries}`)
writeFileSync(resolve(here, 'out/ladder.json'), JSON.stringify({
  at: new Date().toISOString(), modelChain, usage: { ...usage },
  A: { stats: A.stats, claims: A.claims, rejected: A.rejected },
  B: { stats: B.stats, claims: B.claims, rejected: B.rejected },
  C: { stats: C.stats, from: 'out/flow-noisy.json' },
}, null, 2))
