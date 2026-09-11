// 저장소 링크 — 화면에서 걷어낸 설명(측정 기록·경계·재현 명령)이 여기 있다.
const REPO = 'https://github.com/bswebdevlpr/number-audit'

import { checkClaim } from './lib/gate.js'

const $ = (s) => document.querySelector(s)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
import { valueLabel } from './lib/value.js'

const val = (c) => valueLabel(c)
/** 받침에 따라 「(으)로」를 고른다. 「초안로」 같은 문장이 나오면 화면이 대충 만든 티가 난다. */
function ro(word) {
  const last = String(word ?? '').trim().slice(-1)
  const code = last.charCodeAt(0)
  if (!(code >= 0xac00 && code <= 0xd7a3)) return '로'
  const jong = (code - 0xac00) % 28
  return jong === 0 || jong === 8 ? '로' : '으로'
}

const short = (s, n = 34) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + '…' : t }

/**
 * 원문에서 인용 구간을 찾는다 — 공백을 무시하고 맞춘다.
 * 게이트가 대조할 때 쓰는 규칙과 같은 축이다. 화면만 느슨하면 하이라이트가 거짓말이 된다.
 */
function locateQuote(source, quote) {
  const q = [...String(quote ?? '')].filter((c) => !/\s/.test(c))
  if (!q.length) return null
  for (let s = 0; s < source.length; s++) {
    let i = s, k = 0
    while (i < source.length && k < q.length) {
      const c = source[i]
      if (/\s/.test(c)) { i++; continue }
      if (c !== q[k]) break
      i++; k++
    }
    if (k === q.length) return [s, i]
  }
  return null
}

/**
 * 저장된 스냅샷을 먼저 그린다. 그다음 서버에 「지금 다시 감사」를 시키고, 오면 갈아 끼운다.
 * 링크는 어떤 경우에도 죽지 않고, 살아 있으면 방금 돈 결과가 보인다.
 * 라이브가 실패하면(한도 소진·모델 장애) 저장된 결과를 그대로 두고 **사유를 화면에 적는다.**
 */
let snap = await fetch('snapshot.json').then((r) => r.json())
let demoSnap = snap
let claims, flagged, docs, byUnitSet, writtenAt, gemini
const claimsOf = (docId) => snap.claims.filter((c) => c.docId === docId)
const rejectedOf = (docId) => snap.rejected.filter((c) => c.docId === docId)

function derive() {
  claims = new Map(snap.claims.map((c) => [c.claimId, c]))
  flagged = new Set([...(snap.byUnitIds ?? []), ...snap.verdicts.flatMap((v) => v.unsourcedIds ?? [])])
  byUnitSet = new Set(snap.byUnitIds ?? [])
  writtenAt = new Map(snap.docs.map((d) => [d.docId, String(d.writtenAt ?? '')]))
  gemini = (snap.trace?.gemini ?? [])[0]
  docs = [...snap.docs].sort((a, b) =>
    (claimsOf(b.docId).some((c) => flagged.has(c.claimId)) ? 1 : 0) - (claimsOf(a.docId).some((c) => flagged.has(c.claimId)) ? 1 : 0))
}
derive()

$('#repoLink').href = REPO

// ── 히어로 — 스냅샷에서 다시 계산한다. 손으로 옮겨 적지 않는다 ───────────
const leadClaim = [...flagged].map((id) => claims.get(id)).filter(Boolean)[0]
/**
 * 출처 사슬 — 숫자 → 적힌 글 → 어떻게 쟀다고 적혀 있나.
 * 같은 내용을 표로 늘어놓으면 「값이 여럿이다」로만 읽힌다. 사슬로 그리면
 * 어느 줄이 끝까지 이어지고 어느 줄이 끊기는지가 먼저 보인다.
 * 값·글·방법은 전부 스냅샷에서 다시 계산한다 — 화면에 손으로 적지 않는다.
 */
const cleanTitle = (s) => String(s ?? '').replace(/^\[[^\]]+\]\s*/, '').replace(/\s*—\s*댓글$/, '')
const isComment = (c) => String(c.docId ?? '').startsWith('comment:')
const byTime = (x, y) => String(writtenAt.get(x.docId)).localeCompare(String(writtenAt.get(y.docId)))

function traceRow(c, here) {
  const miss = flagged.has(c.claimId)
  return `<div class="tr${miss ? ' miss' : ''}">
      <div class="v">${esc(val(c))}${c.isTarget ? '<span class="chip" style="margin-left:6px">목표</span>' : ''}</div>
      <div class="where">${isComment(c) ? '<span class="chip">댓글</span>' : ''}<span>${esc(cleanTitle(c.title))}</span>${c.docId === here ? '<b class="mine">← 이 문서</b>' : ''}</div>
      <div class="how">${c.method ? esc(c.method) : '어디에도 적혀 있지 않음'}</div>
    </div>`
}

