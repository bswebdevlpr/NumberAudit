# 측정 하네스

구현물(`src/`)과 섞이지 않는다. 여기 있는 것은 **어느 자리에 모델을 두고 어느 자리에 코드를 둘지 정하기 위해 쟀던 기록**이다.
근거 전문은 [`../docs/measurement.md`](../docs/measurement.md)(라운드 1~3)와 [`../docs/measurement-flow.md`](../docs/measurement-flow.md)(라운드 4)에 있다.

| | |
|---|---|
| `docs.js` | 합성 12문서. 노이즈 6건 포함 |
| `docs-noisy.js` | 같은 12문서 + 에디터 노이즈. 실제 플로우 글을 재서 만든 목록이다 |
| `docs-demo.js` | 데모 프로젝트에 심는 판. **수치 문장은 `docs.js` 와 한 글자도 다르지 않다** |
| `gold.json` · `gold-round2.json` | 정답. **코드보다 먼저 확정했다** |
| `arm-*.js` | 통제군·실험군. `arm-keyword.js` 는 과적합을 파일에 명시해 뒀다 |
| `seed-*.js` · `roundtrip.js` | 플로우에 심고 다시 읽어 원문과 대조 |
| `block-fusion.js` · `noise-stress.js` · `ladder.js` | 라운드 4 — 실데이터에서 드러난 것들 |
| `rejudge.js` · `recluster.js` · `replay-gate.js` | 저장된 결과 재판정. **모델 호출 0회** |
| `gate-rules.js` | 인용 규칙 후보를 저장된 주장에 다시 걸어 비교. **모델 호출 0회** ([0010](../docs/decisions/0010-locate-not-length.md)) |
| `out/*.json` | 원시 결과 |

## `external-doc.txt` 는 내 옛 문서다

라운드 1~2에서 **외부 문서**로 쓴 원문이다. 내 사이드 프로젝트 문서의 「기대 효과」 절을 그대로 떠 왔다.
`85% 절감` · `정확도 95% 이상` 같은 수치가 **근거 없이** 적혀 있다. 내가 그렇게 썼다.

이 파일을 남기는 이유는 두 가지다. 하나는 라운드 1~2 결과를 재현하려면 원문이 있어야 한다는 것이고,
다른 하나는 이 도구가 잡으려는 것이 바로 그런 문장이라는 것이다.
`condition` 한 필드로 셌을 때 절감률 주장은 **7/7 충족**으로 집계됐다. `scope`/`method` 로 쪼개니 **1/7** 이었다.
조건이 채워졌다고 근거가 생긴 게 아니다.

내용을 고치지 않았다. 고치면 그때 쟀던 것을 다시 못 잰다.
