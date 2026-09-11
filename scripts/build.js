/**
 * 화면이 쓰는 게이트가 **서버가 쓰는 그 게이트**여야 한다.
 * 브라우저는 src/ 를 못 읽으므로(배포 루트가 public/ 이다) 빌드 때 복사한다.
 * 복사본은 저장소에 넣지 않는다 — 두 벌이 되면 언젠가 갈라진다.
 */
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'public/lib')
mkdirSync(out, { recursive: true })
const FILES = ['gate.js', 'value.js']
for (const f of FILES) copyFileSync(resolve(root, 'src', f), resolve(out, f))

/**
 * 🔑 브라우저는 환경변수를 못 읽는다. 그래서 **빌드가 설정을 만들어 넣는다.**
 * 저장소 주소를 화면 코드에 박아 두면 포크한 사람의 화면이 내 저장소를 가리킨다.
 * 순서: `REPO_URL` → git 원격 → 빈 값(링크를 안 그린다).
 */
function repoUrl() {
  if (process.env.REPO_URL) return process.env.REPO_URL
  // Vercel 은 빌드 때 저장소 정보를 환경변수로 준다
  const { VERCEL_GIT_REPO_OWNER: o, VERCEL_GIT_REPO_SLUG: r, VERCEL_GIT_PROVIDER: pv } = process.env
  if (o && r) return `https://${pv === 'github' || !pv ? 'github.com' : pv}/${o}/${r}`
  try {
    const git = execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: root, encoding: 'utf8' }).trim()
    if (git) return git.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '')
  } catch { /* 원격이 없으면 링크를 안 그린다 */ }
  return ''
}

const repo = repoUrl()
writeFileSync(resolve(out, 'config.js'),
  `// 빌드가 만든 파일이다. 손으로 고치지 않는다 — scripts/build.js 를 본다.\nexport const REPO = ${JSON.stringify(repo)}\n`)
console.log(`public/lib ← ${FILES.map((f) => `src/${f}`).join(' · ')} · config.js (REPO=${repo || '(없음)'})`)
