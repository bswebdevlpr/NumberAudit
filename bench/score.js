/** 값 비교용 정규화 — 쉼표·공백·단위 표기 흔들림만 흡수한다. */
export function normVal(s) {
  return String(s ?? '').toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[「」"'"']/g, '')
}

const hit = (claims, goldValue) =>
  claims.filter((c) => normVal(c.valueText).includes(normVal(goldValue)) || normVal(goldValue).includes(normVal(c.valueText)))

/** ①-a — gold 드리프트 값을 찾았나 / 노이즈를 얼마나 끌어왔나 */
export function scoreLocate(claims, gold) {
  const wanted = gold.synthetic.drifts.flatMap((d) => d.values.map((v) => ({ drift: d.id, value: v, docs: d.docs })))
  const found = wanted.filter((w) => hit(claims, w.value).some((c) => w.docs.includes(c.docId)))
  const noise = gold.synthetic.noise.filter((n) => hit(claims, n.value).length > 0)
  return {
    wanted: wanted.length, found: found.length,
    missed: wanted.filter((w) => !found.includes(w)).map((w) => `${w.drift}:${w.value}`),
    noiseTotal: gold.synthetic.noise.length, noiseCaught: noise.length,
    noiseList: noise.map((n) => `${n.value}(${n.why})`),
    total: claims.length,
  }
}

/** ②  — gold 드리프트의 값들이 같은 그룹에 들어갔나 + 그룹이 얼마나 뭉개졌나 */
export function scoreGroup(claims, groups, gold, keyOf = (g) => g.claimIds) {
  const byId = new Map(claims.map((c) => [c.claimId, c]))
  const rows = []
  for (const d of gold.synthetic.drifts) {
    const targets = d.values.map((v) => claims.filter((c) => d.docs.includes(c.docId) && normVal(c.valueText).includes(normVal(v))))
    const together = groups.some((g) => {
      const ids = new Set(keyOf(g))
      return targets.every((set) => set.some((c) => ids.has(c.claimId)))
    })
    const host = groups.find((g) => {
      const ids = new Set(keyOf(g))
      return targets.every((set) => set.some((c) => ids.has(c.claimId)))
    })
    const hostSize = host ? keyOf(host).length : null
    const extras = host ? keyOf(host).filter((id) => {
      const c = byId.get(id)
      return c && !d.values.some((v) => normVal(c.valueText).includes(normVal(v)))
    }).length : null
    // 🔑 재현율만 보면 「전부 한 그룹에 몰아넣기」가 만점을 받는다. 그건 판정을 안 한 것이다.
    //    정밀도 = 그 그룹에서 이 드리프트에 실제로 속하는 비율.
    const precision = hostSize ? (hostSize - extras) / hostSize : null
    rows.push({ id: d.id, metric: d.metric, together, hostSize, extras, precision, missing: targets.some((s) => s.length === 0) })
  }
  const hit = rows.filter((r) => r.together)
  const meanPrec = hit.length ? hit.reduce((a, r) => a + (r.precision ?? 0), 0) / hit.length : 0
  return { rows, ok: hit.length, total: rows.length, meanPrecision: meanPrec }
}
