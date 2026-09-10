/**
 * 감사 결과 → **플로우 업무 모델**.
 *
 * 이 파일이 있고 없고가 이 도구의 성격을 바꾼다.
 * 없으면 「플로우에서 글을 읽어다 Gemini 에 넣었다」로, 아무 게시판이어도 성립하는 물건이 된다.
 * 있으면 감사 결과가 플로우의 **업무 · 하위업무 · 담당자 · 우선순위 · 마감일 · 상태**로 되돌아간다.
 *
 * | 감사 산출 | 플로우 |
 * |---|---|
 * | 지표 그룹 1개 | 업무 1건 |
 * | 그룹에서 어긋난 주장 N개 | 하위업무 N건 |
 * | 그 수치를 쓴 사람 | 담당자 |
 * | 근거 없음 / 값 충돌 | 우선순위 high / normal |
 * | 확인 요청 | 상태 request |
 *
 * 🔑 **여기서 쓰지 않는다.** 이 파일은 「보낼 몸통」을 만들기만 한다.
 *    플로우에는 삭제 API 가 없어 쓰기를 되돌릴 수 없다 → 미리보기가 기본값이고,
 *    실제 전송은 화면에서 사람이 누를 때만 일어난다.
 */

/**
 * 도구가 만든 업무의 제목 접두사.
 * 🔑 감사 대상에서 이걸 뺀다 — 안 그러면 **도구의 출력이 다음 감사의 입력이 된다.**
 *    등록한 업무 본문에는 인용이 그대로 들어 있어서, 같은 수치가 새 문서에서 또 잡힌다.
 *    (실측: 업무 하나를 등록했더니 다음 감사에서 문서가 12건 → 13건이 됐다)
 */
export const TOOL_TITLE_PREFIX = '[수치 감사]'

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d) }

export const KIND = {
  // 제목과 본문은 **플로우로 나가서 이 화면 없이 혼자 읽힌다.** 「근거」 같은 줄임말을 쓰지 않는다.
  UNSOURCED: { code: 'UNSOURCED', label: '어떻게 쟀는지가 없음', priority: 'high', dueInDays: 3 },
  CONFLICT: { code: 'CONFLICT', label: '값이 갈림', priority: 'normal', dueInDays: 7 },
}

/**
 * 참여자 이름 → 계정 id. 못 찾으면 담당자를 비운다 — 아무나 넣지 않는다.
 * 이 지도는 **서버에서만** 만든다. 스냅샷에는 이름만 실린다.
 */
export function workerIndex(participants = []) {
  const m = new Map()
  for (const p of participants) if (p.name) m.set(p.name, p.userId ?? p.inttId)
  return m
}

const valueKey = (c) => `${c.valueText}${c.unit ?? ''}`.replace(/\s/g, '')
/** 하위업무 제목은 한 줄이어야 한다. 글 제목의 대괄호 태그와 이모지를 걷어낸다. */
const shortTitle = (s) => String(s ?? '').replace(/^\[[^\]]+\]\s*/, '')
  .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 22)

/** 하위업무는 **값 하나가 한 건**이다. 같은 값이 여러 글에 있어도 사람이 닫을 일은 하나다. */
function subtasksFor(kind, flagged) {
  const byValue = new Map()
  for (const c of flagged) {
    const k = valueKey(c)
    if (!byValue.has(k)) byValue.set(k, [])
    byValue.get(k).push(c)
  }
  return [...byValue.entries()].map(([value, cs]) => ({
    title: `${value} — ${cs.length > 1 ? `${cs.length}곳` : `「${shortTitle(cs[0].title)}」`} ${kind.code === 'UNSOURCED' ? '근거 확인' : '확인'}`,
    contents: cs.map(claimLine).join('\n'),
  }))
}

function claimLine(c) {
  const bits = [`- ${c.valueText}${c.unit ?? ''}`, `「${c.title}」`]
  if (c.scope) bits.push(`범위: ${c.scope}`)
  bits.push(c.method ? `방법: ${c.method}` : '방법: 원문에 없음')
  return `${bits.join(' · ')}\n  인용: "${c.quote}"`
}

