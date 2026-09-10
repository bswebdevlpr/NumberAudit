/** 저장된 스냅샷의 주장으로 ② 묶기만 다시 돌린다. 추출은 다시 하지 않는다 (호출 1회). */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clusterClaims } from '../src/cluster.js'
import { judge } from '../src/verdict.js'
import { usage } from '../src/gemini.js'

const here = dirname(fileURLToPath(import.meta.url))
const path = resolve(here, '..', process.argv[2] ?? 'public/snapshot.json')
const snap = JSON.parse(readFileSync(path, 'utf8'))

const { groups, dangling, duplicated, ungrouped } = await clusterClaims(snap.claims)
const verdicts = judge(snap.claims, groups)
const by = new Map(snap.claims.map((c) => [c.claimId, c]))
const show = (id) => { const c = by.get(id); return `${c.valueText}${c.unit ?? ''}${c.method ? '*' : ''}` }

console.log(`주장 ${snap.claims.length} → 그룹 ${groups.length} · 미분류 ${ungrouped.length} · 없는 ID ${dangling.length} · 중복 ${duplicated?.length ?? 0}`)
for (const g of groups) console.log(`  [${g.claimIds.length}] ${g.metric} → ${g.claimIds.map(show).join(', ')}`)
console.log('\n판정')
for (const v of verdicts) {
  if (!v.unsourced.length && v.disagreement.length < 2) continue
  const u = v.unsourced.map((c) => `${c.valueText}${c.unit ?? ''}@${c.title}`)
  console.log(`  ${v.metric}: 근거 안 보임 ${u.join(', ') || '없음'} · 갈린 값 ${[...new Set(v.disagreement.map((c) => c.valueText + (c.unit ?? '')))].join('/')}`)
}
console.log(`\n호출 ${usage.calls} · 모델 ${JSON.stringify(usage.byModel)}`)

if (process.argv.includes('--save')) {
  writeFileSync(path, JSON.stringify({ ...snap, groups, dangling, duplicated, ungrouped,
    verdicts: verdicts.map((v) => ({ metric: v.metric, claimIds: v.claims.map((c) => c.claimId),
      unsourcedIds: v.unsourced.map((c) => c.claimId), disagreementIds: v.disagreement.map((c) => c.claimId),
      targetIds: v.targets.map((c) => c.claimId) })) }, null, 2))
  console.log(`저장 → ${path}`)
}
