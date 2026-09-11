import { flow } from './flow.js'
import { TOOL_TITLE_PREFIX } from './task.js'

// 표 셀(td/th)도 블록이다. 빼면 한 행의 셀들이 붙어 「실행 시간4분 12초」가 된다.
const BLOCK_END = /<(?:br|\/p|\/div|\/h[1-6]|\/li|\/ul|\/ol|\/tr|\/td|\/th|\/table|\/blockquote)[^>]*>/gi

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }

const ROW = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
const CELL = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi

/**
 * 🔑 표는 **행 단위로 다시 잇는다.** 셀을 그냥 개행으로 끊으면 값이 홀로 남는다.
 *
 * 실측(이 데모 방의 에디터 글): 표 한 개가 `outContent` 에서 `"항목값코드리뷰 평균 대기4시간배포3회"`
 * 한 덩어리로 왔다. 셀 경계가 하나도 안 남는다.
 *
 * 그렇다고 셀마다 개행을 넣으면 반대로 진다 — 값이 `"4시간"` 한 줄이 되고,
 * 모델이 낼 수 있는 인용도 `"4시간"` 뿐이라 **게이트 조건 ③(값 외 문맥 3자)에 걸려 폐기된다.**
 * 실제로 그렇게 2건을 잃었다. 융합은 게이트를 뚫고, 과분할은 게이트에 걸린다.
 *
 * 그래서 행을 한 줄로 만든다 — `코드리뷰 평균 대기 · 4시간`.
 * 값 옆에 그 값이 무엇인지가 남고, 그게 인용의 문맥이 된다.
 *
 * (`content` 의 COMPS 에는 `SHAPE: "TABLE"` 이라는 표식이 오지만 CONTENTS 는 이미 뭉개져 있다.
 *  셀 경계가 남아 있는 곳은 `htmlContent` 뿐이라 여기서 푼다.)
 */
function tablesToRows(html) {
  return html.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, (table) => {
    const rows = []
    for (const m of table.matchAll(ROW)) {
      const cells = [...m[1].matchAll(CELL)]
        .map((c) => c[1].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
      if (cells.length) rows.push(cells.join(' · '))
    }
    return rows.length ? `<p>${rows.join('</p><p>')}</p>` : ''
  })
}

/**
 * htmlContent 를 블록 경계가 살아 있는 플레인으로 푼다.
 *
 * 왜 outContent 를 그냥 안 쓰나 — outContent 는 블록 경계에 구분자를 안 넣는다.
 * 실측(`node bench/block-fusion.js 2965412`): 에디터 글 3건 · 이음매 22곳 중 **3곳(13.6%)**이
 * 구분자 없이 붙었다. `"초대합니다!◾ 일시 :"` 처럼 h2 와 다음 div 가 한 문장이 된다.
 * 붙으면 두 블록에 걸친 문자열이 「원문에 실재하는 한 문장」이 되고,
 * 인용 게이트는 실재 여부만 보므로 이걸 못 잡는다. 경계는 읽는 쪽에서 지킨다.
 */
export function fromHtml(html) {
  let s = String(html)
  try { s = decodeURIComponent(s) } catch { /* 이미 디코드됐거나 깨진 인코딩 — 원문 그대로 간다 */ }
  return tablesToRows(s)
    .replace(BLOCK_END, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, e) => ENTITIES[e] ?? _)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
}

/** 플로우 본문은 COMPS JSON · 플레인 · HTML 세 벌로 온다. 블록 경계가 남는 순서로 고른다. */
export function plainText(post) {
  const html = String(post.htmlContent ?? '')
  if (html.trim()) {
    const t = fromHtml(html)
    if (t.trim()) return { text: t, source: 'htmlContent', raw: decodeSafe(html) }
  }
  if (post.outContent && post.outContent.trim()) {
    return { text: post.outContent, source: 'outContent', raw: post.outContent }
  }
  try {
    const comps = JSON.parse(post.content ?? '{}').COMPS ?? []
    return { text: comps.map((c) => c.COMP_DETAIL?.CONTENTS ?? '').join('\n'), source: 'content(COMPS)', raw: String(post.content ?? '') }
  } catch {
    return { text: post.content ?? '', source: 'content', raw: String(post.content ?? '') }
  }
}

function decodeSafe(s) { try { return decodeURIComponent(s) } catch { return s } }