/**
 * 스냅샷 하나 → 보낼 업무들.
 * @returns {{task, subtasks, worker, kind, group}[]}
 */
export function planTasks(snapshot, { workers = new Map() } = {}) {
  // 글쓴이는 주장에 복사해 두지 않는다 — 문서에 이미 있다. 여기서 조인한다.
  const authorOf = new Map((snapshot.docs ?? []).map((d) => [d.docId, d.author]))
  const byId = new Map(snapshot.claims.map((c) => [c.claimId, { ...c, author: authorOf.get(c.docId) ?? '' }]))
  const plans = []

  for (const v of snapshot.verdicts ?? []) {
    const unsourced = (v.unsourcedIds ?? []).map((id) => byId.get(id)).filter(Boolean)
    const conflicting = (v.disagreementIds ?? []).map((id) => byId.get(id)).filter(Boolean)
    const flagged = unsourced.length ? unsourced : (conflicting.length > 1 ? conflicting : [])
    if (!flagged.length) continue

    const kind = unsourced.length ? KIND.UNSOURCED : KIND.CONFLICT
    const targets = (v.targetIds ?? []).map((id) => byId.get(id)).filter(Boolean)

    const body = [
      `지표: ${v.metric}`,
      '',
      `■ ${kind.label} (${flagged.length}건)`,
      ...flagged.map(claimLine),
      '',
      `■ 같은 지표의 다른 값 ${(v.claimIds?.length ?? 0) - flagged.length}건`,
      ...(v.claimIds ?? []).filter((id) => !flagged.some((f) => f.claimId === id))
        .map((id) => byId.get(id)).filter(Boolean).map(claimLine),
      ...(targets.length ? ['', `■ 목표값: ${targets.map((t) => `${t.valueText}${t.unit ?? ''}`).join(', ')}`] : []),
      '',
      '---',
      '이 업무는 수치 감사 도구가 만들었다. 판정은 다음 두 가지만 본다 —',
      '「인용이 원문에 실재하나」와 「같은 값이 측정 방법과 함께 적힌 곳이 있나」.',
      '숫자가 틀렸다는 뜻이 아니다. 이 프로젝트의 글에서 어떻게 쟀는지를 못 찾았다는 뜻이다.',
    ].join('\n')

    // 담당자 — 그 수치를 쓴 사람. 여러 명이면 첫 번째. 참여자 목록에 없으면 비운다.
    const authors = [...new Set(flagged.map((c) => c.author).filter(Boolean))]
    const workerId = authors.map((a) => workers.get(a)).find(Boolean) ?? null

    plans.push({
      kind: kind.code,
      tier: '1차(그룹 안)',
      metric: v.metric,
      task: {
        title: `${TOOL_TITLE_PREFIX} ${v.metric} — ${kind.label} ${flagged.length}건`,
        contents: body,
        status: 'request',              // 확인 요청이다. 진행이 아니다
        priority: kind.priority,
        endDate: plusDays(kind.dueInDays),
      },
      // 하위업무 = 사람이 한 건씩 닫을 수 있는 단위.
      // 「근거 없음」은 주장 하나가 한 건이고, 「값 갈림」은 **서로 다른 값** 하나가 한 건이다 —
      // 같은 320ms 가 두 글에 있는 걸 두 건으로 쪼개면 할 일이 아니라 소음이 된다.
      subtasks: subtasksFor(kind, flagged),
      worker: workerId ? { name: authors[0] } : null,
      claimIds: flagged.map((c) => c.claimId),
      // 담당자는 **등록할 때 서버가 이 문서들의 글쓴이로 다시 정한다.**
      // 그래서 공개되는 스냅샷에는 사람 이름을 담지 않는다.
      docIds: [...new Set(flagged.map((c) => c.docId))],
    })
  }

  // 2차 — 그룹 밖 대조로 걸린 값. 등급이 다르므로 본문에 그렇게 적는다.
  const byUnit = (snapshot.byUnitIds ?? []).map((id) => byId.get(id)).filter(Boolean)
  const seen = new Set(plans.flatMap((p) => p.claimIds))
  const groupedByMetric = new Map()
  for (const c of byUnit) {
    if (seen.has(c.claimId)) continue
    const k = c.metric ?? '(지표 미상)'
    if (!groupedByMetric.has(k)) groupedByMetric.set(k, [])
    groupedByMetric.get(k).push(c)
  }

  for (const [metric, cs] of groupedByMetric) {
    const unit = cs[0]?.unit ?? ''
    const sameUnitGrounded = snapshot.claims.filter((c) =>
      (c.unit ?? '') === unit && String(c.method ?? '').trim())
    const kind = KIND.UNSOURCED
    const body = [
      `지표: ${metric}`,
      '',
      `■ ${kind.label} (${cs.length}건)`,
      ...cs.map(claimLine),
      '',
      `■ 같은 단위(${unit})로 「어떻게 쟀는지」가 적힌 값`,
      ...sameUnitGrounded.map(claimLine),
      '',
      '---',
      '이 판정은 그룹 밖 대조다. 지표 이름이 아니라 단위만 같은 값들과 견줬다.',
      '글쓴이가 수식어를 생략하면(「p95 응답시간」 → 「검색 응답」) 지표 묶기가 갈라져',
      '그룹 안에서는 대조할 상대가 사라지기 때문이다. 대신 단위만 같고 다른 지표일 수 있다 —',
      '그래서 「숫자가 틀렸다」가 아니라 「이 프로젝트의 글에서 어떻게 쟀는지를 못 찾았다」까지만 말한다.',
    ].join('\n')

    const authors = [...new Set(cs.map((c) => c.author).filter(Boolean))]
    plans.unshift({
      kind: kind.code, tier: '2차(단위 대조)', metric,
      task: {
        title: `${TOOL_TITLE_PREFIX} ${metric} ${cs[0].valueText}${unit} — 측정 방법을 못 찾음`,
        contents: body, status: 'request', priority: kind.priority, endDate: plusDays(kind.dueInDays),
      },
      subtasks: subtasksFor(kind, cs),
      worker: authors.some((a) => workers.get(a)) ? { name: authors[0] } : null,
      claimIds: cs.map((c) => c.claimId),
      docIds: [...new Set(cs.map((c) => c.docId))],
    })
  }

  return plans
}

