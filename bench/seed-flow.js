/**
 * 합성 문서 12건을 실제 flow 프로젝트에 심는다.
 *
 * 왜 심나 — 지금까지 잰 건 전부 내가 만든 깨끗한 문자열이다.
 * 인용 게이트는 문자열 대조라서, flow 를 한 바퀴 돌고 온 텍스트가 원문과 한 글자라도
 * 달라지면 그 자리에서 깨진다. 깨지는지 아닌지는 재 봐야 안다.
 *
 * ⚠️ flow API 에는 삭제가 없다(프로젝트·글·댓글 전부). 그래서 기본값이 미리보기다.
 *    실제로 쓰려면 --write 를 붙인다.
 */
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { flow } from '../src/flow.js'
import { SYNTHETIC } from './docs.js'
import { NOISY } from './docs-noisy.js'

const here = dirname(fileURLToPath(import.meta.url))
const WRITE = process.argv.includes('--write')
// --noisy: 같은 12문서에 에디터 노이즈를 덧입힌 판을 심는다 (docs-noisy.js 참조)
const NOISY_SET = process.argv.includes('--noisy')
const SET = NOISY_SET ? NOISY : SYNTHETIC
const TITLE = process.env.DEMO_TITLE ?? (NOISY_SET
  ? '[측정] 에디터 노이즈 내성 — 인용 게이트'
  : '[데모] 검색 응답 개선 — 수치 감사 샘플')
const MAP_FILE = NOISY_SET ? 'out/seed-map-noisy.json' : 'out/seed-map.json'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const posts = SET.filter((d) => d.kind === 'post')
const comments = SET.filter((d) => d.kind === 'comment')

console.log(`■ 심을 것 — 글 ${posts.length}건 · 댓글 ${comments.length}건`)
for (const p of posts) {
  const cs = comments.filter((c) => c.postId === p.postId)
  console.log(`  ${p.docId}  ${p.title}  (${p.text.length}자, 댓글 ${cs.length})`)
}

if (!WRITE) {
  console.log('\n미리보기다. 실제로 심으려면: node bench/seed-flow.js --write')
  process.exit(0)
}

const project = await flow.createProject({
  title: TITLE,
  description: '수치 감사 파이프라인용 합성 데이터. 실제 업무 내용이 아니다.',
})
const projectId = project.projectId ?? project.id
console.log(`\n✅ 프로젝트 ${projectId} — ${TITLE}`)

const map = { at: new Date().toISOString(), projectId, title: TITLE, docs: {} }

for (const p of posts) {
  const created = await flow.createPost(projectId, { title: p.title, contents: p.text })
  const postId = String(created.postId ?? created.id)
  map.docs[p.docId] = { kind: 'post', postId, planted: p.text }
  console.log(`  글  ${p.docId} → post:${postId}`)
  await sleep(300)

  for (const c of comments.filter((x) => x.postId === p.postId)) {
    const cc = await flow.createComment(postId, c.contents ?? c.text)
    const commentId = String(cc.commentId ?? cc.id ?? '')
    map.docs[c.docId] = { kind: 'comment', postId, commentId, planted: c.text }
    console.log(`  댓글 ${c.docId} → comment:${commentId || '?'}`)
    await sleep(300)
  }
}

const out = resolve(here, MAP_FILE)
writeFileSync(out, JSON.stringify(map, null, 2))
console.log(`\n지도 저장 → ${out}`)
console.log(`.env 에 FLOW_DEMO_PROJECT_ID=${projectId} 를 적어 둔다.`)