/**
 * 줄 구조를 남긴다. 공백만 줄이고 개행은 살린다.
 *
 * 처음엔 \s+ 를 통째로 공백 하나로 뭉갰다. 그러다 실제 flow 데이터에서 하나 물었다 —
 * 개행이 사라지자 앞줄의 불릿 `- ` 가 뒷문장 옆에 붙었고, 모델이 그걸 끌어다
 * `"- 요청당 쿼리가 47회 나갑니다."` 라는 **원문에 없는 인용**을 만들었다.
 * 수치(47회)는 맞았는데 인용이 지어낸 것이라 게이트가 버렸다 (`bench/out/flow-noisy.json`).
 *
 * 게이트는 대조 전에 공백을 전부 지우므로 개행을 남겨도 게이트 판정은 안 바뀐다.
 * 잃을 게 없고 모델에게 줄 단서는 는다.
 */
export function normalizeText(s) {
  return String(s ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}


/**
 * 프로젝트 하나를 문서 집합으로 만든다.
 * 글 본문과 댓글을 각각 독립 문서로 다룬다 — 수치는 본문보다 댓글에서 더 자주 갱신되고,
 * 그 갱신이 본문에 반영되지 않는 것이 이 감사가 잡으려는 바로 그 상황이다.
 */
/**
 * 🔴 `connectUrl` 을 쓰지 않는다.
 * 응답에 오는 값이 `https://internal-private-prod-api-alb-….ap-northeast-2.elb.amazonaws.com/l/…` —
 * 플로우 **내부 로드밸런서 호스트**다. 공개 호스트로 바꿔 열어 보면 오류 페이지로 튄다(302).
 * 산출물에 남기면 남의 내부 인프라를 노출하는 셈이고, 링크는 어차피 안 열린다. (2026-09-09 실측)
 */
const projectUrl = (projectId) => `https://flow.team/main.act?projectId=${projectId}`

export async function collectProject(projectId, { client = flow } = {}) {
  const list = await client.listPosts(projectId)
  const docs = []

  for (const item of list) {
    // 도구가 만든 업무는 감사하지 않는다. 자기 출력을 다시 읽으면 같은 수치가 무한히 번식한다.
    if (String(item.title ?? '').startsWith(TOOL_TITLE_PREFIX)) continue
    const post = await client.getPost(item.postId)
    const plain = plainText(post)
    docs.push({
      docId: `post:${item.postId}`,
      kind: 'post',
      postId: item.postId,
      title: post.title ?? item.title ?? '',
      author: post.registerName ?? item.registerName ?? '',
      writtenAt: post.registeredDateTime ?? item.registeredDateTime ?? '',
      url: projectUrl(projectId),
      // 정제 before/after. 플로우는 본문을 **세 벌**로 준다 — 어느 벌을 왜 골랐는지가 이 단계의 내용이다.
      source: plain.source,
      raw: {
        content: String(post.content ?? '').slice(0, 3000),
        outContent: String(post.outContent ?? '').slice(0, 3000),
        htmlContent: decodeSafe(String(post.htmlContent ?? '')).slice(0, 3000),
      },
      text: normalizeText(plain.text),
    })

    if (Number(item.remarkCount ?? 0) > 0) {
      for (const c of await client.listComments(item.postId)) {
        for (const node of [c, ...(c.replies ?? [])]) {
          // 🔑 시스템 댓글을 문서로 세지 않는다.
          // 업무 상태를 바꾸면 플로우가 "상태를 '대기'에서 '완료'으로 변경하였습니다." 를 댓글로 남긴다.
          // 사람이 쓴 게 아니므로 수치 감사 대상이 아니다. `systemCode` 가 비어 있으면 사람 것이다. (2026-09-09 실측)
          if (String(node.systemCode ?? '').trim()) continue
          const body = normalizeText(node.contents)
          if (!body) continue
          docs.push({
            docId: `comment:${node.commentId}`,
            kind: 'comment',
            postId: item.postId,
            title: `${post.title ?? ''} — 댓글`,
            author: node.registerName ?? '',
            writtenAt: node.registeredDateTime ?? '',
            url: projectUrl(projectId),
            source: 'comment.contents',
            raw: { content: String(node.contents ?? '').slice(0, 3000), outContent: '', htmlContent: '' },
            text: body,
          })
        }
      }
    }
  }

  return docs.filter((d) => d.text.length > 0)
}