/**
 * 비교군을 **한 곳에서** 정한다.
 *
 * 평소에는 같은 지표 그룹 안에서만 모으고, **2차(그룹 밖 대조)로 걸린 값이 있을 때만**
 * 그 값과 단위가 같은 것을 프로젝트 전체에서 끌어온다. 단위 비교는 문자열 완전 일치다.
 *
 * ⚠️ 한때 머리글과 사슬이 **각자 계산**했다. 머리글은 그룹을 안 보고 단위만 봤고 사슬은 그룹을 봤다 —
 *    1차(그룹 안)로 걸리는 경우 **머리글이 표에 없는 값을 언급**했다. 화면 두 곳이 같은 데이터를 다르게 센 것이다.
 */
function comparisonSet(cs, v) {
  // 조건 묶음은 모델이 갈랐고 코드가 되짚은 것이다. 머리글·사슬이 같은 지도를 본다.
  const condOf = new Map()
  for (const ctx of v?.contexts ?? []) for (const id of ctx.claimIds ?? []) condOf.set(id, ctx.condition)
  const bare = cs.filter((c) => !String(c.method ?? '').trim()).sort(byTime)
  const viaUnit = bare.filter((c) => byUnitSet.has(c.claimId))
  const inGroup = cs.filter((c) => String(c.method ?? '').trim())
  const outGroup = viaUnit.length
    ? snap.claims.filter((c) => String(c.method ?? '').trim() &&
        viaUnit.some((m) => (m.unit ?? '') === (c.unit ?? '')) && !inGroup.includes(c))
    : []
  return { bare, viaUnit, inGroup, outGroup, condOf, grounded: [...inGroup, ...outGroup].sort(byTime) }
}

/**
 * 지표 그룹 하나를 사슬로 그린다. 비교군은 위에서 이미 정해진 것을 받는다.
 * 🔑 조건이 둘 이상이면 **측정 기록을 조건별로 가른다.** 나란히 놓으면 견줄 수 있는 값처럼 읽힌다.
 */
function traceBlock(cs, here, set) {
  const { bare, outGroup, grounded, condOf } = set
  const hasMiss = bare.some((c) => flagged.has(c.claimId))
  const OTHER = '단위만 같은 다른 지표'
  const conds = [...new Set(grounded.map((c) => condOf.get(c.claimId) ?? OTHER))]
  const groundedRows = conds.length > 1
    ? conds.map((cond) => `<div class="cond">조건 · ${esc(cond)}</div>` +
        grounded.filter((c) => (condOf.get(c.claimId) ?? OTHER) === cond).map((c) => traceRow(c, here)).join('')).join('')
    : grounded.map((c) => traceRow(c, here)).join('')
  return `<div class="trace">
    <div class="th"><div>숫자</div><div>적힌 글</div><div>어떻게 쟀다고 적혀 있나</div></div>
    ${grounded.length ? `<div class="cut">측정 기록 — 방법이 함께 적혀 있다${outGroup.length ? ' · 단위가 같은 값을 프로젝트 전체에서 모았습니다' : ''}</div>${groundedRows}` : ''}
    ${bare.length ? `<div class="cut">방법이 적혀 있지 않은 값</div>${bare.map((c) => traceRow(c, here)).join('')}` : ''}
    ${conds.filter((c) => c !== OTHER).length > 1 ? '<div class="foot">조건이 서로 다른 값은 <b>견주지 않습니다.</b> 같은 조건으로 잰 값끼리만 비교합니다.</div>' : ''}
    ${hasMiss ? '<div class="foot">틀렸다는 판정이 아닙니다 — <b>감사한 글에서 근거를 찾지 못했다</b>는 표시입니다.</div>' : ''}
  </div>`
}

/** 스냅샷이 바뀌면 통계·원문 목록·푸터를 다시 그린다. */
function paint() {
  $('#docCount').textContent = `${docs.length}건`
  $('#docList').innerHTML = docs.map((d, i) => {
  const cs = claimsOf(d.docId), bad = cs.filter((c) => flagged.has(c.claimId)).length
  const judged = snap.verdicts.some((v) => v.claimIds.some((id) => cs.some((c) => c.claimId === id)))
  // 댓글은 제목이 부모 글 것이라 그대로 두면 같은 줄이 여러 개가 된다. 내용을 제목 자리에 둔다.
  // 본문은 아래 펼치기로 본다 — 앞머리를 같이 보이면 같은 글이 두 번 나온다.
  const head = d.kind === 'comment' ? d.text : d.title
  // 수치가 없거나 어느 지표에도 안 묶인 글은 흐리게 둡니다. 목록에서 빼지는 않습니다 —
  // 안 보이면 「없는 것」이 되고, 그건 감사 범위를 숨기는 것입니다.
  return `<div class="docitem">
    <button class="docrow${judged ? '' : ' idle'}" data-i="${i}" aria-current="false">
      <span class="t">${esc(head)}</span>
      <span class="s"><span class="chip">${d.kind === 'comment' ? '댓글' : '글'}</span>
        수치 ${cs.length}${bad ? ` <span class="chip flag">근거 없음 ${bad}</span>` : judged ? '' : ' · 판정 없음'}</span>
    </button>
    <button class="docmore" data-more="${i}" aria-expanded="false">본문 펼치기</button>
    <div class="docbody" data-body="${i}" hidden>${esc(d.text)}</div>
  </div>`
  }).join('')

  $('#foot').innerHTML = `프로젝트 ${esc(snap.project.projectId)} · 모델 ${esc(Object.entries(snap.model.byModel).map(([m, n]) => `${m}×${n}`).join(' · '))}
    · 호출 ${snap.model.calls}회 · ${(snap.ms / 1000).toFixed(1)}초
    <br>데모 데이터는 API 로 심어 작성자가 모두 같습니다. 담당자 매핑은 참여자가 여럿인 프로젝트에서 갈립니다.${
      snap.live && snap.claims.length !== demoSnap.claims.length
        ? `<br>지금 화면은 방금 돌린 결과입니다. 라이브는 함수 상한(60초) 안에 들어와야 해서 빠른 모델로 돌고,
           저장본은 상위 모델로 만든 것이라 ${demoSnap.claims.length}건입니다.` : ''}`
}

