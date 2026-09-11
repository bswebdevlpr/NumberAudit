/**
 * 데모 프로젝트 v2 를 심는다 — 글은 글로, 업무는 업무로.
 * ⚠️ 플로우에 삭제 API 가 없다. 기본값은 미리보기고, 실제로 심으려면 --write 를 붙인다.
 */
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { flow } from '../src/flow.js'
import { DEMO } from './docs-demo.js'

const here = dirname(fileURLToPath(import.meta.url))
const WRITE = process.argv.includes('--write')
const TITLE = process.env.DEMO_TITLE ?? '[데모] 검색 응답 개선 스프린트'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log(`■ ${TITLE}`)
for (const d of DEMO) {
  const tag = d.type === 'task' ? `업무·${d.status}` : '글'
  console.log(`  [${tag}] ${d.title}  (${d.text.length}자, 댓글 ${d.comments?.length ?? 0})`)
}
if (!WRITE) { console.log('\n미리보기다. 심으려면: node bench/seed-demo.js --write'); process.exit(0) }

const project = await flow.createProject({
  title: TITLE,
  description: '수치 감사 도구 데모용 합성 데이터. 실제 업무 내용이 아니다.',
})
const projectId = String(project.projectId ?? project.id)
console.log(`\n✅ 프로젝트 ${projectId}`)

const map = { at: new Date().toISOString(), projectId, title: TITLE, docs: {} }

for (const d of DEMO) {
  const created = d.type === 'task'
    ? await flow.createTask(projectId, { title: d.title, contents: d.text, status: d.status, priority: d.priority })
    : await flow.createPost(projectId, { title: d.title, contents: d.text })
  // 업무도 글이다 — 댓글은 postId 에 붙는다. 응답 키가 갈리므로 둘 다 본다.
  const postId = String(created.postId ?? created.taskId ?? created.id ?? '')
  map.docs[d.key] = { type: d.type, status: d.status ?? null, postId, planted: d.text, title: d.title }
  console.log(`  ${d.type === 'task' ? '업무' : '글 '} ${d.key} → ${postId}  ${Object.keys(created).join(',')}`)
  await sleep(300)

  for (const c of d.comments ?? []) {
    const cc = await flow.createComment(postId, c)
    const commentId = String(cc.commentId ?? cc.id ?? '')
    map.docs[`${d.key}#c${(map.docs[d.key].comments ?? []).length}`] = null
    ;(map.docs[d.key].comments ??= []).push({ commentId, planted: c })
    console.log(`    댓글 → ${commentId || '?'}`)
    await sleep(300)
  }
}

for (const k of Object.keys(map.docs)) if (map.docs[k] === null) delete map.docs[k]
writeFileSync(resolve(here, 'out/seed-map-demo.json'), JSON.stringify(map, null, 2))
console.log(`\n지도 저장 → bench/out/seed-map-demo.json`)
console.log(`.env 의 FLOW_DEMO_PROJECT_ID 를 ${projectId} 로 바꾼다.`)
