import { requireEnv, redact } from './env.js'

const BASE = process.env.FLOW_API_BASE ?? 'https://api.flow.team'

/**
 * 호출 흔적. 화면 1(수집)이 「진짜 API 를 불렀다」를 보여주는 근거다.
 * 🔑 헤더는 안 남긴다 — 거기에 키가 있다. 남기는 건 경로·상태·건수뿐이다.
 */
export const trace = []

async function call(method, path, { query, body } = {}) {
  const url = new URL(BASE + path)
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  const startedAt = Date.now()
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-flow-api-key': requireEnv('FLOW_API_KEY'),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch {
    throw new Error(`flow ${method} ${path} — JSON 아님 (HTTP ${res.status}): ${redact(text).slice(0, 300)}`)
  }

  const r = parsed.response ?? parsed
  trace.push({
    method, path, query: query ?? {}, http: res.status,
    success: Boolean(r?.success), code: r?.code ?? null,
    ms: Date.now() - startedAt,
    dataKeys: r?.data && typeof r.data === 'object' ? Object.keys(r.data) : [],
  })
  // 성공/실패를 HTTP 상태가 아니라 응답 봉투로 판정한다 — 플로우는 실패도 200으로 줄 수 있다.
  if (!r?.success) {
    const e = r?.error ?? {}
    throw new Error(`flow ${method} ${path} — ${e.code ?? r?.code ?? 'ERROR'}: ${redact(e.message ?? r?.message ?? text)}`)
  }
  return r.data
}

/** cursor/hasNext 페이징을 한 군데로 모은다. 호출부는 전체 목록만 본다. */
async function paged(path, { query = {}, key, cursorParam = 'cursor', sizeParam = 'pageSize', size = 100, max = 1000 }) {
  const out = []
  let cursor = 0
  for (let i = 0; i < 50; i++) {
    const page = { ...query, [cursorParam]: cursor }
    if (sizeParam) page[sizeParam] = size
    const data = await call('GET', path, { query: page })
    const items = data?.[key] ?? []
    out.push(...items)
    if (!data?.hasNext || out.length >= max || items.length === 0) break
    const next = Number(data.lastCursor)
    if (!Number.isFinite(next) || next < 0 || next === cursor) break
    cursor = next
  }
  return out
}

export const flow = {
  // /user/projects 는 cursor 만 받는다 — pageSize 를 붙이면 VALIDATION_ERROR 다 (2026-09-09 실측)
  listProjects: () => paged('/user/projects', { key: 'projects', sizeParam: null }),
  listPosts: (projectId) => paged(`/user/posts/projects/${projectId}`, { key: 'posts' }),
  getPost: (postId) => call('GET', `/user/posts/${postId}`),
  listComments: (postId) =>
    paged(`/user/comments/${postId}`, { key: 'comments', query: { replyYn: 'Y' }, sizeParam: 'size' }),
  // 참여자 목록 — 담당자 지정에 쓸 userId 가 여기 있다.
  // ⚠️ 처음엔 전역 `GET /user/search/employees` 만 써 보고 「담당자 지정은 API 로 못 한다」고 적었다.
  //    빈 배열이 온 건 맞는 관측이었지만 결론이 틀렸다 — 봐야 할 곳은 프로젝트 참여자였다. (2026-09-09 정정)
  listParticipants: (projectId) => call('GET', `/user/projects/${projectId}/participants`),
  statusColumns: (projectId) => call('GET', `/user/projects/${projectId}/columns/status`),

  createProject: (body) => call('POST', '/user/projects', { body }),
  createPost: (projectId, body) => call('POST', `/user/posts/projects/${projectId}`, { body }),
  createTask: (projectId, body) => call('POST', `/user/posts/projects/${projectId}/tasks`, { body }),
  createComment: (postId, contents) => call('POST', `/user/comments/${postId}`, { body: { contents } }),
  createSubtask: (projectId, taskId, body) =>
    call('POST', `/user/posts/projects/${projectId}/tasks/${taskId}/subtasks`, { body }),
  updateTaskStatus: (projectId, taskId, status) =>
    call('PATCH', `/user/posts/projects/${projectId}/tasks/${taskId}/status`, { body: { status } }),
  updateTaskWorker: (projectId, taskId, body) =>
    call('PATCH', `/user/posts/projects/${projectId}/tasks/${taskId}/worker`, { body }),
  updateTaskPriority: (projectId, taskId, priority) =>
    call('PATCH', `/user/posts/projects/${projectId}/tasks/${taskId}/priority`, { body: { priority } }),
  updateTaskEndDate: (projectId, taskId, endDate) =>
    call('PATCH', `/user/posts/projects/${projectId}/tasks/${taskId}/end-date`, { body: { endDate } }),
}
