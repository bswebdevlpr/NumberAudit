/**
 * 테스트 환경. **import 보다 먼저 실행돼야 한다** —
 * gemini.js 는 호출 간격을 모듈 로드 때 읽으므로, 나중에 세팅하면 3.2초씩 그냥 기다린다.
 * ESM 은 import 문 순서대로 부수효과를 실행하므로 이 파일을 맨 위에 둔다.
 */
process.env.GEMINI_API_KEY ??= 'test-key'
process.env.FLOW_API_KEY ??= 'test-key'
process.env.GEMINI_MIN_INTERVAL_MS = '0'
