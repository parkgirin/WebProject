# 프로젝트 데이터 모델 v3

이 문서는 기존 `Rig` 하나에 섞여 있던 골격, 신체, 포즈, 외형과 출력 시점을 분리하는 변환 계약을 정의한다.

## 최상위 구조

```text
ProjectDocument
├─ rig             관절 ID, 부모 관계, 축과 면의 구조
├─ body            XYZ 기준 자세, 반지름과 표면 형태
├─ pose            기준 자세 대비 회전과 3D 길이 배율
├─ appearance      색상, 레이어, 자유 도형과 합성
├─ outputView      애니메이션 전체가 공유하는 고정 출력 시점
├─ worldTransform  현재 캐릭터 전체 회전
└─ animations
   ├─ poseTrack
   ├─ appearanceTrack
   └─ worldRotationTrack
```

카메라 애니메이션과 `ViewTrack`은 만들지 않는다. `outputView`는 프로젝트 전체에서 고정되고, 애니메이션은 관절 포즈와 캐릭터 월드 회전만 기록한다.

## 변환 규칙

- `Joint.baseOffset`은 `BodyDefinition.joints[id].restOffset`의 XYZ 원본이 된다.
- 현재 부모 상대 관절 벡터는 `restOffset`에서 현재 벡터로 향하는 quaternion과 전체 XYZ 길이 배율로 변환한다.
- 관절의 자식 상속 방향은 `PoseJointDefinition.orientation`에 별도로 보존한다.
- 축 각도는 포즈에, 축 ID·정렬·길이 정의는 리그 구조에 둔다.
- 색상, 도형, 레이어와 출력 표시 여부는 외형에 둔다.
- 현재의 `viewYRotation`, 원근 여부와 강도는 `OutputView`로 이동한다. 향후 명시적인 출력 카메라로 이전할 때도 카메라는 프로젝트 전체에서 고정한다.
- `worldRotation`은 `WorldTransformState`로 이동하며 애니메이션 키에서는 별도 월드 회전 트랙이 된다.
- 기존 키프레임별 색상·레이어·도형 변화는 `appearanceTrack`으로 분리해 프로젝트 왕복 시 보존한다.

## 점진적 이전

`createProjectDocument()`는 현재 런타임 `Rig`를 v3 문서로 분리한다. `materializeProjectRig()`는 편집기 전체가 새 구조를 직접 사용하기 전까지 v3 문서를 기존 런타임 형태로 되돌리는 호환 어댑터다.

편집기의 저장/불러오기 창에서 v3 프로젝트 JSON을 내보내고 복원할 수 있다. 프로젝트 파일은 현재 모델과 애니메이션을 함께 보존하며, 기존 v2 부분 프리셋과 브라우저 자동 저장은 호환 경로로 유지한다.

## 부분 프리셋 호환

- 새 v2 부분 포즈 프리셋은 `space: "body-relative-v3"`로 저장한다. 각 관절은 `offsetRotation`, 전체 XYZ `lengthScale`, 자식 상속 `orientation`, 축 각도를 기록하며 대상 체형의 `baseOffset`에 합성한다.
- 따라서 허리–엉덩이 기본 깊이가 다른 체형에도, 저장 시점의 절대 Z가 아닌 대상 체형의 기본 Z와 포즈 변화만 적용한다.
- 편집 중 체형 전환은 최단 쿼터니언을 매번 다시 추정하지 않고, 기준 벡터에 붙은 결정적 직교 좌표계의 방향 성분과 `lengthScale`을 임시 보존한다. 기본 Z 기울기가 다른 체형을 반복 왕복해도 포즈가 누적 변형되지 않게 하는 런타임 규칙이다.
- 기존 JSON에 `space`가 없는 v2 포즈는 이전의 부모 상대 `x/y/z` 좌표 형식으로 계속 불러온다. 이 호환 경로는 예전 결과를 보존하므로 체형 간 적용 시 기본 깊이를 덮어쓸 수 있다.

## 수치 범위 정책

리그와 포즈 데이터는 편집기 슬라이더의 표시 범위를 저장 형식의 제한으로 사용하지 않는다.

- 관절 X/Y/Z는 유한값이면 허용한다. 회전·이동·거리 계산 결과를 좌표별 임의 범위로 잘라내지 않는다.
- 관절 반지름, 측면 반지름과 표면 스케일은 `0`보다 큰 유한값이면 허용하고 상한을 두지 않는다.
- 관절 거리와 포즈 거리 비율은 `0` 이상의 유한값이면 허용하고 상한을 두지 않는다.
- 회전은 상한으로 잘라내지 않고 동등한 순환 각도로 정규화한다.
- 슬라이더의 최소·최대는 빠른 조작을 위한 권장 범위다. 숫자 입력, 파일 저장과 계산 결과에는 같은 상한을 강제하지 않는다.
- 렌더링 안정성은 모델 좌표 제한이 아니라 카메라 투영과 출력 경계에서 처리한다.

## 향후 고급 출력 카메라

현재 `OutputView`의 `perspectiveEnabled`와 `projectionStrength`는 기존 2.5D 투영을 위한 호환 필드다. 후속 작업에서는 이를 실제 카메라 의미가 분명한 고정 `OutputCamera`로 이전한다.

```ts
interface OutputCamera {
  projection: "perspective" | "orthographic";
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
  verticalFov?: number;
  orthographicHeight?: number;
  near: number;
  far: number;
}
```

- 원근감은 `verticalFov`와 카메라–대상 거리로 조절한다.
- `near`와 `far`는 원근 강도가 아니라 렌더링할 가까운·먼 절단 범위다.
- 직교 카메라는 `orthographicHeight`로 출력 범위를 정한다.
- 기존 `projectionStrength` 프로젝트는 불러오기 호환 계층에서 새 카메라 값으로 변환한다.
- 카메라 애니메이션은 추가하지 않는다. 캐릭터 전체 회전은 계속 `worldRotationTrack`이 담당한다.