const STEP_NAMES = ['수집', '정제', '추출', '게이트', '판정', '업무']

/** 여섯 단계 지도 — 늘 보인다. 지금 어디까지 왔는지가 곧 내비게이션이다. */
function paintMap() {
  $('#flowMap').innerHTML = STEP_NAMES.map((name, i) => {
    const n = i + 1
    const cls = state.doc === null || state.doc === 'paste' ? ''
      : n < state.revealed ? 'done' : n === state.revealed ? 'current' : ''
    return `<li class="${cls}"><button data-step="${n}"><b>${n}</b>${name}</button></li>`
  }).join('')
}

$('#flowMap').addEventListener('click', (e) => {
  const b = e.target.closest('[data-step]'); if (!b) return
  const n = Number(b.dataset.step)
  if (state.doc === null || state.doc === 'paste' || n > state.revealed) return   // 아직 안 연 단계로는 못 건너뛴다
  document.querySelectorAll('.stepcard')[n - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
})

// ── 단계 ────────────────────────────────────────────────────────────────
function stepCard(n, name, summary, body, open) {
  return `<details class="stepcard"${open ? ' open' : ''}>
    <summary><span class="n">${n}</span><span class="nm">${name}</span><span class="sm">${summary}</span></summary>
    <div class="body">${body}</div></details>`
}

function highlightSection(prompt, docId) {
  const mark = `### ${docId}`
  const at = prompt.indexOf(mark)
  if (at < 0) return esc(prompt.slice(0, 1800))
  const end = prompt.indexOf('\n\n### ', at + 1)
  const stop = end < 0 ? prompt.length : end
  const from = Math.max(0, at - 260), to = Math.min(prompt.length, stop + 260)
  return (from ? '…\n' : '') + esc(prompt.slice(from, at)) +
    '<mark>' + esc(prompt.slice(at, stop)) + '</mark>' + esc(prompt.slice(stop, to)) + (to < prompt.length ? '\n…' : '')
}


/**
 * 게이트가 실제로 버린 기록 — **그 일이 실제로 있었던 글에만** 붙인다.
 * 폐기는 모델이 없는 인용을 만들어야 생기므로 데모 데이터로 심을 수 있는 것이 아니다.
 * 라운드 4 에서 걸린 실측 한 건을 그대로 보인다 — 지어낸 실패를 심지 않는다.
 */
const ROUND4_DOC = '요청당 쿼리가 47회 나갑니다'

function recordedReject(d, rejectedHere) {
  if (rejectedHere || !String(d.text ?? '').includes(ROUND4_DOC)) return ''
  return `<div class="recorded">
    <span class="lbl">이 글에서 실제로 걸렀던 기록 · 라운드 4 측정</span>
    <p class="rl">지금은 통과하지만, 실제 플로우 데이터로 처음 감사했을 때 이 글의 인용 하나가 여기서 버려졌습니다.</p>
    <div class="pre">✗ "- 요청당 쿼리가 47회 나갑니다."  (값 47)  →  폐기 · 인용이 원문에 없음
원문   … - 목록 조회에서 N+1이 납니다. 요청당 쿼리가 47회 나갑니다. - p95 820ms …</div>
    <p class="rl"><b>47회</b>는 이 글에 실제로 적혀 있습니다. 모델이 앞줄의 불릿 <code>- </code>를 끌어다
    원문에 없는 문장을 만들었을 뿐입니다. 게이트가 보는 것은 값이 맞는지가 아니라 <b>인용이 원문에 실재하는지</b>라서,
    참인 주장이 거짓 인용 때문에 버려졌습니다.</p>
    <p class="rl">원인은 줄바꿈을 공백 하나로 뭉개던 정제 코드였습니다. 고친 뒤로는 재현되지 않습니다.</p>
  </div>`
}

function render(i) {
  const d = docs[i]
  document.querySelectorAll('.docrow').forEach((el) => el.setAttribute('aria-current', String(Number(el.dataset.i) === i)))

  // 1 수집 — 이 문서를 가져온 실제 호출
  const calls = (snap.trace?.flow ?? []).filter((t) => t.path.includes(String(d.postId)))
  const s1 = snap.mode === 'paste'
    ? '<div class="pre">붙여넣은 글이 플로우에 올라와 있다고 가정하고, 수집을 건너뜁니다.</div>'
    : calls.length
    ? `<div class="pre">${calls.map((t) => `${t.method} ${esc(t.path)}  → HTTP ${t.http} · success=${t.success} · ${t.ms}ms\n  data: ${esc(t.dataKeys.join(', '))}`).join('\n\n')}</div>`
    : '<div class="pre">상위 글의 응답에 함께 실려 왔습니다.</div>'

  // 2 정제 — 본문이 세 벌로 온다
  const raw = d.raw ?? {}
  const bin = (k, v) => `<div><span class="lbl">${k}${d.source?.startsWith(k) ? ' · 사용' : ''}</span>
    <div class="pre">${v ? esc(v) : '(비어 있음)'}</div></div>`
  const s2 = snap.mode === 'paste'
    ? `<span class="lbl">붙여넣은 원문</span><div class="pre">${esc(raw.content)}</div>
       <span class="lbl">정제 결과</span><div class="pre">${esc(d.text)}</div>`
    : `<div class="twocol">${bin('content', raw.content)}${bin('outContent', raw.outContent)}</div>
    <div style="margin-top:12px">${bin('htmlContent', raw.htmlContent)}</div>
    <span class="lbl">정제 결과</span><div class="pre">${esc(d.text)}</div>`

  // 3 추출 — 배치다. 이 문서 구간만 강조한다
  const mine = claimsOf(d.docId)
  const batched = snap.stats.docs > 1
  const tok = gemini ? `입력 ${gemini.promptTokens.toLocaleString()} · 출력 ${gemini.outputTokens.toLocaleString()} 토큰` : ''
  const s3 = gemini ? `
    <div class="why">
      ${batched
        ? `<b>${snap.stats.docs}개 문서를 한 번에 넣습니다.</b> 문서당 1회로 부르면 무료 한도(모델당 하루 20회)에서
           <b>하루 20문서가 천장</b>이라, 프로젝트 하나를 다 못 읽습니다.`
        : '<b>붙여넣은 글 하나만 넣습니다.</b>'}
      <span class="q">${esc(gemini.model)} · 배치 ${JSON.stringify(snap.stats.batches)} · ${esc(tok)}</span>
    </div>
    <span class="lbl">프롬프트 원문${batched ? ' — 이 문서 구간 강조' : ''}</span>
    <div class="pre">${highlightSection(String(gemini.prompt), d.docId)}</div>
    <span class="lbl">응답 JSON 중 이 문서 몫</span>
    <div class="pre">${esc(JSON.stringify(mine.map(({ docId, metric, valueText, unit, scope, method, isTarget, quote }) =>
      ({ docId, metric, valueText, unit, scope, method, isTarget, quote })), null, 1))}</div>`
    : '<div class="pre">프롬프트 원문이 스냅샷에 없습니다.</div>'

  // 4 게이트 — 인용을 원문에서 켠다
  const rej = rejectedOf(d.docId)
  const rows = [...mine.map((c) => ({ c, ok: true })), ...rej.map((c) => ({ c, ok: false }))]
  const s4 = rows.length ? rows.map(({ c, ok }) => {
    const at = locateQuote(d.text, c.quote)
    return `<div style="margin-bottom:14px">
      <div style="display:flex;gap:8px;align-items:baseline;margin-bottom:6px">
        <b class="num">${esc(val(c))}</b><span class="muted" style="font-size:13px">${esc(c.metric ?? '')}</span>
        ${ok ? `<span class="chip ok" style="margin-left:auto">원문에서 찾음 · ${esc(c.gateTier)}</span>`
             : `<span class="chip flag" style="margin-left:auto">폐기 · ${esc(c.reason)}</span>`}
      </div>
      ${ok && c.alsoIn?.length ? `<div class="alsoin">같은 문장이 <b>${c.alsoIn.map((a) => esc(a.title || a.docId)).join('</b> · <b>')}</b>에도 있습니다 —
        어느 글에서 온 값인지 가리지 못했습니다.</div>` : ''}
      <div class="pre">${at ? esc(d.text.slice(0, at[0])) + '<mark>' + esc(d.text.slice(at[0], at[1])) + '</mark>' + esc(d.text.slice(at[1])) : esc(d.text)}</div>
    </div>`
  }).join('') + recordedReject(d, rej.length) + playground(d, mine[0])
    : '<div class="empty">이 글에서 뽑힌 수치가 없습니다.</div>'

  // 5 판정 — 여기서 문서 밖으로 나간다
  const groups = snap.verdicts.filter((v) => v.claimIds.some((id) => mine.some((c) => c.claimId === id)))

  /** 이 블록의 이름이 「판정」이다. 표만 놓지 말고 **판정을 먼저 말한다.** */
  /** 머리글은 **사슬이 실제로 그린 비교군**을 말한다. 따로 계산하지 않는다. */
  function verdictHead(v, cs, set) {
    const bad = cs.filter((c) => flagged.has(c.claimId))
    if (bad.length) {
      const vals = [...new Set(bad.map(val))]
      const unit = bad[0].unit ?? ''
      const grounded = [...new Set(set.grounded.map(val))]
      // 범위를 넓혔으면 「같은 단위」, 그룹 안에서만 봤으면 「같은 지표」다. 실제로 견준 것을 그대로 적는다.
      const scope = set.outGroup.length ? `같은 ${esc(unit)} 값` : '같은 지표의 값'
      return { cls: 'flag', chip: '근거 없음',
        line: `<b>${esc(vals.join(' · '))}</b>를 어떻게 쟀는지 <b>감사한 글·댓글 ${snap.stats.docs}건</b> 어디에도 적혀 있지 않습니다.`,
        sub: grounded.length ? `${scope} ${grounded.map((g) => esc(g)).join(' · ')}에는 어떻게 쟀는지가 적혀 있습니다.` : '' }
    }
    // 갈림은 **같은 조건 안에서만** 센다. 조건이 달라 견주지 않은 값은 지우지 않고 따로 적는다.
    const dis = (v.disagreementIds ?? []).map((id) => claims.get(id)).filter(Boolean)
    const cross = (v.crossContextIds ?? []).map((id) => claims.get(id)).filter(Boolean)
    const measured = cs.filter((c) => !c.isTarget).sort(byTime)
    const targets = cs.filter((c) => c.isTarget).map(val)
    const targetLine = targets.length ? `목표는 ${esc(targets.join(' · '))}입니다.` : ''
    const crossLine = cross.length
      ? `${esc([...new Set(cross.map(val))].join(' · '))}는 잰 조건이 달라 견주지 않았습니다.` : ''
    const disVals = [...new Set(dis.map(val))]
    if (disVals.length > 1) {
      // 조건 축이 실제로 일한 경우에만 「조건」이라고 말한다. 전부 미기재면 예전 문구가 맞다.
      const head = cross.length ? '같은 조건끼리 견줬을 때' : '같은 지표에'
      return { cls: '', chip: '값이 갈림',
        line: `${head} <b>${esc(disVals.join(' · '))}</b>가 함께 적혀 있습니다.`,
        sub: [crossLine, targetLine].filter(Boolean).join(' ') }
    }
    if (cross.length) {
      return { cls: '', chip: '조건이 다름',
        line: `값이 여럿이지만 <b>잰 조건이 서로 달라 견주지 않았습니다.</b>`,
        sub: targetLine }
    }
    const vals = [...new Set(measured.map(val))]
    if (vals.length > 1) {
      return { cls: '', chip: '값이 갈림',
        line: `같은 지표에 <b>${esc(vals.join(' · '))}</b>가 함께 적혀 있습니다.`,
        sub: targetLine }
    }
    return { cls: 'ok', chip: '어긋남 없음', line: `<b>${esc(vals[0] ?? '')}</b> 하나뿐입니다. 어긋나는 값이 없습니다.`, sub: '' }
  }

  const s5 = groups.length ? groups.map((v) => {
    const cs = v.claimIds.map((id) => claims.get(id)).filter(Boolean)
    const set = comparisonSet(cs, v)
    const h = verdictHead(v, cs, set)
    return `<div style="margin-bottom:18px">
      <div class="verdict ${h.cls}">
        <div class="vh"><span class="chip ${h.cls}">${h.chip}</span><b>${esc(v.metric)}</b></div>
        <p>${h.line}</p>
        ${h.sub ? `<p class="s">${h.sub}</p>` : ''}
      </div>
      ${traceBlock(cs, d.docId, set)}
    </div>`
  }).join('') : `<div class="empty">${mine.length
    ? `이 글의 수치 ${mine.length}건은 다른 글의 지표와 묶이지 않았습니다. 대조할 상대가 없어 판정하지 않습니다.`
    : '이 글에는 수치 주장이 없습니다.'}</div>`

  const badCount = groups.filter((v) => v.claimIds.some((id) => flagged.has(id))).length
  const conflictCount = groups.filter((v) => !v.claimIds.some((id) => flagged.has(id)) && (
    v.disagreementIds
      ? v.disagreementIds.length > 0
      : new Set(v.claimIds.map((id) => claims.get(id)).filter((c) => c && !c.isTarget).map(val)).size > 1)).length
  const s5sum = [badCount ? `근거 없음 ${badCount}` : '', conflictCount ? `값이 갈림 ${conflictCount}` : '']
    .filter(Boolean).join(' · ') || `지표 ${groups.length}개`

  // 6 업무
  const plans = (snap.plans ?? []).map((p, pi) => ({ p, pi }))
    .filter(({ p }) => p.claimIds.some((id) => mine.some((c) => c.claimId === id)))
  const s6 = plans.length ? plans.map(({ p, pi }) => `
    <div style="margin-bottom:14px">
      <b>${esc(p.task.title)}</b>
      <div class="task-fields" style="margin:8px 0">
        <span class="chip accent">상태 ${esc(p.task.status)}</span>
        <span class="chip ${p.task.priority === 'high' ? 'flag' : ''}">우선순위 ${esc(p.task.priority)}</span>
        <span class="chip">마감 ${esc(p.task.endDate)}</span>
<span class="chip">담당자 ${p.worker?.name ? esc(p.worker.name) : '등록할 때 글쓴이로 지정'}</span>
        <span class="chip">${esc(p.tier ?? '')}</span>
      </div>
      <div class="pre">${esc(p.task.contents)}</div>
      <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
        <button class="btn" data-plan="${pi}">플로우에 등록</button>
        <span class="muted" style="font-size:12px">하위업무 ${p.subtasks.length}건이 함께 만들어진다</span>
      </div>
      <p class="warnline">⚠️ 플로우에 삭제 API 가 없습니다. 등록하면 웹에서 직접 지워야 합니다.</p>
    </div>`).join('') : `<div class="empty">${mine.length ? '이 글에서 어긋난 값을 찾지 못했습니다.' : '이 글에는 수치 주장이 없습니다.'}</div>`

  const STEPS = [
    { n: 1, name: '수집', sum: `호출 ${calls.length}회`, body: s1 },
    { n: 2, name: '정제', sum: `${esc(d.source ?? '')} → ${d.text.length}자`, body: s2 },
    { n: 3, name: '추출', sum: `주장 ${mine.length}건 · 배치 1회`, body: s3 },
    { n: 4, name: '게이트', sum: `통과 ${mine.length} · 폐기 ${rej.length}`, body: s4 },
    { n: 5, name: '판정', sum: s5sum, body: s5, before: '<div class="divider">이 문서 밖 — 프로젝트 전체와 대조</div>' },
    { n: 6, name: '업무', sum: plans.length ? `${plans.length}건` : '없음', body: s6 },
  ]

  // 한 번에 다 펴지 않는다. 지금까지 연 단계까지만 그리고, 마지막 것만 열어 둔다.
  const shown = STEPS.slice(0, state.revealed)
  const next = STEPS[state.revealed]
  $('#steps').innerHTML =
    shown.map((s, i) => (s.before ?? '') + stepCard(s.n, s.name, s.sum, s.body, i === shown.length - 1)).join('') +
    (next
      ? `<button class="btn next" data-next>다음 · ${next.n} ${next.name} →</button>`
      : `<div class="donebar">
           <span>여섯 단계를 모두 봤습니다</span>
           <button class="btn ghost" data-restart>처음부터</button>
         </div>`)
}

let tryBudget = null

function renderPaste(msg = '', busy = false) {
  const b = tryBudget
  // 🔑 Gemini 는 남은 횟수를 알려주지 않는다. 소진되면 그때 RESOURCE_EXHAUSTED 로 알 뿐이다.
  //    그래서 여기 적는 숫자는 **내가 건 가드의 잔여**다. 그렇게 적는다.
  const left = b
    ? `<span class="quota${b.remaining === 0 ? ' out' : ''}">시험 실행 <b>${b.remaining}</b> / ${b.limit} 남음</span>`
    : ''
  const dry = b && b.remaining === 0
  $('#steps').innerHTML = `<div class="intro pastepen">
    <div class="k">내 글로 해보기 ${left}</div>
    <h2>수치가 든 글을 붙여넣어 보세요</h2>
    <textarea id="pasteText" rows="7" placeholder="예) 응답시간 420ms에서 180ms로 개선했습니다(스테이징, 동시 20 기준). 고객 공지에는 150ms로 개선이라고 적었습니다."></textarea>
    <div class="prow">
      <button class="btn" id="pasteRun"${busy || dry ? ' disabled' : ''}>${busy ? '감사하는 중…' : '감사하기'}</button>
      <button class="btn ghost" id="pasteBack">데모로 돌아가기</button>
    </div>
    ${msg ? `<p class="perr">${esc(msg)}</p>` : ''}
    <span class="hint">붙여넣은 글이 플로우에 올라와 있다고 가정하고 추출부터 돌립니다.
      ${b ? `모델 호출 1회를 씁니다 · ${b.maxChars}자까지 · ${Math.round(b.perIpMs / 1000)}초 간격` : ''}</span>
  </div>`
}

/** 시작 전 화면 — 무엇을 볼 것인지부터 고른다. */
function renderIntro() {
  // 빈 프로젝트에서 죽지 않는다. 「고장」과 「감사할 게 없음」은 다르고, 화면이 그걸 말해야 한다.
  if (!docs.length) {
    $('#steps').innerHTML = `<div class="intro">
      <div class="k">워크플로 예시</div>
      <h2>감사할 글이 없습니다</h2>
      <span class="hint">이 프로젝트에는 읽을 글이나 댓글이 없습니다.</span>
    </div>`
    return
  }
  const pick = docs.findIndex((x) => claimsOf(x.docId).some((c) => flagged.has(c.claimId)))
  const d = docs[pick < 0 ? 0 : pick]
  // 제목에서 대괄호 태그·꼬리 문구·이모지를 걷어 짧은 이름만 남긴다
  const label = String(d.title).replace(/^\[[^\]]+\]\s*/, '').replace(/\s*—.*$/, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim()

  $('#steps').innerHTML = `<div class="intro">
    <div class="k">워크플로 예시</div>
    <h2>글 하나가 업무가 되기까지</h2>
    <dl class="brief">
      <dt>푸는 문제</dt>
      <dd><b>같은 숫자가 글마다 다르게 적히고</b>, 그 숫자를 <b>어떻게 쟀는지</b>는 어디에도 남지 않습니다.</dd>
      <dt>쓰는 방법</dt>
      <dd>플로우 API 로 글과 댓글을 읽고, Gemini 가 수치를 뽑고,
          <b>인용이 원문에 실재하는지는 코드가 확인합니다.</b></dd>
    </dl>
    <button class="btn" data-start="${pick < 0 ? 0 : pick}">예시 불러오기</button>
    <span class="hint">「${esc(label)}」${ro(label)} 여섯 단계를 따라갑니다 · 왼쪽에서 다른 원문을 골라도 됩니다</span>
  </div>`
}

const state = { doc: null, revealed: 0 }
function show() {
  state.doc === 'paste' ? renderPaste() : state.doc === null ? renderIntro() : render(state.doc)
  paintMap()
  document.querySelectorAll('.playpen').forEach(runPlayground)
}

$('#pasteBtn').addEventListener('click', async () => {
  state.doc = 'paste'; state.revealed = 0; show()
  try {
    tryBudget = await fetch('/api/try').then((r) => r.json())
    if (state.doc === 'paste') renderPaste()
  } catch { /* 서버가 없으면 잔여를 안 적는다 — 거짓 숫자를 보이는 것보다 낫다 */ }
})

$('#steps').addEventListener('click', async (e) => {
  if (e.target.closest('#pasteBack')) {
    snap = demoSnap; derive(); paint(); state.doc = null; state.revealed = 0; return show()
  }
  const run = e.target.closest('#pasteRun'); if (!run) return
  const text = $('#pasteText').value
  renderPaste('', true)
  try {
    const r = await fetch('/api/try', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }) }).then((x) => x.json())
    if (r.budget) tryBudget = r.budget
    if (r.error) { renderPaste(r.error); $('#pasteText').value = text; return }
    snap = r; derive(); paint()
    state.doc = 0; state.revealed = 3   // 1·2 는 해당 없음 — 추출부터 편다
    show()
  } catch {
    renderPaste('서버에 연결하지 못했습니다.'); $('#pasteText').value = text
  }
})

