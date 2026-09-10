import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SYNTHETIC } from './docs.js'
import { extractBatch } from './arm-batch.js'
import { usage, modelChain } from '../src/gemini.js'

/**
 * 라운드 3 — 게이트가 값을 하는가.
 *
 * 라운드 1·2 에서 게이트 폐기가 0건이었다. 막을 게 없었다는 뜻이고,
 * 그러면 「게이트가 값을 한다」는 주장에 근거가 없다.
 * 모델을 낮추면 인용이 흔들리는지, 흔들리면 게이트가 잡는지 본다.
 */
const here = dirname(fileURLToPath(import.meta.url))
const line = (s = '') => console.log(s)

const r = await extractBatch(SYNTHETIC)
const model = Object.keys(usage.byModel)[0] ?? modelChain[0]

line('='.repeat(60))
line(`라운드 3 — 모델을 낮추면 게이트가 잡나  ·  ${model}`)
line('='.repeat(60))
line(`\n주장 ${r.stats.raw}건 → 통과 ${r.claims.length} (1차 ${r.stats.tier1} · 2차 ${r.stats.tier2}) · 폐기 ${r.rejected.length}`)
line(`없는 docId ${r.stats.unknownDoc} · 오귀속 ${r.stats.misattributed}`)
for (const [reason, n] of Object.entries(r.stats.byReason)) line(`  폐기 — ${reason}: ${n}건`)
if (r.rejected.length) {
  line('\n폐기된 것:')
  for (const c of r.rejected) line(`  ${String(c.docId).padEnd(14)} 값=${JSON.stringify(c.valueText)} 인용=${JSON.stringify(c.quote)}\n    → ${c.reason}`)
}
line(`\n호출 ${usage.calls}회 · ${JSON.stringify(usage.byModel)} · 재시도 ${usage.retries}`)

mkdirSync(resolve(here, 'out'), { recursive: true })
writeFileSync(resolve(here, `out/result-round3-${model}.json`), JSON.stringify({ at: new Date().toISOString(), model, ...r }, null, 2), 'utf8')
line(`원시 결과 → bench/out/result-round3-${model}.json`)
