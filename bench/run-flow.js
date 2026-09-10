/**
 * 실제 flow 프로젝트를 읽어 파이프라인을 돌린다 — §5-1 의 본체.
 *
 * 지금까지 잰 건 전부 내가 만든 문자열이었다. 여기서는 flow 가 저장하고 flow 가 돌려준
 * 텍스트를 모델에게 준다. 게이트가 깨지는 자리는 이때 드러난다.
 *
 *   node bench/run-flow.js 2969669        평문판
 *   node bench/run-flow.js 2969670 --noisy 노이즈판
 *
 * ⚠️ Gemini 를 호출한다 — 무료 티어 모델당 하루 20회. 실행당 1회.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectProject } from '../src/collect.js'
import { extractBatch } from './arm-batch.js'
import { usage, modelChain } from '../src/gemini.js'
import { SYNTHETIC } from './docs.js'

const here = dirname(fileURLToPath(import.meta.url))
const projectId = process.argv[2]
if (!projectId) { console.error('projectId 를 넘겨라'); process.exit(1) }
const NOISY = process.argv.includes('--noisy')
const map = JSON.parse(readFileSync(resolve(here, NOISY ? 'out/seed-map-noisy.json' : 'out/seed-map.json'), 'utf8'))

// flow docId ↔ 합성 docId
const toSynth = new Map()
for (const [synthId, m] of Object.entries(map.docs)) {
  toSynth.set(m.kind === 'post' ? `post:${m.postId}` : `comment:${m.commentId}`, synthId)
}

const docs = await collectProject(projectId)
console.log(`■ ${NOISY ? '노이즈판' : '평문판'} 프로젝트 ${projectId} — 문서 ${docs.length}건 · 총 ${docs.reduce((a, d) => a + d.text.length, 0)}자`)

const { claims, rejected, stats } = await extractBatch(docs)

console.log('\n' + '='.repeat(64))
console.log(`추출 ${stats.raw}건 → 통과 ${claims.length} (1차 ${stats.tier1} · 2차 ${stats.tier2}) · 폐기 ${rejected.length}`)
console.log(`오귀속 ${stats.misattributed} · 없는 docId ${stats.unknownDoc}`)
console.log(`폐기 사유: ${Object.entries(stats.byReason).map(([k, n]) => `${k} ${n}`).join(' · ') || '없음'}`)
console.log(`모델 ${JSON.stringify(usage.byModel)} · 호출 ${usage.calls} · 입력 ${usage.promptTokens} · 출력 ${usage.outputTokens} · 재시도 ${usage.retries}`)
for (const r of rejected) console.log(`  ✗ [${r.docId}] ${JSON.stringify(r.quote)} (값 ${JSON.stringify(r.valueText)}) — ${r.reason}`)

// ── 합성 원문에서 돌린 결과와 대조한다 ──────────────────────────────
const norm = (s) => String(s ?? '').replace(/\s/g, '').replace(/(\d),(?=\d{3}\b)/g, '$1')
// 값만으로 센다. unit 을 키에 넣었더니 unit 표기가 흔들린 「4분 12초」가
// 누락·추가 양쪽에 동시에 잡혔다 — 대조가 아니라 내 채점 버그였다.
const key = (docId, v) => `${docId}|${norm(v)}`
const R2 = JSON.parse(readFileSync(resolve(here, 'out/result-round2.json'), 'utf8'))

const mine = new Map()
for (const c of claims) {
  const s = toSynth.get(c.docId) ?? c.docId
  mine.set(key(s, c.valueText), { ...c, synthDocId: s })
}
const theirs = new Map(R2.synthetic.claims.map((c) => [key(c.docId, c.valueText), c]))

const missed = [...theirs.keys()].filter((k) => !mine.has(k))
const extra = [...mine.keys()].filter((k) => !theirs.has(k))
console.log('\n' + '-'.repeat(64))
console.log(`합성 원문 기준(라운드2) ${theirs.size}건 · flow 기준 ${mine.size}건`)
console.log(`  라운드2 에 있고 여기 없는 것 ${missed.length}: ${missed.join(', ') || '없음'}`)
console.log(`  여기만 있는 것 ${extra.length}: ${extra.join(', ') || '없음'}`)

// method gold — 붙어야 할 3건 / 나머지는 비어야 한다
const G = JSON.parse(readFileSync(resolve(here, 'gold-round2.json'), 'utf8'))
const has = (s) => Boolean(String(s ?? '').trim())
const want = G.synthetic.methodExpected.map((e) => ({ ...e, found: [...mine.values()].find((c) => c.synthDocId === e.doc && norm(`${c.valueText}${c.unit}`).includes(norm(e.value))) }))
const others = [...mine.values()].filter((c) => !G.synthetic.methodExpected.some((e) => c.synthDocId === e.doc && norm(`${c.valueText}${c.unit}`).includes(norm(e.value))))
console.log(`\nmethod — 재현 ${want.filter((e) => e.found && has(e.found.method)).length}/${want.length} · 오탐 ${others.filter((c) => has(c.method)).length}/${others.length}`)
for (const e of want) console.log(`  ${(e.value + '@' + e.doc).padEnd(22)}${JSON.stringify(e.found?.method ?? '(추출 실패)')}`)
for (const c of others.filter((x) => has(x.method))) console.log(`  🔴 오탐 ${c.synthDocId} ${c.valueText}${c.unit} → ${JSON.stringify(c.method)}`)

// 실행마다 파일을 새로 만든다 — 앞 결과를 덮어써서 비교 근거를 날린 적이 있다.
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(resolve(here, `out/flow-${NOISY ? 'noisy' : 'clean'}-${stamp}.json`), JSON.stringify({
  at: new Date().toISOString(), projectId, noisy: NOISY, modelChain,
  usage: { ...usage }, stats, claims, rejected,
  compare: { round2: theirs.size, here: mine.size, missed, extra },
}, null, 2))
