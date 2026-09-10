# 플로우 User API — 이 도구가 쓰는 범위

> 출처: https://api.flow.team/docs (2026-09-09~10 확인). 문서 SPA가 엔드포인트 스펙을 클라이언트 청크에 담고 있어
> 청크(`_app/immutable/nodes/*.js`)에서 추출해 대조했다. **★ 는 실제 호출로 확인한 것이다.**

기본 경로 `https://api.flow.team` · 인증 헤더 `x-flow-api-key`
응답은 전부 `{"response":{"success":bool,"code":int,"message":str,"data":{...}|"error":{...}}}` 로 감싸진다.

## 붙여 보고 안 것

문서만 읽어서는 안 나온다. 여기 있는 것이 이 도구의 설계를 정했다.

**실패도 HTTP 200 으로 온다.** `res.ok` 로 판정하면 조용히 통과한다. 봉투의 `success` 를 봐야 한다.

**본문이 세 벌로 온다.** `content`(COMPS JSON) · `outContent`(플레인) · `htmlContent`(URL 인코딩).
API로 만든 글은 `htmlContent` 가 빈 문자열이고, 에디터로 쓴 글은 셋 다 채워진다.

**`outContent` 는 블록 경계를 지운다.** 에디터 글 3건·블록 이음매 22곳 중 3곳이 구분자 없이 붙었다 —
`"초대합니다!◾ 일시 :"` 처럼 h2 의 끝과 다음 div 의 시작이 한 문장이 된다.
붙은 문자열은 원문에 실재하므로 인용 대조로는 못 잡는다. `htmlContent` 가 있으면 블록 종료 태그를 개행으로 바꿔 푼다.
표 셀(`</td>`)도 블록이다. 빼면 한 행의 셀들이 붙는다.

**업무 상태가 두 축이다.** 생성 body 의 `status`(`request|progress|…`)는 먹지만,
화면에 보이는 상태 컬럼은 별개다. 컬럼은 생성 후 `PATCH …/status` 에 `optionSrno` 로 바꾼다.
같은 값으로 바꾸려 하면 `VALIDATION_ERROR "동일한 업무 상태로 변경할 수 없습니다."` 가 온다 — 이 에러가 현재 값을 알려 준다.

**상태를 바꾸면 시스템 댓글이 남는다.** `"상태를 '대기'에서 '완료'으로 변경하였습니다."`
`systemCode` 가 채워져 오므로 사람 댓글과 가를 수 있다.

**`connectUrl` 이 내부 호스트로 온다.** `https://internal-private-prod-api-alb-….ap-northeast-2.elb.amazonaws.com/l/…`
공개 호스트로 바꿔 열면 오류 페이지로 튄다(302). 산출물에 쓰지 않는다.

**담당자는 지정할 수 있다.** 전역 `GET /user/search/employees` 는 이름으로 검색해도 빈 배열이 온다.
봐야 할 곳은 프로젝트 참여자 목록이다. 거기서 나온 `userId` 를 `workerId` 로 쓴다.

**`GET /user/projects` 는 `cursor` 만 받는다.** `pageSize` 를 붙이면 `VALIDATION_ERROR`.

**업무의 taskId 는 글 응답 안에 있다.** `GET /user/posts/{postId}` 의 `tasks[0].TASK_SRNO`.

## 읽기

