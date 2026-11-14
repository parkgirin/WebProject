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
- [반응형 레이아웃](responsive/RESPONSIVE_LAYOUT_PLAN.md)
- [범용 편집 기능과 장기 백로그](GENERAL_EDITOR_FEATURES.md)

## 현재 우선순위

1. 다른 체형에 포즈를 적용할 때 발생하는 관절 변형 수정
2. 합성·카메라 회전·애니메이션의 실제 PNG/SVG/ZIP 렌더링 검증
3. PNG 스프라이트 시트와 프레임 메타데이터
4. 의상용 튜브 셸과 그룹 병합 SVG
5. 자동 저장의 v3 이전, 다중 클립 UI와 런타임 데이터 이전

프로젝트 v3 파일 저장·복원, 기본 반응형 레이아웃, 자유 도형과 합성 계층은 구현됐다. 정밀 깊이 렌더링, 카메라 애니메이션, 사용자 지정 작업공간은 현재 우선순위가 아니다.

브라우저 자동 저장은 아직 기존 `Rig` 기반 호환 형식을 사용한다. 장기 보관과 다른 브라우저로의 이동에는 v3 프로젝트 JSON을 사용한다.

