/**
 * `outContent` 가 블록 경계를 지우는지 잰다.
 *
 * 에디터로 쓴 글은 htmlContent 에 <div>/<p>/<h2>/<br> 로 블록이 나뉘어 있는데,
 * 플레인 투영인 outContent 에는 그 경계에 아무 구분자도 없이 붙어 나오는 경우가 있다.
 * 붙으면 두 블록에 걸친 문자열이 「원문에 실재하는 한 문장」처럼 보인다 —
 * 인용 게이트는 실재 여부만 보므로 이걸 못 잡는다.
 *
 * 대상: 에디터로 작성된 글만. 내가 API 로 심은 글은 htmlContent 가 비어 있어 해당 없음.
 */
import { flow } from '../src/flow.js'

const BLOCK = /<\/(?:p|div|h[1-6]|li|tr|blockquote)>|<br\s*\/?>/gi

// 에디터로 쓴 글이 있는 프로젝트여야 한다 — API 로 심은 쪽은 htmlContent 가 비어 측정이 성립하지 않는다.
// 2965412 는 플로우가 만든 「시작가이드」 프로젝트고, 라운드 4 측정을 거기서 했다.
const projectId = process.argv[2] ?? process.env.FLOW_EDITOR_PROJECT_ID ?? '2965412'
const list = await flow.listPosts(projectId)
let posts = 0, seams = 0, fused = 0
const samples = []

for (const item of list) {
  const p = await flow.getPost(item.postId)
  const html = decodeURIComponent(String(p.htmlContent ?? ''))
  const out = String(p.outContent ?? '')
  if (!html || !out) continue
  posts++

  // 블록 경계마다 앞 블록의 마지막 글자를 뽑아, outContent 에서 그 뒤에 구분자가 있는지 본다.
  const chunks = html.split(BLOCK).map((s) => s.replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim()).filter(Boolean)

  for (let i = 0; i + 1 < chunks.length; i++) {
    const tail = chunks[i].slice(-6), head = chunks[i + 1].slice(0, 6)
    if (!tail || !head) continue
    seams++
    const glued = tail + head
    if (out.includes(glued)) {   // 구분자 없이 그대로 붙어 있다
      fused++
      if (samples.length < 8) samples.push({ postId: item.postId, glued })
    }
  }
}

console.log(`■ 에디터 글 ${posts}건 · 블록 이음매 ${seams}곳`)
console.log(`  구분자 없이 융합된 이음매 ${fused}곳 (${seams ? ((fused / seams) * 100).toFixed(1) : 0}%)`)
for (const s of samples) console.log(`   post:${s.postId}  …${JSON.stringify(s.glued)}…`)
