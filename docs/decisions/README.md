# 결정 기록

무엇을 정했는지보다 **무엇을 버렸고 왜 버렸는지**를 남긴다.
수치와 사례는 전부 이 저장소에서 실제로 난 것이고, 근거는 [`docs/measurement.md`](../measurement.md) ·
[`docs/measurement-flow.md`](../measurement-flow.md) 에 있다.

| # | 결정 | 갈린 자리 |
|---|---|---|
| [0001](0001-screen-keeps-two-axes.md) | 화면에는 목적을 두 줄만 | 설명을 다 걷어낸 화면 vs 화면만 본 사람에게 목적이 0줄 |
| [0002](0002-live-badge-stays.md) | 라이브 배지는 남기고 차이는 푸터로 | 배지를 뺄까 vs 살아 있다는 유일한 증거 |
| [0003](0003-no-staged-failures.md) | 폐기 사례를 심지 않는다 | 연출한 실패 vs 실측 기록 |
| [0004](0004-context-sameness-goes-to-the-model.md) | 조건 동일성은 모델이, 갈림은 코드가 | 문자열 유사도 vs 모델 판단 |
| [0005](0005-do-not-widen-to-document-consistency.md) | 문서 정합성으로 안 넓힌다 | 확장 vs 마지막 한 걸음이 코드로 떨어지는가 |
| [0006](0006-do-not-delete-what-the-model-split.md) | 갈렸다고 지우지 않는다 | 오탐 줄이기 vs 미탐 늘리지 않기 |
| [0007](0007-fix-the-spec-not-the-roll.md) | 실행을 고르지 않고 명세를 고친다 | 체리피킹 vs 비어 있던 명세 |
| [0008](0008-tables-become-rows.md) | 표는 행으로 잇는다 | 셀 융합(게이트 뚫림) vs 과분할(게이트 걸림) |
| [0009](0009-no-fallback-snapshot.md) | 폴백 스냅샷은 기준본이 아니다 | 지금 있는 것 vs 한도 복구 후 |
| [0010](0010-locate-not-length.md) | 인용은 길이가 아니라 자리로 잰다 | 문맥 길이(대리 지표) vs 등장 횟수 |
| [0011](0011-same-number-is-an-assumption.md) | 「같은 숫자면 같은 측정」도 모델이 정한다 | 값으로 면제 vs 조건 묶음으로 면제 |
| [0012](0012-polling-not-webhooks.md) | 자동 실행은 폴링이다 | 웹훅(방향이 반대) vs 지문 비교 폴링 |
| [0013](0013-no-byo-api-key.md) | 남의 API 키를 받지 않는다 | 호스팅 폼 vs 붙여넣기·로컬 CLI |