| | 엔드포인트 | 비고 |
|---|---|---|
| ★ | `GET /user/projects` | `{hasNext,lastCursor,projects[]}` · `cursor` 만 받는다 |
| ★ | `GET /user/posts/projects/{projectId}` | `cursor,pageSize(1~100),postId,templateTypes` |
| ★ | `GET /user/posts/{postId}` | 본문 3종 · `tasks[]` · `remarks` · `attachments` |
| ★ | `GET /user/comments/{postId}` | `cursor,size(1~100),replyYn` · `systemCode` 로 시스템 댓글이 갈린다 |
| ★ | `GET /user/projects/{projectId}/participants` | `[{inttId,userId,name}]` — **담당자 지정에 쓸 id 가 여기 있다** |
| ★ | `GET /user/projects/{projectId}/columns/status` | 상태 컬럼 옵션(`optionSrno`) |
| ★ | `GET /user/employees/me` | 내 계정 정보 |
| | `GET /user/posts/projects/{projectId}/tasks/filter` | 업무 조회 |
| | `GET /user/projects/{projectId}/task-columns` | 업무 컬럼(커스텀 필드) |
| | `GET /user/search/posts` · `/search/projects` · `/search/events` · `/search/employees` | 검색 |
| | `GET /user/wiki/*` · `/user/calendars/*` · `/user/alarms` · `/user/drive/*` | 위키 · 캘린더 · 알림 · 드라이브 |

`templateType` — `1` 일반 글 · `2` 할 일 · `4` 업무 · `91` 공지 · `92`/`93` 업무·일정 템플릿.

## 쓰기

| | 엔드포인트 | Body |
|---|---|---|
| ★ | `POST /user/projects` | `title`(필수) · `description,defaultTab,postPermission,commentPermission` |
| ★ | `POST /user/posts/projects/{projectId}` | `title,contents`(필수) |
| ★ | `POST /user/posts/projects/{projectId}/tasks` | `title,contents,status`(필수) · `priority,startDate,endDate,workers[{workerId}]` |
| ★ | `POST /user/posts/projects/{projectId}/tasks/{taskId}/subtasks` | `title,contents` |
| ★ | `POST /user/comments/{postId}` | `contents`(필수) |
| ★ | `PATCH …/tasks/{taskId}/status` | `status` **또는** `optionSrno` — 둘 중 하나만 |
| ★ | `PATCH …/tasks/{taskId}/worker` | `workers[{workerId}]` |
| | `PATCH …/tasks/{taskId}/priority` · `/start-date` · `/end-date` | 개별 변경 |
| | `POST /user/posts/projects/{projectId}/schedules` · `/todos` | 일정 · 할 일 |

- `status`: `request | progress | feedback | complete | hold`
- `priority`: `low | normal | high | urgent`
- 날짜: `YYYYMMDD` (일정은 `YYYYMMDDHHmmss`)
- **User API는 `registerId`/`userId` 를 받지 않는다.** 서버가 API Key 의 사용자로 귀속시킨다. (v1 API는 `registerId` 필수 — 스펙이 다르다)

## 삭제가 없다

프로젝트·글·댓글·업무 어느 것도 API 로 지울 수 없다. 웹에서 지워야 한다.
그래서 이 도구는 미리보기가 기본값이고, 쓰기는 사람이 누를 때만 일어난다.

## MCP 를 안 쓴 이유

플로우는 `https://flow.team/ai/mcp` 로 MCP 서버를 제공한다(OAuth). 이 도구는 REST API 를 골랐다.

이유는 취향이 아니라 이 도구가 하는 일의 모양이다.
MCP 는 **모델이 도구를 고르게 하는** 규약이다. 그런데 여기서 모델에게 맡긴 자리는 지표명을 붙이고 같은 지표끼리 묶는 것뿐이고,
무엇을 읽을지·무엇을 대조할지·무엇을 쓸지는 전부 코드가 정한다.
읽기 엔드포인트를 화이트리스트로 고정하고 쓰기 전에 인용을 다시 대조하는 구조에서, 도구 선택권을 모델에 넘길 자리가 없다.

그리고 응답을 바이트로 봐야 했다. `outContent` 가 블록 경계를 지우는 것도, `connectUrl` 이 내부 호스트인 것도
원시 응답을 열어 봐서 알았다. 그 층을 추상화로 덮었으면 못 봤을 것들이다.
MCP 가 나쁘다는 뜻이 아니라, **경계를 어디에 두느냐가 달랐다.**
