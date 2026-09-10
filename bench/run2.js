import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SYNTHETIC, EXTERNAL } from './docs.js'
import { extractBatch } from './arm-batch.js'
import { keywordMethod } from './arm-keyword.js'
import { normVal } from './score.js'
import { usage, modelChain } from '../src/gemini.js'

const here = dirname(fileURLToPath(import.meta.url))
const G = JSON.parse(readFileSync(resolve(here, 'gold-round2.json'), 'utf8'))
const line = (s = '') => console.log(s)
const w = (s) => [...String(s)].reduce((n, c) => n + (c.charCodeAt(0) > 0x1100 ? 2 : 1), 0)
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - w(s)))
const has = (s) => Boolean(String(s ?? '').trim())

function scoreMethod(claims, expected, docs) {
  const byDoc = new Map(docs.map((d) => [d.docId, d.text]))
  const want = expected.map((e) => ({ ...e, found: claims.find((c) => c.docId === e.doc && normVal(c.valueText).includes(normVal(e.value))) }))

  const recall = want.filter((e) => e.found && has(e.found.method))
  const shouldBeEmpty = claims.filter((c) => !expected.some((e) => c.docId === e.doc && normVal(c.valueText).includes(normVal(e.value))))
  const falsePos = shouldBeEmpty.filter((c) => has(c.method))

  // 통제군 — 같은 줄에 측정 어휘가 있나
  const kwOn = want.filter((e) => e.found && keywordMethod(byDoc.get(e.doc) ?? '', e.value).has)
  const kwFp = shouldBeEmpty.filter((c) => keywordMethod(byDoc.get(c.docId) ?? '', c.valueText).has)

  return { want, recall, shouldBeEmpty, falsePos, kwOn, kwFp }
}

async function main() {
  const t0 = Date.now()
  line('='.repeat(64))
  line('Phase 0 라운드 2 — scope/method 분리 + 배치 추출')
  line(`모델 ${modelChain.join(' → ')}`)
  line('='.repeat(64))
  line(`\n질문: ${G.question}`)
  line(`method 의 정의: ${G.methodMeans}`)

  // ---- 합성 ------------------------------------------------------------
  const syn = await extractBatch(SYNTHETIC)
  const s = scoreMethod(syn.claims, G.synthetic.methodExpected, SYNTHETIC)

  line('\n■ 합성 문서 — method 가 붙어야 할 3건 / 비어야 할 나머지')
  line(`  ${pad('', 12)}${pad('있어야 할 곳', 16)}없어야 할 곳 오탐`)
  line(`  ${pad('Gemini', 12)}${pad(`${s.recall.length}/${s.want.length}`, 16)}${s.falsePos.length}/${s.shouldBeEmpty.length}`)
  line(`  ${pad('키워드(통제)', 12)}${pad(`${s.kwOn.length}/${s.want.length}`, 16)}${s.kwFp.length}/${s.shouldBeEmpty.length}`)
  for (const e of s.want) {
    const m = e.found ? (e.found.method || '(빈칸)') : '(추출 실패)'
    line(`    ${pad(e.value + '@' + e.doc, 22)}method=${JSON.stringify(m)}`)
  }
  if (s.falsePos.length) {
    line('  🔴 비어야 하는데 채워진 것:')
    for (const c of s.falsePos.slice(0, 8)) line(`    ${pad(c.valueText + '@' + c.docId, 22)}method=${JSON.stringify(c.method)}`)
  }

  // ---- 외부 — 여기가 판정선 ---------------------------------------------
  line('\n■ 외부 문서 — 🔴 판정선. gold 는 method 0건이다')
  const ext = await extractBatch(EXTERNAL)
  const filled = ext.claims.filter((c) => has(c.method))
  line(`  추출 ${ext.claims.length}건 · method 채워진 것 ${filled.length}건 (gold ${G.external.methodExpectedCount})`)
  for (const c of ext.claims) {
    line(`    ${pad(c.valueText, 10)}scope=${JSON.stringify(c.scope || '')}  method=${JSON.stringify(c.method || '')}`)
  }

  const verdict = filled.length === G.external.methodExpectedCount
  line('')
  line(verdict
    ? '  ✅ 분리 성공 — scope 로 갔고 method 는 비었다. 라운드 1의 「조건 7/7 충족」이 뒤집힌다'
    : `  ❌ 분리 실패 — method 가 ${filled.length}건 채워졌다. ${G.foldCondition}`)

  line('\n■ 배치가 만든 실패 모드 — 오귀속')
  line(`  없는 docId ${syn.stats.unknownDoc}건 · 오귀속 ${syn.stats.misattributed}건 — 인용 게이트가 잡았다`)

  line('\n■ 인용 게이트 (분리 스키마 · 배치에서도 도나)')
  line(`  합성 ${syn.stats.raw}건 → 통과 ${syn.claims.length} (1차 ${syn.stats.tier1} · 2차 ${syn.stats.tier2}) · 폐기 ${syn.rejected.length}`)
  for (const [r, n] of Object.entries(syn.stats.byReason)) line(`    폐기 — ${r}: ${n}건`)
  line(`  외부 ${ext.stats.raw}건 → 통과 ${ext.claims.length} (1차 ${ext.stats.tier1} · 2차 ${ext.stats.tier2}) · 폐기 ${ext.rejected.length}`)

  line('\n' + '='.repeat(64))
  line(`Gemini 호출 ${usage.calls}회 · ${JSON.stringify(usage.byModel)} · 입력 ${usage.promptTokens} / 출력 ${usage.outputTokens}`)
  line(`소요 ${((Date.now() - t0) / 1000).toFixed(1)}초`)

  mkdirSync(resolve(here, 'out'), { recursive: true })
  writeFileSync(resolve(here, 'out/result-round2.json'), JSON.stringify({
    at: new Date().toISOString(), model: usage.byModel, verdict,
    synthetic: { claims: syn.claims, rejected: syn.rejected, stats: syn.stats, score: { recall: s.recall.length, want: s.want.length, falsePos: s.falsePos.length, shouldBeEmpty: s.shouldBeEmpty.length, kwOn: s.kwOn.length, kwFp: s.kwFp.length } },
    external: { claims: ext.claims, rejected: ext.rejected, stats: ext.stats, filled: filled.length },
  }, null, 2), 'utf8')
  line('원시 결과 → bench/out/result-round2.json')
}

main().catch((e) => { console.error('\n실패:', e.message); process.exit(1) })
