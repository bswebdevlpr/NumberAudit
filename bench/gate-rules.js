/**
 * 인용 규칙을 **저장된 주장으로 다시 걸어** 비교한다. 모델 호출 0회.
 *
 * 지금 규칙(문맥 ≥ 3자)은 묻고 싶은 것의 대리 지표다.
 * 진짜 묻고 싶은 건 「이 인용이 그 문서의 그 자리를 특정하나」고,
 * 그건 길이가 아니라 **유일성**으로 직접 셀 수 있다.
 *
 * 실행: node bench/gate-rules.js
 */
import { readFileSync } from 'node:fs'
import { tight, loose } from '../src/gate.js'

// 비교 대상은 **당시 규칙**이다. 상수를 import 하면 지금 값으로 바뀌어 비교가 무의미해진다.
const OLD_CONTEXT_MIN = 3
import { normalizeText } from '../src/collect.js'
import { SYNTHETIC } from './docs.js'

const count = (hay, needle) => { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) >= 0) { n++; i++ } return n }

/** 자리를 특정하나 — 자기 문서에 한 번만, 다른 문서엔 없음. */
function locates(docs, docId, quote) {
  const q = tight(quote)
  const own = docs.find((d) => d.docId === docId)
  if (!own || !q) return { own: 0, others: 0 }
  return { own: count(tight(own.text), q), others: docs.filter((d) => d.docId !== docId && tight(d.text).includes(q)).length }
}

const RULES = {
  '옛 규칙 · 문맥 ≥ 3자': (c, l) => tight(c.quote).length - tight(c.valueText).length >= OLD_CONTEXT_MIN,
  'A · 유일성만': (c, l) => l.own === 1 && l.others === 0,
  'B · 유일성 + 문맥 ≥ 1자': (c, l) => l.own === 1 && l.others === 0 && tight(c.quote).length - tight(c.valueText).length >= 1,
  'C · 현재 + 유일성': (c, l) => tight(c.quote).length - tight(c.valueText).length >= OLD_CONTEXT_MIN && l.own === 1 && l.others === 0,
  // 🔑 다른 문서에도 있는 인용은 **귀속을 확인 못 할 뿐** 가짜는 아니다.
  //    버리지 말고 등급으로 적는 쪽(0006 과 같은 방식)을 같이 잰다.
  'D · 자기문서 유일 + 문맥 ≥ 1자': (c, l) => l.own === 1 && tight(c.quote).length - tight(c.valueText).length >= 1,
}

function evaluate(name, docs, claims) {
  // ①②는 모든 규칙에 공통이다. ③만 갈아 끼운다.
  const base = claims.filter((c) => {
    const src = docs.find((d) => d.docId === c.docId)
    if (!src) return false
    const okQuote = tight(src.text).includes(tight(c.quote)) || loose(src.text).includes(loose(c.quote))
    return okQuote && loose(c.quote).includes(loose(c.valueText))
  })

  console.log(`\n## ${name} — 문서 ${docs.length} · ①② 통과 ${base.length} / 주장 ${claims.length}`)
  console.log('규칙'.padEnd(24), '통과', ' 폐기', ' 자기문서 모호', ' 귀속 확인불가')
  for (const [label, fn] of Object.entries(RULES)) {
    let pass = 0, vague = 0, crossOnly = 0
    for (const c of base) {
      const l = locates(docs, c.docId, c.quote)
      if (!fn(c, l)) continue
      pass++
      if (l.own !== 1) vague++
      if (l.own === 1 && l.others > 0) crossOnly++
    }
    console.log(label.padEnd(24), String(pass).padStart(4), String(base.length - pass).padStart(5), String(vague).padStart(10), String(crossOnly).padStart(12))
  }
  // 규칙 사이에서 판정이 갈리는 인용만 뽑는다
  const diffs = []
  for (const c of base) {
    const l = locates(docs, c.docId, c.quote)
    const v = Object.entries(RULES).map(([k, fn]) => [k, fn(c, l)])
    if (new Set(v.map(([, x]) => x)).size > 1) diffs.push({ c, l, v })
  }
  if (diffs.length) {
    console.log('\n  갈리는 인용:')
    for (const { c, l, v } of diffs) {
      console.log(`   ${JSON.stringify(c.quote)}  (값 ${c.valueText}${c.unit ?? ''} · 자기 ${l.own}회 · 다른 ${l.others}개)`)
      console.log(`      ${v.map(([k, x]) => `${k.split(' · ')[0]}=${x ? '통과' : '폐기'}`).join(' · ')}`)
    }
  }
}

// ── 1. 실제 flow 데이터 (현재 스냅샷) ──────────────────────────────────
const snap = JSON.parse(readFileSync(new URL('../public/snapshot.json', import.meta.url), 'utf8'))
evaluate('실제 flow 데이터', snap.docs, [...snap.claims, ...snap.rejected])

// ── 2. 합성 원문 (라운드 1·2) ──────────────────────────────────────────
const synDocs = SYNTHETIC.map((d) => ({ docId: d.docId ?? d.id, text: normalizeText(d.text ?? d.body ?? '') }))
const r1 = JSON.parse(readFileSync(new URL('./out/result.json', import.meta.url), 'utf8'))
const r2 = JSON.parse(readFileSync(new URL('./out/result-round2.json', import.meta.url), 'utf8'))
const syn = [...(r1.gemini?.claims ?? []), ...(r1.gemini?.rejected ?? []),
             ...(r2.synthetic?.claims ?? []), ...(r2.synthetic?.rejected ?? [])]
evaluate('합성 원문 (라운드 1·2)', synDocs, syn)
