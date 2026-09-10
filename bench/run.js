import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SYNTHETIC, EXTERNAL } from './docs.js'
import { baselineExtract, baselineGroup } from './arm-regex.js'
import { extractClaims } from '../src/extract.js'
import { clusterClaims } from './cluster.js'
import { scoreLocate, scoreGroup } from './score.js'
import { usage, modelChain } from '../src/gemini.js'

const here = dirname(fileURLToPath(import.meta.url))
const GOLD = JSON.parse(readFileSync(resolve(here, 'gold.json'), 'utf8'))

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(0)}%` : '-')
const line = (s = '') => console.log(s)
/** 한글은 2칸으로 세서 폭을 맞춘다 */
const w = (s) => [...String(s)].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x1100 ? 2 : 1), 0)
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - w(s)))

async function main() {
  const t0 = Date.now()
  line('='.repeat(64))
  line('Phase 0 벤치 — 자리마다 코드와 모델을 나란히 놓고 잰다')
  line(`문서 ${SYNTHETIC.length}건(합성) + ${EXTERNAL.length}건(외부) · 모델 ${modelChain.join(' → ')}`)
  line('='.repeat(64))

  // ---- 통제군 --------------------------------------------------------
  const rx = baselineExtract(SYNTHETIC)
  const rxGroups = baselineGroup(rx)
  const rxLocate = scoreLocate(rx, GOLD)
  const rxGroup = scoreGroup(rx, rxGroups, GOLD, (g) => g.claims.map((c) => c.claimId))

  // ---- 실험군 --------------------------------------------------------
  const ai = await extractClaims(SYNTHETIC)
  const aiLocate = scoreLocate(ai.claims, GOLD)
  const { groups: aiGroups, dangling } = await clusterClaims(ai.claims)
  const aiGroup = scoreGroup(ai.claims, aiGroups, GOLD, (g) => g.claimIds)

  // ---- ①-a 숫자 위치 ---------------------------------------------------
  line('\n■ ①-a  숫자의 위치를 찾는다')
  line(`  ${pad('', 12)}${pad('gold 값 발견', 16)}${pad('노이즈 포획', 14)}총 추출`)
  line(`  ${pad('정규식', 12)}${pad(`${rxLocate.found}/${rxLocate.wanted} (${pct(rxLocate.found, rxLocate.wanted)})`, 16)}${pad(`${rxLocate.noiseCaught}/${rxLocate.noiseTotal}`, 14)}${rxLocate.total}`)
  line(`  ${pad('Gemini', 12)}${pad(`${aiLocate.found}/${aiLocate.wanted} (${pct(aiLocate.found, aiLocate.wanted)})`, 16)}${pad(`${aiLocate.noiseCaught}/${aiLocate.noiseTotal}`, 14)}${aiLocate.total}`)
  if (rxLocate.missed.length) line(`  정규식 놓침: ${rxLocate.missed.join(', ')}`)
  if (aiLocate.missed.length) line(`  Gemini 놓침: ${aiLocate.missed.join(', ')}`)
  line(`  정규식 노이즈: ${rxLocate.noiseList.join(', ') || '없음'}`)
  line(`  Gemini 노이즈: ${aiLocate.noiseList.join(', ') || '없음'}`)

  // ---- ①-b 지표명·조건 -------------------------------------------------
  const withMetric = ai.claims.filter((c) => (c.metric ?? '').trim()).length
  const withCond = ai.claims.filter((c) => (c.condition ?? '').trim()).length
  line('\n■ ①-b  숫자에 지표명·측정조건을 붙인다')
  line(`  정규식   지표명 0/${rx.length} — 구조적으로 못 한다. 단위축(시간·개수·비율·날짜)까지가 천장`)
  line(`  Gemini   지표명 ${withMetric}/${ai.claims.length} · 측정조건 ${withCond}/${ai.claims.length}`)

  // ---- ② 같은 지표인가 -------------------------------------------------
  line('\n■ ②  같은 지표끼리 묶는다')
  line(`  ${pad('', 10)}${pad('묶임', 8)}드리프트별 (그룹크기 · 무관 값)`)
  line(`  ${pad('', 10)}${pad('묶임', 8)}${pad('평균 정밀도', 14)}드리프트별 (그룹크기 · 무관 값)`)
  for (const arm of [['정규식', rxGroup], ['Gemini', aiGroup]]) {
    const [name, s] = arm
    const detail = s.rows.map((r) => `${r.id}${r.together ? '✅' : '❌'}${r.hostSize ? `(${r.hostSize}·+${r.extras})` : ''}`).join(' ')
    line(`  ${pad(name, 10)}${pad(`${s.ok}/${s.total}`, 8)}${pad(pct(s.meanPrecision * 100, 100), 14)}${detail}`)
  }
  line('  🔑 재현율만 보면 「전부 한 그룹에 몰기」가 만점을 받는다. 정밀도를 같이 본다.')
  if (dangling.length) line(`  ⚠️ 없는 claimId 참조: ${dangling.join(', ')} — 참조 게이트가 버렸다`)

  // ---- ③ 인용 게이트 ---------------------------------------------------
  line('\n■ ③  인용이 원문에 진짜 있나 (모델 안 씀)')
  line(`  모델이 낸 주장 ${ai.stats.raw}건 → 통과 ${ai.claims.length} · 폐기 ${ai.rejected.length}`)
  line(`  1차 통과 ${ai.stats.tier1} · 2차 통과(느슨한 정규화) ${ai.stats.tier2}`)
  for (const [reason, n] of Object.entries(ai.stats.byReason)) line(`  폐기 — ${reason}: ${n}건`)
  if (!ai.rejected.length) line('  폐기 0건')

  // ---- 외부 문서 재현 --------------------------------------------------
  // 여기서 죽어도 위 측정치는 잃지 않는다. 재현 실패도 결과다 — 미재현 ⬜ 로 남긴다.
  line('\n■ 재현 — 외부 문서 (내가 안 심은 실제 문서)')
  let extOut = { status: '미재현', error: null }
  try {
  const ext = await extractClaims(EXTERNAL)
  const extRx = baselineExtract(EXTERNAL)
  const g = GOLD.external
  const gotAi = g.claims.filter((v) => ext.claims.some((c) => c.valueText.replace(/\s/g, '').includes(v.replace(/\s/g, '').replace('%', ''))))
  const gotRx = g.claims.filter((v) => extRx.some((c) => c.valueText.replace(/\s/g, '').includes(v.replace(/\s/g, '').replace('%', ''))))
  const extCond = ext.claims.filter((c) => (c.condition ?? '').trim()).length
  line(`  절감률 주장 ${g.claims.length}건 중 — 정규식 ${gotRx.length} · Gemini ${gotAi.length}`)
  line(`  Gemini 총 추출 ${ext.claims.length} · 폐기 ${ext.rejected.length} (1차 ${ext.stats.tier1} · 2차 ${ext.stats.tier2})`)
  line(`  측정조건이 붙은 주장 ${extCond}건 — gold 예상 ${g.conditionCount}건`)
  for (const [reason, n] of Object.entries(ext.stats.byReason)) line(`  폐기 — ${reason}: ${n}건`)
  extOut = { status: '실측', claims: ext.claims, rejected: ext.rejected, stats: ext.stats, regexCount: extRx.length, goldHit: { regex: gotRx, gemini: gotAi }, conditionCount: extCond }
  } catch (e) {
    extOut = { status: '미재현', error: e.message }
    line(`  ⬜ 미재현 — ${e.message}`)
    line('  → 「합성 데이터에서만 확인됐다」로 적는다. 재현 실패 자체가 결과다.')
  }

  line('\n' + '='.repeat(64))
  line(`Gemini 호출 ${usage.calls}회 · ${JSON.stringify(usage.byModel)} · 입력 ${usage.promptTokens} / 출력 ${usage.outputTokens} 토큰`)
  line(`소요 ${((Date.now() - t0) / 1000).toFixed(1)}초`)

  mkdirSync(resolve(here, 'out'), { recursive: true })
  writeFileSync(resolve(here, 'out/result.json'), JSON.stringify({
    at: new Date().toISOString(), model: usage.byModel,
    regex: { claims: rx, groups: rxGroups.map((g) => ({ key: g.key, ids: g.claims.map((c) => c.claimId) })), locate: rxLocate, group: rxGroup },
    gemini: { claims: ai.claims, rejected: ai.rejected, stats: ai.stats, groups: aiGroups, dangling, locate: aiLocate, group: aiGroup },
    external: extOut,
  }, null, 2), 'utf8')
  line('원시 결과 → bench/out/result.json')
}

main().catch((e) => { console.error('\n실패:', e.message); process.exit(1) })
