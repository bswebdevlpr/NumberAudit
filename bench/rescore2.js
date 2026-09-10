import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SYNTHETIC } from './docs.js'
import { keywordMethod } from './arm-keyword.js'

/**
 * 저장된 라운드 2 결과를 다시 채점한다. Gemini 를 다시 부르지 않는다.
 *
 * 1차 채점의 버그 둘:
 *   ① valueText 와 unit 이 분리됐는데 "820ms" 로 매칭했다 → gold 3건 전부 「추출 실패」로 셌다
 *   ② 판정 대상을 gold 의 절감률 7건이 아니라 외부 문서 전체 19건으로 셌다
 */
const here = dirname(fileURLToPath(import.meta.url))
const R = JSON.parse(readFileSync(resolve(here, 'out/result-round2.json'), 'utf8'))
const G = JSON.parse(readFileSync(resolve(here, 'gold-round2.json'), 'utf8'))
const line = (s = '') => console.log(s)
const has = (s) => Boolean(String(s ?? '').trim())
const full = (c) => `${c.valueText ?? ''}${c.unit ?? ''}`.replace(/\s/g, '')
const norm = (s) => String(s ?? '').replace(/\s/g, '').replace(/(\d),(?=\d{3}\b)/g, '$1')

line('='.repeat(64))
line('라운드 2 재채점 — 채점 버그 2건 수정 후')
line(`모델 ${JSON.stringify(R.model)} · 원본 ${R.at}`)
line('='.repeat(64))

// ---- 합성 -------------------------------------------------------------
const byDoc = new Map(SYNTHETIC.map((d) => [d.docId, d.text]))
const claims = R.synthetic.claims
const isTarget = (c, e) => c.docId === e.doc && norm(full(c)).includes(norm(e.value))

const want = G.synthetic.methodExpected.map((e) => ({ ...e, found: claims.find((c) => isTarget(c, e)) }))
const others = claims.filter((c) => !G.synthetic.methodExpected.some((e) => isTarget(c, e)))

const recall = want.filter((e) => e.found && has(e.found.method))
const falsePos = others.filter((c) => has(c.method))
const kwOn = want.filter((e) => keywordMethod(byDoc.get(e.doc) ?? '', e.value.replace(/[^\d.]/g, '')).has)
const kwFp = others.filter((c) => keywordMethod(byDoc.get(c.docId) ?? '', c.valueText).has)

line('\n■ 합성 — method 가 붙어야 할 3건 / 비어야 할 나머지')
line(`  ${'Gemini'.padEnd(14)}재현 ${recall.length}/${want.length} · 오탐 ${falsePos.length}/${others.length}`)
line(`  ${'키워드(통제)'.padEnd(11)}재현 ${kwOn.length}/${want.length} · 오탐 ${kwFp.length}/${others.length}`)
for (const e of want) line(`    ${(e.value + '@' + e.doc).padEnd(22)}${JSON.stringify(e.found?.method ?? '(추출 실패)')}`)
if (falsePos.length) for (const c of falsePos) line(`    🔴 오탐 ${c.docId} ${full(c)} → ${JSON.stringify(c.method)}`)
line(`  키워드 오탐: ${kwFp.map((c) => `${full(c)}@${c.docId}`).join(', ') || '없음'}`)

// ---- 외부 — 판정선 -----------------------------------------------------
const pctClaims = R.external.claims.filter((c) => String(c.unit).includes('%') || String(c.valueText).includes('%'))
const filled = pctClaims.filter((c) => has(c.method))

line('\n■ 외부 — 🔴 판정선. gold 대상은 절감률 주장뿐이다')
line(`  절감률 주장 ${pctClaims.length}건 · method 채워진 것 ${filled.length}건 (gold ${G.external.methodExpectedCount})`)
for (const c of pctClaims) line(`    ${full(c).padEnd(12)}scope=${JSON.stringify(c.scope)}  method=${JSON.stringify(c.method)}`)

const rest = R.external.claims.filter((c) => !pctClaims.includes(c))
line(`\n  gold 밖 — 표의 기간 값 ${rest.length}건 (라운드 1 문서별 추출에는 없던 것)`)
line(`    method 에 "전통적 방식"/"이 시스템" 이 붙었다 — 비교 대상이라 틀렸다고 하긴 어렵다`)

line('')
if (filled.length === 0) line('  ✅ 분리 완전 성공 — 절감률에 method 가 하나도 안 붙었다')
else if (filled.length <= 1) line(`  🟡 분리 대체로 성공 — ${pctClaims.length}건 중 ${filled.length}건만 채워졌다. 라운드 1은 7/7 이었다`)
else line(`  ❌ 분리 실패 — ${filled.length}건 채워졌다. ${G.foldCondition}`)

// ---- 배치·게이트 -------------------------------------------------------
line('\n■ 배치가 만든 실패 모드')
line(`  없는 docId ${R.synthetic.stats.unknownDoc}건 · 오귀속 ${R.synthetic.stats.misattributed}건`)
line(`  → 잡을 게 없었다. 「게이트가 막았다」가 아니라 「이 표본에선 안 일어났다」로 적는다`)

line('\n■ 인용 게이트')
line(`  합성 ${R.synthetic.stats.raw} → 통과 ${claims.length} (1차 ${R.synthetic.stats.tier1} · 2차 ${R.synthetic.stats.tier2}) · 폐기 ${R.synthetic.rejected.length}`)
for (const [r, n] of Object.entries(R.synthetic.stats.byReason)) line(`    ${r}: ${n}건`)
line(`  외부 ${R.external.stats.raw} → 통과 ${R.external.claims.length} (1차 ${R.external.stats.tier1} · 2차 ${R.external.stats.tier2}) · 폐기 ${R.external.rejected.length}`)
