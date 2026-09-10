/**
 * 합성 12문서에 **실제 flow 에디터 산출물에서 관측된 노이즈**를 덧입힌 판.
 *
 * 노이즈 목록은 지어낸 게 아니다. `[플로우] 시작가이드` 방(에디터로 쓰인 글 4건)의
 * 원시 응답을 재서 나온 것이다 (2026-09-09):
 *   - ` `(nbsp) 글당 1~9개 · 이모지 글당 3~4개 · htmlContent 650~6,953자
 *   - COMPS 가 TEXT 단일이 아니다 (TEXT/LINK, TEXT/IMAGE)
 * 여기에 붙임머리로 흔한 것 셋을 더 넣었다 — 제로폭(붙여넣기 자국) · 해시태그 · 멘션.
 *
 * 🔑 **수치 문자열은 한 글자도 건드리지 않는다.** 820ms · 47회 · 1,284 · 96.4% 그대로다.
 *    바뀌는 건 그 주변뿐이다. 그래야 「노이즈 때문에 깨졌다」를 분리해 말할 수 있다.
 */
import { SYNTHETIC } from './docs.js'

const NBSP = ' '
const ZWSP = '​'

/** 문서별 덧입힘. 값은 그대로 두고 주변만 흔든다. */
const DECOR = {
  'post:1': (t) => `@팀장${NBSP}공유드립니다 📌\n` + t.replace(/입니다\./g, `입니다.${ZWSP}`).replace(/- /g, '• ') + '\n\n#킥오프 #검색개선',
  'post:2': (t) => t.replace(/ /g, (m, i) => (i % 7 === 0 ? NBSP : m)) + `\n\n🔍${NBSP}프로파일링 로그는 첨부 참고`,
  'comment:2-1': (t) => `👍${NBSP}` + t,
  'post:3': (t) => t.replace(/- /g, '✅ ') + `\n\n관련${NBSP}링크: https://example.com/pr/412`,
  'comment:3-1': (t) => t.replace(/\. /g, `.${NBSP}`) + ' 🙏',
  'comment:3-2': (t) => `${ZWSP}` + t,
  'post:4': (t) => `📊 중간 점검\n\n` + t.replace(/- /g, NBSP + NBSP + '• '),
  'post:5': (t) => t.replace(/- /g, '– ') + '\n\n#공지초안 #검토요청 @기획',
  'comment:5-1': (t) => t.replace(/\?/, `?${NBSP}`) + ' ❓',
  // 표는 에디터에서 가장 흔한 리치 요소다. 마크다운 표로 흉내낸다.
  'post:6': (t) => t.split('\n').map((l, i) => (i === 0 ? l : `| ${l.replace(/^- /, '')} |`)).join('\n')
    + `\n\n| 항목 | 값 |\n| --- | --- |\n| 실행 시간 | 4분${NBSP}12초 |`,
  'comment:6-1': (t) => t + ` ${ZWSP}👌`,
  'post:7': (t) => `🗓️${NBSP}` + t.replace(/- /g, '‣ ').replace(/입니다\./g, `입니다.${ZWSP}`),
}

export const NOISY = SYNTHETIC.map((d) => {
  const fn = DECOR[d.docId]
  return { ...d, text: fn ? fn(d.text) : d.text, noisy: Boolean(fn) }
})

/** 어떤 노이즈가 몇 개 들어갔는지 — 재현 가능한 수치로 남긴다. */
export function noiseProfile(text) {
  return {
    nbsp: (text.match(/ /g) ?? []).length,
    zwsp: (text.match(/[​-‍﻿]/g) ?? []).length,
    emoji: (text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu) ?? []).length,
    hashtag: (text.match(/#[^\s#]+/g) ?? []).length,
    mention: (text.match(/@[^\s@]+/g) ?? []).length,
    table: (text.match(/^\|/gm) ?? []).length,
  }
}
