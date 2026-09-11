#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { flow } from './flow.js'
import { collectProject } from './collect.js'
import { auditProject } from './audit.js'

const [cmd, ...rest] = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? rest[i + 1] : dflt
}
const positional = rest.filter((s, i) => !s.startsWith('--') && !String(rest[i - 1] ?? '').startsWith('--'))

const HELP = `
수치 감사 — 플로우 프로젝트에 흩어진 수치 주장의 정합성을 감사한다

  npm run projects                        프로젝트 목록          (Gemini 0회)
  npm run collect -- <projectId>          글+댓글 → 문서로 정제  (Gemini 0회)
  npm run audit   -- <projectId>          감사 → 스냅샷 저장     (Gemini 2회)
      --out <경로>                        기본 public/snapshot.json
  npm run submit  -- <projectId> <n>      n번째 업무를 실제로 등록 (Gemini 0회)
      --write                             ⚠️ 없으면 미리보기. 삭제 API 가 없어 되돌릴 수 없다

⚠️ 무료 티어는 모델당 하루 20회다. audit 은 배치 추출 1회 + 묶기 1회를 쓴다.
`

switch (cmd) {
  case 'projects': {
    for (const p of await flow.listProjects()) console.log(`${p.projectId}\t${p.title}`)
    break
  }

  case 'collect': {
    const docs = await collectProject(positional[0])
    for (const d of docs) console.log(`${d.docId}\t${d.text.length}자\t${d.title}`)
    console.log(`\n문서 ${docs.length}건 · 총 ${docs.reduce((a, d) => a + d.text.length, 0)}자`)
    break
  }

  case 'audit': {
    const projectId = positional[0]
    if (!projectId) { console.error('projectId 가 필요하다'); process.exit(1) }
    const out = resolve(process.cwd(), arg('out', 'public/snapshot.json'))
    const snap = await auditProject(projectId)

    const g = snap.stats
    console.log(`\n문서 ${g.docs}건 · 배치 ${JSON.stringify(g.batches)}`)
    console.log(`주장 ${g.raw}건 → 통과 ${snap.claims.length} (1차 ${g.tier1} · 2차 ${g.tier2}) · 폐기 ${snap.rejected.length}`)
    console.log(`오귀속 ${g.misattributed} · 없는 docId ${g.unknownDoc} · 귀속 확인불가 ${g.ambiguous ?? 0}`)
    console.log(`지표 그룹 ${snap.groups.length} · 참조 게이트 — 없는 ID ${snap.dangling.length} · 중복 배정 ${snap.duplicated.length} · 그룹 밖 ${(snap.outOfGroup ?? []).length}`)
    for (const v of snap.verdicts) {
      if (!v.unsourcedIds.length) continue
      console.log(`  🔴 ${v.metric} — 근거가 안 보이는 값 ${v.unsourcedIds.join(', ')}`)
    }
    console.log(`모델 ${JSON.stringify(snap.model.byModel)} · 호출 ${snap.model.calls} · ${snap.ms}ms`)

    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(snap, null, 2))
    console.log(`\n스냅샷 → ${out}`)
    break
  }

  // 실제로 플로우에 쓴다. 되돌릴 수 없다 — 삭제 API 가 없다.
  case 'submit': {
    const { readFileSync } = await import('node:fs')
    const { submitPlan } = await import('./task.js')
    const snap = JSON.parse(readFileSync(resolve(process.cwd(), arg('snapshot', 'public/snapshot.json')), 'utf8'))
    const projectId = positional[0] ?? snap.project.projectId
    const idx = Number(positional[1] ?? 0)
    const plan = snap.plans?.[idx]
    if (!plan) { console.error(`plans[${idx}] 이 없다. 총 ${snap.plans?.length ?? 0}건`); process.exit(1) }

    console.log(`■ 보낼 것 — ${plan.task.title}`)
    console.log(`  상태 ${plan.task.status} · 우선순위 ${plan.task.priority} · 마감 ${plan.task.endDate} · 담당자 ${plan.worker?.name ?? '(비움)'}`)
    console.log(`  하위업무 ${plan.subtasks.length}건 → ${plan.subtasks.map((s) => s.title).join(' / ')}`)
    if (!rest.includes('--write')) {
      console.log('\n미리보기다. 실제로 쓰려면 --write 를 붙인다. ⚠️ 플로우에 삭제 API 가 없어 되돌릴 수 없다.')
      break
    }
    const r = await submitPlan(flow, projectId, plan)
    console.log(`\n✅ ${r.steps.join(' · ')}`)
    console.log(`   업무 ${r.taskId} · 하위업무 ${r.subtaskIds.join(', ')}`)
    break
  }

  default:
    console.log(HELP)
    process.exit(cmd ? 1 : 0)
}
