/**
 * 로컬 개발 서버. **배포와 같은 핸들러를 부른다** —
 * 로컬에서만 도는 별도 경로를 두면 배포에서 처음 터진다.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import audit from '../api/audit.js'
import submit from '../api/submit.js'
import tryIt from '../api/try.js'

const root = fileURLToPath(new URL('../public/', import.meta.url))
const port = Number(process.env.PORT ?? 4321)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' }
const ROUTES = { '/api/audit': audit, '/api/submit': submit, '/api/try': tryIt }

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')

  const fn = ROUTES[path]
  if (fn) {
    try { await fn(req, res) } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: String(e.message ?? e) }))
    }
    return
  }

  const file = join(root, path === '/' ? 'index.html' : path)
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('404')
  }
}).listen(port, () => console.log(`http://localhost:${port}`))
