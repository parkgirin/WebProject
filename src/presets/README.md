# Presets

이 폴더는 편집기에서 바로 적용하는 프리셋 정의와 적용 규칙을 관리한다.

- `avatar-presets.ts`: 기본 7종 체형 데이터와 적용
- `body-presets.ts`: 사용자가 추가한 체형 프리셋 생성·검증·적용
- `pose-presets.ts`: 체형 기본 포즈 초기화, 기본 포즈 기반 팔 내림·팔다리 벌림과 사용자 포즈 프리셋 생성·검증·적용

JSON 파일 형식과 브라우저 자동 저장은 `src/storage`에서 관리한다.

공유 프리셋 JSON은 `data/body` 또는 `data/pose`에 추가한다. `preset-catalog.ts`가 파일을 자동 검색하므로 별도 import 등록은 필요하지 않다.
