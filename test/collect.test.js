import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeText, fromHtml, plainText, collectProject } from '../src/collect.js'

test('정제는 줄 구조를 남긴다 — 개행이 사라지면 모델이 문장 경계를 잘못 본다', () => {
  const out = normalizeText('첫 줄입니다.\n- 둘째 줄\n\n\n- 셋째 줄')
  assert.equal(out, '첫 줄입니다.\n- 둘째 줄\n\n- 셋째 줄')
})

test('정제는 nbsp 를 공백으로, 제로폭을 삭제로 바꾼다', () => {
  assert.equal(normalizeText('820 ms​입니다'), '820 ms입니다')
})

test('정제는 가로 공백만 줄인다', () => {
  assert.equal(normalizeText('  값   820ms  \n   다음 줄  '), '값 820ms\n다음 줄')
})

// 🔑 실측 결함: outContent 는 블록 경계에 구분자를 안 넣는다.
// 붙은 문자열은 원문에 「실재」하므로 인용 게이트가 못 잡는다 — 읽는 쪽에서 경계를 지킨다.
test('htmlContent 는 블록 경계를 개행으로 살린다', () => {
  const html = '<h2>초대합니다!</h2><div>◾ 일시 : 목요일</div><p>장소<br>서울</p>'
  const out = normalizeText(fromHtml(html))
  assert.equal(out.includes('초대합니다!◾'), false, '두 블록이 붙으면 안 된다')
  assert.match(out, /초대합니다!\n◾ 일시 : 목요일\n장소\n서울/)
})

test('표 셀도 블록이다 — 빼면 한 행의 셀들이 붙는다', () => {
  const out = normalizeText(fromHtml('<table><tr><td>실행 시간</td><td>4분 12초</td></tr></table>'))
  assert.equal(out.includes('실행 시간4분'), false)
})

test('엔티티를 푼다', () => {
  assert.equal(fromHtml('<p>a&nbsp;b &amp; c &lt;d&gt; &#49;</p>').trim(), 'a b & c <d> 1')
})

test('본문 세 벌 중 블록 경계가 남는 순서로 고른다', () => {
  assert.equal(plainText({ htmlContent: '<p>html</p>', outContent: 'out', content: '{}' }).source, 'htmlContent')
  assert.equal(plainText({ htmlContent: '', outContent: 'out', content: '{}' }).source, 'outContent')
  const comps = JSON.stringify({ COMPS: [{ COMP_DETAIL: { CONTENTS: 'comps' } }] })
  assert.equal(plainText({ htmlContent: '', outContent: '', content: comps }).text, 'comps')
})

// ── collectProject — 네트워크 대신 가짜 클라이언트를 넣는다 ──────────────
const client = {
  listPosts: async () => [
    { postId: '1', title: '[업무] 쿼리 프로파일링', remarkCount: 2 },
    { postId: '2', title: '[수치 감사] 검색 응답시간 250ms — 근거를 못 찾음', remarkCount: 0 },
  ],
  getPost: async (id) => ({ postId: id, title: `글 ${id}`, outContent: `본문 ${id}`, registerName: '작성자' }),
  listComments: async () => [
    { commentId: 'c1', contents: '47회면 손볼 만하네요.', systemCode: '' },
    { commentId: 'c2', contents: "상태를 '대기'에서 '완료'으로 변경하였습니다.", systemCode: 'S45_TASK' },
  ],
}

test('도구가 만든 업무는 감사하지 않는다 — 자기 출력을 다시 읽으면 수치가 번식한다', async () => {
  const docs = await collectProject('p', { client })
  assert.equal(docs.some((d) => d.docId === 'post:2'), false)
})

test('시스템 댓글은 문서로 세지 않는다 — 사람이 쓴 게 아니다', async () => {
  const docs = await collectProject('p', { client })
  const comments = docs.filter((d) => d.kind === 'comment')
  assert.equal(comments.length, 1)
  assert.equal(comments[0].docId, 'comment:c1')
})

test('connectUrl 을 쓰지 않는다 — 플로우 내부 호스트가 새어 나온다', async () => {
  const leaky = { ...client, getPost: async (id) => ({
    postId: id, outContent: '본문', connectUrl: 'https://internal-private-prod-api-alb-1.ap-northeast-2.elb.amazonaws.com/l/x' }) }
  const docs = await collectProject('p', { client: leaky })
  assert.equal(docs.every((d) => !String(d.url).includes('amazonaws')), true)
})

// ── 표 — 융합은 게이트를 뚫고, 과분할은 게이트에 걸린다. 행으로 잇는다 ────────
test('표는 행 단위로 이어 붙인다 — 값 옆에 그 값이 무엇인지가 남는다', async () => {
  const { fromHtml, normalizeText } = await import('../src/collect.js')
  const html = '<h2>이번 주 숫자</h2><table><tbody>' +
    '<tr><td><strong>항목</strong></td><td><strong>값</strong></td></tr>' +
    '<tr><td>코드리뷰 평균 대기</td><td>4시간</td></tr>' +
    '<tr><td>배포</td><td>3회</td></tr></tbody></table>'
  const text = normalizeText(fromHtml(html))
  assert.match(text, /코드리뷰 평균 대기 · 4시간/)
  assert.match(text, /배포 · 3회/)
  assert.doesNotMatch(text, /4시간배포/)          // 융합되지 않는다
  assert.doesNotMatch(text, /\n4시간\n/)          // 홀로 남지도 않는다
})

test('표가 없으면 건드리지 않는다', async () => {
  const { fromHtml } = await import('../src/collect.js')
  assert.match(fromHtml('<p>p95 320ms</p><p>스테이징 기준</p>'), /p95 320ms\n스테이징 기준/)
})
