# 예정 작업 문서

이 폴더는 아직 완료되지 않은 작업과 장기 설계를 모은다. 현재 동작을 설명하는 사양 문서는 `docs/` 루트에 유지한다.

## 현재 진행

1. [포즈 키프레임 보간](POSE_INTERPOLATION_PLAN.md)
   - 여러 2D 포즈 키를 저장하고 타임라인에서 보간하는 기능을 다음 우선 작업으로 둔다.
   - 3D 시점 회전과 카메라 확장은 보류한다.
2. [반응형 레이아웃 전환](responsive/RESPONSIVE_LAYOUT_PLAN.md)
   - PC 레이아웃의 뷰포트 고정과 세로 스크롤 제거는 적용했다.
   - 다음 구현 범위는 작은 PC, 태블릿, 모바일 레이아웃과 속성 패널 재구성이다.

## 후속 작업 후보

- [전체 구현 계획](IMPLEMENTATION_PLAN.md): 저장, 테스트, PWA, 깊이 관계, 커스텀 도형과 유사 3D까지의 백로그와 완료 기록
- [포즈 키프레임 보간](POSE_INTERPOLATION_PLAN.md): 2D 포즈 키 저장, 타임라인과 보간 구현 계획
- [범용 편집 기능](GENERAL_EDITOR_FEATURES.md): 관절·축·면 생성과 모델 범용화 요구사항
- [파일 형식 검토](FILE_FORMAT_EXPLORATION.md): 클립보드, 압축, 전용 파일 전달 방식의 미확정 검토안

후속 작업 후보의 나열 순서는 구현 우선순위를 의미하지 않는다. 현재 우선순위는 이 문서의 `현재 진행` 절을 기준으로 한다.

## 현재 사양 문서

- [그래픽 생성 사양](../GRAPHICS_GENERATION_SPEC.md)
- [아바타 비율 프리셋](../AVATAR_PROPORTION_PRESETS.md)
- [프로젝트 인계 문서](../PROJECT_HANDOFF.md)

