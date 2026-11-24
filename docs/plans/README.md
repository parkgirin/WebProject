# 계획 문서 안내

현재 실행 순서와 완료도는 [현재 작업 진행 순서와 완료도](CURRENT_WORK_PLAN.md)를 기준으로 한다. 다른 계획 문서는 기능별 상세 설계와 검증 조건을 보관하며, 오래된 날짜나 작업 순서가 현재 기준을 대신하지 않는다.

## 현재 기준 문서

- [현재 작업 진행 순서와 완료도](CURRENT_WORK_PLAN.md): 현재 작업 단위, 완료도, 다음 순서와 보류 범위
- [프로젝트 데이터 모델 v3](../DATA_MODEL_V3.md): 리그·신체·포즈·외형·고정 출력 시점과 애니메이션 트랙 계약
- [프로젝트 인계 문서](../PROJECT_HANDOFF.md): 구현 상태와 실행·검증 정보

## 기능별 상세 계획

- [포즈 키프레임과 체형 독립 포즈](POSE_INTERPOLATION_PLAN.md)
- [자유 도형 편집](SHAPE_EDITOR_PLAN.md)
- [도형 모드 전환](SHAPE_MODE_PLAN.md)
- [일러스트 합성·반응형 검증](ILLUSTRATION_COMPOSITING_RESPONSIVE_SCHEDULE.md)
- [리소스 출력 최소 기능](RESOURCE_OUTPUT_MINIMUM_SCHEDULE.md)
- [신체 확장 의상과 렌더링 최소 일정](GARMENT_RENDERING_SCHEDULE.md)
- [렌더링 및 의상 통합 작업 일정](RENDERING_COSTUME_WORK_SCHEDULE.md)
- [다음 작업 일정 — 게임 리소스 출력과 편집 확장](NEXT_WORK_SCHEDULE.md)
- [반응형 레이아웃](responsive/RESPONSIVE_LAYOUT_PLAN.md)
- [범용 편집 기능과 장기 백로그](GENERAL_EDITOR_FEATURES.md)

## 현재 우선순위

1. 외곽선·원근·X/Y/Z 회전 출력 보정
2. 튜브 단면, 허리–골반·가슴 전이 표면과 기본 얼굴 면 검토
3. 자동 저장의 v3 이전, 다중 클립 UI와 런타임 데이터 이전
4. 관절·축·면 생성 UI와 캡슐·사각형 확장 기준
5. 고급 고정 출력 카메라

체형 독립 포즈, 합성·카메라 회전·애니메이션의 실제 PNG/SVG/ZIP 검증과 전체 v3 프로젝트 저장·재불러오기는 완료됐다. 정밀 깊이 렌더링, 카메라 애니메이션, 사용자 지정 작업공간은 현재 우선순위가 아니다.

브라우저 자동 저장은 아직 기존 `Rig` 기반 호환 형식을 사용한다. 장기 보관과 다른 브라우저로의 이동에는 v3 프로젝트 JSON을 사용한다.

