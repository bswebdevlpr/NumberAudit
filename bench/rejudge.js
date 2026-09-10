/** 저장된 스냅샷을 다시 판정한다. Gemini 0회 — 규칙만 바뀐 걸 검증할 수 있다. */
import { readFileSync, writeFileSync } from 'node:fs'
import { judgeRoom } from '../src/verdict.js'
import { planTasks, workerIndex } from '../src/task.js'

const path = process.argv[2] ?? 'public/snapshot.json'
const snap = JSON.parse(readFileSync(path, 'utf8'))
const { verdicts, byUnit } = judgeRoom(snap.claims, snap.groups)
snap.verdicts = verdicts.map((v) => ({
  metric: v.metric, claimIds: v.claims.map((c) => c.claimId),
  unsourcedIds: v.unsourced.map((c) => c.claimId),
  disagreementIds: v.disagreement.map((c) => c.claimId),
  targetIds: v.targets.map((c) => c.claimId),
}))
snap.byUnitIds = byUnit.map((c) => c.claimId)
snap.plans = planTasks(snap, { workers: workerIndex(snap.participants ?? []) })
writeFileSync(path, JSON.stringify(snap, null, 2))
console.log(`판정 갱신 — 1차 ${snap.verdicts.flatMap(v=>v.unsourcedIds).length}건 · 2차 ${snap.byUnitIds.length}건 · 업무 ${snap.plans.length}건`)
for (const p of snap.plans) console.log(`  [${p.kind}·${p.tier}] ${p.task.title} · ${p.task.priority} · 담당 ${p.worker?.name ?? '-'}`)