/**
 * 실제 전송. **화면에서 사람이 누를 때만 부른다.**
 * 되돌릴 수 없으므로 한 건씩, 만들어진 것을 그때그때 돌려준다 — 중간에 끊겨도 무엇이 남았는지 안다.
 */
export async function submitPlan(flow, projectId, plan, { worker = null } = {}) {
  const created = { taskId: null, subtaskIds: [], worker: null, steps: [] }
  const task = await flow.createTask(projectId, {
    title: plan.task.title, contents: plan.task.contents, status: plan.task.status,
    priority: plan.task.priority, endDate: plan.task.endDate,
  })
  created.taskId = String(task.taskId ?? task.postId ?? task.id ?? '')
  created.steps.push(`업무 생성 ${created.taskId}`)

  for (const st of plan.subtasks) {
    const r = await flow.createSubtask(projectId, created.taskId, st)
    created.subtaskIds.push(String(r.subtaskId ?? r.taskId ?? r.id ?? ''))
  }
  created.steps.push(`하위업무 ${created.subtaskIds.length}건`)

  // 담당자는 **호출자(서버)가 정해서 넘긴 것만** 쓴다. 클라이언트가 보낸 이름도 id 도 믿지 않는다.
  if (worker?.userId) {
    await flow.updateTaskWorker(projectId, created.taskId, { workers: [{ workerId: worker.userId }] })
    created.worker = { name: worker.name }
    created.steps.push(`담당자 ${worker.name}`)
  }
  return created
}