$('#docList').addEventListener('click', (e) => {
  const more = e.target.closest('[data-more]')
  if (more) {
    const body = $(`[data-body="${more.dataset.more}"]`)
    const open = body.hidden
    body.hidden = !open
    more.setAttribute('aria-expanded', String(open))
    more.textContent = open ? '본문 접기' : '본문 펼치기'
    return
  }
  const b = e.target.closest('.docrow'); if (!b) return
  state.doc = Number(b.dataset.i); state.revealed = 1; show()
})
$('#steps').addEventListener('click', (e) => {
  if (e.target.closest('[data-start]')) {
    state.doc = Number(e.target.closest('[data-start]').dataset.start); state.revealed = 1; return show()
  }
  if (e.target.closest('[data-next]')) {
    state.revealed = Math.min(6, state.revealed + 1); show()
    return requestAnimationFrame(() => $('#steps').lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }
  if (e.target.closest('[data-restart]')) { state.doc = null; state.revealed = 0; return show() }
})

/**
 * 직접 해보는 자리 — 인용을 고치면 게이트 판정이 그 자리에서 바뀐다.
 * 🔑 여기서 도는 `checkClaim` 은 **서버가 쓰는 그 파일**이다(`src/gate.js` 를 빌드 때 복사).
 *    화면용으로 따로 흉내 낸 것이면 「진짜 그렇게 판정하는가」를 증명하지 못한다.
 *    모델도 서버도 부르지 않는다 — 브라우저에서 문자열 대조만 한다.
 */
function playground(d, c) {
  if (!c) return ''
  return `<div class="playpen" data-doc="${esc(d.docId)}">
    <div class="ph"><b>직접 해보기</b><span>인용을 한 글자만 고쳐 보세요. 게이트가 바로 판정합니다.</span></div>
    <label class="pl">모델이 냈다고 칠 인용</label>
    <textarea class="pq" rows="2">${esc(c.quote)}</textarea>
    <label class="pl">그 인용에서 읽었다고 칠 값</label>
    <input class="pv" value="${esc(c.valueText ?? '')}">
    <div class="pr"></div>
  </div>`
}

function runPlayground(pen) {
  const doc = snap.docs.find((x) => x.docId === pen.dataset.doc)
  const quote = pen.querySelector('.pq').value
  const valueText = pen.querySelector('.pv').value
  const v = checkClaim({ sourceText: doc?.text ?? '', quote, valueText })
  const at = v.ok ? locateQuote(doc.text, quote) : null
  pen.querySelector('.pr').innerHTML = v.ok
    ? `<div class="pv-ok"><span class="chip ok">통과 · ${esc(v.tier)} 대조</span>
         인용을 원문에서 찾았고, 값도 그 안에 있습니다.</div>
       <div class="pre">${at ? esc(doc.text.slice(0, at[0])) + '<mark>' + esc(doc.text.slice(at[0], at[1])) + '</mark>' + esc(doc.text.slice(at[1])) : esc(doc.text)}</div>`
    : `<div class="pv-no"><span class="chip flag">폐기</span> ${esc(v.reason)}</div>`
}

$('#steps').addEventListener('input', (e) => {
  const pen = e.target.closest('.playpen'); if (pen) runPlayground(pen)
})

// ── 되돌린 업무 리스트 ───────────────────────────────────────────────────
const submitted = []
function renderOut() {
  $('#outHead').textContent = `되돌린 업무 ${submitted.length ? `${submitted.length}건` : ''}`
  $('#outList').innerHTML = submitted.length ? submitted.map((s) => `
    <div class="card card-pad" style="margin-bottom:10px">
      <b>${esc(s.title)}</b>
      <div class="muted" style="font-size:12.5px;margin-top:5px">
        ${s.taskId ? `업무 ${esc(s.taskId)} · 하위업무 ${s.subtaskIds.length}건 · ${esc(s.steps.join(' · '))}` : esc(s.error)}
      </div>
    </div>`).join('')
    : '<div class="empty">6단계에서 <b>플로우에 등록</b>을 누르면 실제 업무가 만들어지고 여기 쌓입니다.</div>'
}
$('#steps').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-plan]'); if (!b) return
  const idx = Number(b.dataset.plan)
  const p = snap.plans[idx]
  b.disabled = true; b.textContent = '등록하는 중…'
  try {
    const r = await fetch('/api/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: p }),
    }).then((x) => x.json())
    submitted.push(r.error ? { title: p.task.title, subtaskIds: [], error: r.error } : r)
    b.textContent = r.error ? '등록 실패' : '등록됨'
  } catch (err) {
    submitted.push({ title: p.task.title, subtaskIds: [],
      error: '이 배포는 읽기 전용입니다 — 쓰기는 서버가 있어야 합니다.' })
    b.textContent = '등록 불가'
  }
  renderOut(); $('#outList').scrollIntoView({ behavior: 'smooth', block: 'center' })
})

