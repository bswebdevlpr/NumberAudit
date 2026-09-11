import { requireEnv, redact } from './env.js'

const BASE = process.env.GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com/v1beta/models'

// 1순위가 막히면 다음으로 내려간다. 어느 모델이 답했는지는 항상 기록한다 —
// 모델이 바뀐 줄 모르고 결과를 비교하는 게 이 종류 파이프라인의 흔한 무음 실패다.
// (라운드 1에서 실제로 났다: 폴백이 도는 바람에 두 실행의 모델 구성이 달랐다)
// import 시점이 아니라 **호출 시점**에 읽는다. 배포 함수가 환경변수를 나중에 세팅해도 먹어야 한다.
const models = () => (process.env.GEMINI_MODEL ?? 'gemini-3.6-flash,gemini-3.5-flash,gemini-3.1-flash-lite')
  .split(',').map((s) => s.trim()).filter(Boolean)

// 무료 티어는 모델당 분당 20회다(실측 2026-09-09). 터뜨리고 재시도하는 것보다
// 안 터뜨리는 게 싸다 — 호출 사이에 최소 간격을 둔다.
const MIN_INTERVAL_MS = Number(process.env.GEMINI_MIN_INTERVAL_MS ?? 3200)

export const usage = { calls: 0, byModel: {}, promptTokens: 0, outputTokens: 0, retries: 0, waitedMs: 0 }

/**
 * 호출 원문. 화면 3(추출)이 [프롬프트 원문] [응답 JSON 원문] 을 그대로 펴는 근거다.
 * 프롬프트를 숨기면 「모델이 알아서 했다」밖에 안 남는다. redact 를 통과시켜 담는다.
 */
export const trace = []

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let lastCallAt = 0

async function throttle() {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) { usage.waitedMs += wait; await sleep(wait) }
  lastCallAt = Date.now()
}

/** 서버가 「몇 초 뒤에 다시」를 알려주면 그걸 쓴다. 없으면 지수 백오프. */
function retryDelayMs(parsed, attempt) {
  const info = (parsed?.error?.details ?? []).find((d) => String(d['@type'] ?? '').endsWith('RetryInfo'))
  const s = info?.retryDelay ?? (parsed?.error?.message ?? '').match(/retry in ([\d.]+)s/i)?.[1]
  const fromServer = s ? Math.ceil(parseFloat(String(s)) * 1000) + 500 : null
  return fromServer ?? Math.min(30000, 2000 * 2 ** attempt)
}

const TRANSIENT = new Set(['RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED'])

/**
 * 같은 RESOURCE_EXHAUSTED 라도 두 종류다 — 분당 한도는 기다리면 풀리고, **일일 한도는 안 풀린다.**
 * 서버는 일일 소진에도 `retryDelay: 46s` 를 준다. 그 말을 믿고 5회 재시도해서 5분을 태운 적이 있다.
 * quotaId 에 `PerDay` 가 있으면 기다리지 않고 바로 다음 모델로 내려간다. (2026-09-09 실측)
 */
function isDailyQuota(parsed) {
  const v = (parsed?.error?.details ?? [])
    .find((d) => String(d['@type'] ?? '').endsWith('QuotaFailure'))?.violations ?? []
  return v.some((x) => String(x.quotaId ?? '').includes('PerDay'))
}

async function once(model, body, { maxRetries = 5 } = {}) {
  for (let attempt = 0; ; attempt++) {
    await throttle()
    const res = await fetch(`${BASE}/${model}:generateContent?key=${requireEnv('GEMINI_API_KEY')}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const text = await res.text()

    let parsed
    try { parsed = JSON.parse(text) } catch {
      throw new Error(`gemini(${model}) — JSON 아님 (HTTP ${res.status}): ${redact(text).slice(0, 200)}`)
    }

    if (!parsed.error) return parsed

    const status = parsed.error.status ?? ''
    if (isDailyQuota(parsed)) {
      const err = new Error(`gemini(${model}) 일일 한도 소진 — 재시도해도 안 풀린다`)
      err.status = status
      process.stderr.write(`  ⛔ ${model} 일일 한도 소진 — 대기 없이 폴백\n`)
      throw err
    }
    if (TRANSIENT.has(status) && attempt < maxRetries) {
      const ms = retryDelayMs(parsed, attempt)
      usage.retries += 1; usage.waitedMs += ms
      process.stderr.write(`  ↻ ${model} ${status} — ${(ms / 1000).toFixed(1)}초 대기 (${attempt + 1}/${maxRetries})\n`)
      await sleep(ms)
      continue
    }

    const err = new Error(`gemini(${model}) ${status}: ${redact(parsed.error.message)}`)
    err.status = status
    throw err
  }
}

/**
 * Gemini 를 JSON 스키마로 묶어서 호출한다.
 * 자유 서술을 받지 않는 이유: 뒤에 붙는 인용 게이트가 필드 단위로 돌아야 하기 때문이다.
 */
export async function generateJson({ system, prompt, schema, temperature = 0, chain }) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema },
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] }

  let parsed, used, lastErr
  // 호출자가 체인을 줄 수 있다. 배포 함수마다 상한이 달라 **경로별로 모델을 달리 고를 자리**가 필요하다.
  const MODELS = chain?.length ? chain : models()
  for (const model of MODELS) {
    try { parsed = await once(model, body); used = model; break } catch (e) {
      lastErr = e
      if (!TRANSIENT.has(e.status)) throw e   // 진짜 오류는 삼키지 않는다
      process.stderr.write(`  ↓ ${model} 소진 → 다음 모델\n`)
    }
  }
  if (!parsed) throw lastErr

  usage.calls += 1
  usage.byModel[used] = (usage.byModel[used] ?? 0) + 1
  const entry = {
    model: used, system: redact(system ?? ''), prompt: redact(prompt),
    promptTokens: parsed.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: parsed.usageMetadata?.candidatesTokenCount ?? 0,
    finishReason: parsed.candidates?.[0]?.finishReason ?? null,
    response: null,
  }
  trace.push(entry)
  usage.promptTokens += parsed.usageMetadata?.promptTokenCount ?? 0
  usage.outputTokens += parsed.usageMetadata?.candidatesTokenCount ?? 0

  const cand = parsed.candidates?.[0]
  const out = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('')

  // 🔴 출력이 잘린 건 「주장이 없다」가 아니다. 조용히 넘기면 배치가 클수록 소리 없이 샌다.
  // 호출부(extract.js)가 이 코드를 보고 배치를 쪼갠다.
  if (cand?.finishReason === 'MAX_TOKENS') {
    const err = new Error(`gemini(${used}) — 출력이 상한에서 잘렸다(MAX_TOKENS). 배치를 쪼개야 한다`)
    err.code = 'MAX_TOKENS'
    throw err
  }
  // 빈 응답은 「모델이 틀렸다」가 아니라 무효다. 실패로 세면 성적이 오염된다.
  if (!out) throw new Error(`gemini(${used}) — 빈 응답(무효) finishReason=${cand?.finishReason ?? '?'}`)

  entry.response = redact(out)
  try { return JSON.parse(out) } catch {
    throw new Error(`gemini(${used}) — 스키마 위반 응답: ${redact(out).slice(0, 200)}`)
  }
}

export const modelChain = models
