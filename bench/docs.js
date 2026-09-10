import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * 벤치 입력. 두 종류다.
 *
 * SYNTHETIC — 내가 심었으므로 정답을 안다. 유리한 setup 이다.
 * EXTERNAL  — 내가 안 심은 실제 문서. 합성에서만 되는지 여기서 갈린다.
 *
 * 🔑 합성 문서에는 **노이즈 수치**를 섞었다 — 버전·포트·PR 번호·인원.
 *    드리프트와 무관한 숫자다. 정규식 오탐이 여기서 드러난다.
 */

export const SYNTHETIC = [
  {
    docId: 'post:1', kind: 'post', postId: '1', author: '팀장',
    title: '[킥오프] 검색 응답 개선',
    text: [
      '이번 스프린트 목표를 공유합니다. 참여 인원은 3명입니다.',
      '- 검색 API p95 응답시간이 현재 820ms입니다.',
      '- 목표는 300ms입니다.',
      '- 배포 목표일은 9월 20일입니다.',
      '- 대상 브랜치는 release/2.4.0 입니다.',
    ].join('\n'),
  },
  {
    docId: 'post:2', kind: 'post', postId: '2', author: '개발자A',
    title: '[주간] 1주차 — 쿼리 프로파일링',
    text: [
      '느린 구간을 뜯어봤습니다. 로컬은 8080 포트로 띄웠습니다.',
      '- 목록 조회에서 N+1이 납니다. 요청당 쿼리가 47회 나갑니다.',
      '- p95 820ms. 스테이징 · 동시 10 · 캐시 미적용 기준입니다.',
    ].join('\n'),
  },
  {
    docId: 'comment:2-1', kind: 'comment', postId: '2', author: '팀장',
    title: '[주간] 1주차 — 쿼리 프로파일링 — 댓글',
    text: '47회면 손볼 만하네요. 진행 부탁드립니다.',
  },
  {
    docId: 'post:3', kind: 'post', postId: '3', author: '개발자A',
    title: '인덱스 추가 + N+1 제거',
    text: [
      '조인으로 묶고 인덱스를 붙였습니다. PR #412 입니다.',
      '- 요청당 쿼리 47회에서 3회로 줄었습니다.',
      '- p95 320ms. 스테이징 · 동시 10 · 캐시 미적용 기준입니다.',
    ].join('\n'),
  },
  {
    docId: 'comment:3-1', kind: 'comment', postId: '3', author: '개발자A',
    title: '인덱스 추가 + N+1 제거 — 댓글',
    text: '재측정했더니 p95 280ms 나왔습니다. 캐시 워밍 후 3회 평균입니다.',
  },
  {
    docId: 'comment:3-2', kind: 'comment', postId: '3', author: '개발자A',
    title: '인덱스 추가 + N+1 제거 — 댓글',
    text: '수치 갱신은 이 댓글에만 남깁니다. 본문은 그대로 두겠습니다.',
  },
  {
    docId: 'post:4', kind: 'post', postId: '4', author: '팀장',
    title: '[주간] 3주차 — 중간 점검',
    text: [
      '진행 상황 공유합니다.',
      '- 응답 속도가 2배 이상 빨라졌습니다.',
      '- 테스트는 42개 추가했습니다.',
      '- 배포는 9월 13일로 당깁니다.',
    ].join('\n'),
  },
  {
    docId: 'post:5', kind: 'post', postId: '5', author: '기획',
    title: '[초안] 고객 공지 문구',
    text: [
      '공지에 나갈 문구 초안입니다. 검토 부탁드립니다.',
      '- 검색 응답 250ms로 개선',
      '- 테스트 커버리지 99%',
      '- 릴리스 예정일 9월 20일',
    ].join('\n'),
  },
  {
    docId: 'comment:5-1', kind: 'comment', postId: '5', author: '개발자A',
    title: '[초안] 고객 공지 문구 — 댓글',
    text: '250ms는 어디서 나온 숫자인가요? 처음 봅니다.',
  },
  {
    docId: 'post:6', kind: 'post', postId: '6', author: 'QA',
    title: '[QA] 회귀 테스트 결과',
    text: [
      '개편 범위 회귀를 돌렸습니다. 실행 시간은 4분 12초입니다.',
      '- 테스트 1,284 케이스 전부 통과',
      '- 스테이트먼트 커버리지 96.4%',
      '- 3주차 공유의 「42개」는 케이스 수가 아니라 파일 수입니다.',
    ].join('\n'),
  },
  {
    docId: 'comment:6-1', kind: 'comment', postId: '6', author: '팀장',
    title: '[QA] 회귀 테스트 결과 — 댓글',
    text: '그럼 회의록의 「1,200여 개」는 케이스 기준이 맞습니다.',
  },
  {
    docId: 'post:7', kind: 'post', postId: '7', author: '팀장',
    title: '[회의록] 릴리스 판정',
    text: [
      '릴리스 여부를 논의했습니다. 참석 5명.',
      '- 테스트 1,200여 개 통과 확인',
      '- p95 320ms로 목표 300ms에는 못 미칩니다.',
      '- 릴리스는 9월 13일로 확정합니다.',
    ].join('\n'),
  },
]

export const EXTERNAL = [
  {
    docId: 'external:yaw-agents-readme', kind: 'post', postId: 'ext1', author: '(본인, 2026-07 이전)',
    title: 'YourAiWorkforce agents/README.md — 기대 효과',
    text: readFileSync(resolve(here, 'external-doc.txt'), 'utf8'),
  },
]