paint()
show()
renderOut()

/**
 * 라이브 감사 — 저장된 화면을 그린 다음에 시작한다.
 * 성공하면 스냅샷을 갈아 끼우고, 실패하면 저장된 것을 그대로 두고 사유를 적는다.
 */
const live = $('#liveBadge')
live.hidden = false
live.textContent = '지금 다시 감사하는 중…'

fetch('/api/audit', { method: 'POST' })
  .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
  .then(({ ok, j }) => {
    if (!ok || j.error) {
      live.className = 'livebadge warn'
      live.textContent = `저장된 결과를 보고 있습니다 — 다시 감사 실패: ${j.error ?? ''}`
      return
    }
    snap = j
    derive(); paint()
    // 이미 단계를 밟고 있으면 되돌리지 않는다. 아직 시작 전일 때만 새로 그린다.
    if (state.doc !== null) { state.doc = Math.min(state.doc, docs.length - 1) }
    show()
    live.className = 'livebadge ok'
    // 🔑 라이브는 함수 상한(60초) 때문에 **빠른 모델**로 돈다. 저장본보다 덜 뽑힐 수 있다.
    //    조용히 갈아 끼우면 화면이 이유 없이 나빠진 것처럼 보인다 — 어느 모델이 돌았고 뭐가 다른지 적는다.
    const ran = Object.keys(j.model.byModel ?? {}).join(' · ') || '?'
    const sec = (j.ms / 1000).toFixed(1)
    // 🔑 **무엇을 했는지를 먼저 말한다.** 저장본과의 차이는 이유와 붙여 뒤에 둔다 —
    //    숫자만 앞에 세우면 결함 고지처럼 읽힌다.
    // 🔑 배지는 한 줄로 잘리는 자리다. **살아 있다는 증거**만 남기고,
    //    저장본과의 차이는 그 숫자가 실제로 적히는 곳(푸터)으로 내린다.
    live.textContent = `방금 다시 감사했습니다 · ${j.claims.length}건 · ${sec}초`
    live.title = `${ran} · 호출 ${j.model.calls ?? '?'}회 · ${sec}초` +
      (j.claims.length !== demoSnap.claims.length
        ? ` — 라이브는 함수 상한(60초) 안에 들어와야 해서 빠른 모델로 돕니다. 저장본은 상위 모델로 만든 것이라 ${demoSnap.claims.length}건입니다.`
        : '')
  })
  .catch(() => {
    live.className = 'livebadge warn'
    live.textContent = '저장된 결과를 보고 있습니다 — 서버가 없습니다'
  })
