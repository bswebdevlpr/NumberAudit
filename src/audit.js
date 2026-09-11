import { flow, trace as flowTrace } from './flow.js'
import { collectProject, normalizeText } from './collect.js'
import { extractClaims } from './extract.js'
import { clusterClaims } from './cluster.js'
import { judgeRoom, NOT_DONE } from './verdict.js'
import { planTasks, workerIndex } from './task.js'
import { usage, modelChain, trace as geminiTrace } from './gemini.js'

export const SNAPSHOT_VERSION = 1

/**
 * 붙여넣은 글 하나를 감사한다. 플로우를 거치지 않는다.
 *
 * 🔑 **모델 호출을 1회로 묶는다.** 무료 티어가 모델당 하루 20회라, 추출+묶기로 2회씩 쓰면
 *    하루 열 번도 못 눌러 본다. 그래서 지표 묶기는 **코드가 지표명으로** 한다 —
 *    문서가 하나뿐이면 「같은 지표를 다른 이름으로 부른 것」을 가를 일도 거의 없다.
 *    (프로젝트 감사는 문서가 여럿이라 그 판단이 필요해서 모델을 쓴다)
 */
export async function auditText(text, { title = '붙여넣은 글', chain, baseline } = {}) {
  const startedAt = Date.now()
  geminiTrace.length = 0
  const usageBefore = { ...usage, byModel: { ...usage.byModel } }

  const pasteDoc = { docId: 'paste:1', kind: 'post', title, author: '', writtenAt: '', url: '',
    source: 'paste', raw: { content: text, outContent: '', htmlContent: '' }, text: normalizeText(text) }

  // 🔑 **붙여넣은 글만 새로 뽑는다.** 프로젝트 주장은 이미 뽑아 둔 것을 그대로 쓴다 —
  //    비교군이 붙여넣은 글 안에만 있으면 「내 초안의 숫자가 이 프로젝트와 맞나」를 못 본다.
  //    그게 이 도구가 하려던 일 자체다(공지 초안의 250ms).
  const base = { docs: baseline?.docs ?? [], claims: baseline?.claims ?? [] }
  const { claims: fresh, rejected, stats } = await extractClaims([pasteDoc], { chain })

  // 기존 주장과 id 가 겹치면 안 된다. 붙여넣은 것은 P 로 시작한다.
  const pasted = fresh.map((c, i) => ({ ...c, claimId: `P${String(i + 1).padStart(3, '0')}` }))
  const docs = [...base.docs, pasteDoc]
  const claims = [...base.claims, ...pasted]

  let groups
  if (base.claims.length) {
    // 비교군이 있으면 묶기도 모델이 한다 — 지표명 문자열로 얹으면 이름이 조금만 흔들려도 조용히 빠진다.
    groups = (await clusterClaims(claims)).groups
  } else {
    // 비교군이 없으면 글 하나뿐이라 묶을 판단이 거의 없다. 호출을 아낀다.
    const key = (s) => String(s ?? '').replace(/\s/g, '').toLowerCase()
    const buckets = new Map()
    for (const c of claims) {
      const k = key(c.metric)
      if (!buckets.has(k)) buckets.set(k, { metric: c.metric, claimIds: [] })
      buckets.get(k).claimIds.push(c.claimId)
    }
    groups = [...buckets.values()]
  }
  const { verdicts, byUnit } = judgeRoom(claims, groups)
  const draft = {
    docs, claims,
    verdicts: verdicts.map((v) => ({
      metric: v.metric, claimIds: v.claims.map((c) => c.claimId),
      unsourcedIds: v.unsourced.map((c) => c.claimId),
      disagreementIds: v.disagreement.map((c) => c.claimId),
      crossContextIds: v.crossContext.map((c) => c.claimId),
      contexts: v.contexts,
      targetIds: v.targets.map((c) => c.claimId),
    })),
    byUnitIds: byUnit.map((c) => c.claimId),
  }

  return {
    version: SNAPSHOT_VERSION, at: new Date().toISOString(), ms: Date.now() - startedAt,
    mode: 'paste', groupedBy: base.claims.length ? 'model' : 'code',
    pasteDocId: pasteDoc.docId,
    plans: planTasks(draft),
    project: { projectId: null, title },
    docs, claims, rejected, groups, dangling: [], duplicated: [], outOfGroup: [], ungrouped: [],
    verdicts: draft.verdicts, byUnitIds: draft.byUnitIds,
    stats: { ...stats, docs: docs.length, pasted: pasted.length },
    model: {
      chain: modelChain(),
      byModel: Object.fromEntries(Object.entries(usage.byModel)
        .map(([m, n]) => [m, n - (usageBefore.byModel[m] ?? 0)]).filter(([, n]) => n > 0)),
      calls: usage.calls - usageBefore.calls,
      promptTokens: usage.promptTokens - usageBefore.promptTokens,
      outputTokens: usage.outputTokens - usageBefore.outputTokens,
      retries: usage.retries - usageBefore.retries,
    },
    trace: { flow: [], gemini: [...geminiTrace] },
    notDone: NOT_DONE,
  }
}

