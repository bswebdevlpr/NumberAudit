/**
 * 화면이 쓰는 게이트가 **서버가 쓰는 그 게이트**여야 한다.
 * 브라우저는 src/ 를 못 읽으므로(배포 루트가 public/ 이다) 빌드 때 복사한다.
 * 복사본은 저장소에 넣지 않는다 — 두 벌이 되면 언젠가 갈라진다.
 */
import { mkdirSync, copyFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'public/lib')
mkdirSync(out, { recursive: true })
for (const f of ['gate.js']) copyFileSync(resolve(root, 'src', f), resolve(out, f))
console.log(`public/lib ← src/gate.js`)
