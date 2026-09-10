import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * 로컬은 저장소 루트의 .env 를 읽고, 배포에서는 플랫폼 환경변수를 그대로 쓴다(.env 가 없으면 조용히 넘어간다).
 * 키는 이 파일 밖으로 절대 나가지 않는다 — 로그·리포트·에러 메시지 어디에도 찍지 않는다.
 */
function loadEnvFile(path) {
  let raw
  try { raw = readFileSync(path, 'utf8') } catch { return }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim()
  }
}

loadEnvFile(resolve(here, '../../.env'))
loadEnvFile(resolve(here, '../.env'))

export function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`환경변수 ${name} 가 없습니다. .env 또는 배포 환경변수를 확인해 주세요.`)
  return v
}

/** 로그·리포트에 키가 새어 나가는 것을 막는 마지막 방어선. */
export function redact(text) {
  let out = String(text)
  for (const name of ['FLOW_API_KEY', 'GEMINI_API_KEY']) {
    const v = process.env[name]
    if (v && v.length > 6) out = out.split(v).join(`<${name}:redacted>`)
  }
  return out
}