/**
 * 프로젝트 하나를 감사해 **스냅샷 하나**로 만든다.
 *
 * 스냅샷은 화면이 읽는 유일한 입력이다. 화면은 라이브 호출에 의존하지 않는다 —
 * 무료 티어가 모델당 하루 20회라, 데모가 열릴 때마다 호출하면 그날 21번째 방문자는 빈 화면을 본다.
 * (개발 중에 실제로 한도를 소진해 측정이 막힌 적이 있다. 링크를 연 사람에게 그 일이 나면 화면이 빈다)
 *
 * 그래서 스냅샷에는 **화면이 근거를 펼 때 필요한 것을 전부** 담는다 —
 * 원문 전문(인용 하이라이트용) · 요청/응답 로그 · 프롬프트 원문 · 폐기된 주장과 그 사유까지.
 */
export async function auditProject(projectId, { title } = {}) {
  const startedAt = Date.now()
  flowTrace.length = 0
  geminiTrace.length = 0
  const usageBefore = { ...usage, byModel: { ...usage.byModel } }

  let projectTitle = title
  if (!projectTitle) {
    const found = (await flow.listProjects()).find((p) => String(p.projectId) === String(projectId))
    projectTitle = found?.title ?? ''
  }

  const docs = await collectProject(projectId)
  const { claims, rejected, stats, batches } = await extractClaims(docs)
  const { groups, dangling, duplicated, outOfGroup, ungrouped } = await clusterClaims(claims)
  const { verdicts, byUnit } = judgeRoom(claims, groups)

  // 참여자는 담당자 지정에 쓴다. 플로우 호출이라 Gemini 예산과 무관하다.
  let participants = []
  try { participants = (await flow.listParticipants(projectId))?.participants ?? [] } catch { /* 권한 없으면 담당자를 비운다 */ }

  const draft = {
    version: SNAPSHOT_VERSION,
    at: new Date().toISOString(),
    ms: Date.now() - startedAt,
    project: { projectId: String(projectId), title: projectTitle },
    docs,
    // 전에 이 도구가 만들어 둔 업무. 감사 대상은 아니지만 화면 마지막 칸에 보인다.
    toolPosts: docs.toolPosts ?? [],
    fingerprint: docs.fingerprint ?? null,
    claims,
    rejected,
    groups, dangling, duplicated, outOfGroup, ungrouped,
    // 화면은 claimId 로 되짚는다 — 주장 본문을 두 번 담지 않는다
    verdicts: verdicts.map((v) => ({
      metric: v.metric,
      claimIds: v.claims.map((c) => c.claimId),
      unsourcedIds: v.unsourced.map((c) => c.claimId),
      disagreementIds: v.disagreement.map((c) => c.claimId),
      // 조건이 갈려 견주지 않은 값. 지우지 않고 등급만 달리 적는다.
      crossContextIds: v.crossContext.map((c) => c.claimId),
      contexts: v.contexts,
      targetIds: v.targets.map((c) => c.claimId),
    })),
    // 2차 — 그룹 밖 대조(단위만 같음). 1차와 등급이 다르므로 따로 담는다.
    byUnitIds: byUnit.map((c) => c.claimId),
    stats: { ...stats, docs: docs.length, batches },
    model: {
      chain: modelChain(),
      byModel: Object.fromEntries(Object.entries(usage.byModel)
        .map(([m, n]) => [m, n - (usageBefore.byModel[m] ?? 0)]).filter(([, n]) => n > 0)),
      calls: usage.calls - usageBefore.calls,
      promptTokens: usage.promptTokens - usageBefore.promptTokens,
      outputTokens: usage.outputTokens - usageBefore.outputTokens,
      retries: usage.retries - usageBefore.retries,
    },
    trace: { flow: [...flowTrace], gemini: [...geminiTrace] },
    notDone: NOT_DONE,
    // 🔑 id 를 스냅샷에 넣지 않는다. 이 파일은 브라우저로 그대로 내려가고 저장소에도 들어간다 —
    // 사람의 계정 id 가 공개물에 실릴 이유가 없다. 담당자는 쓸 때 서버가 이름으로 다시 찾는다.
    // 사람 이름을 스냅샷에 담지 않는다. 이 파일은 브라우저로 내려가고 저장소에도 들어간다.
    // 담당자는 등록할 때 서버가 참여자 목록에서 다시 정한다.
    participantCount: participants.length,
  }

  // 「업무로 되돌리기」 미리보기까지 스냅샷에 담는다 — 화면은 계산하지 않고 그리기만 한다.
  // 담당자는 여기서 정하지 않는다(이름이 공개물에 실린다). 등록 시점에 서버가 정한다.
  const plans = planTasks(draft)
  return { ...draft, docs: draft.docs.map(({ author, ...d }) => d), plans }
}
