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
- `viewYRotation`, 원근 여부와 강도는 `OutputView`로 이동한다.
- `worldRotation`은 `WorldTransformState`로 이동하며 애니메이션 키에서는 별도 월드 회전 트랙이 된다.
- 기존 키프레임별 색상·레이어·도형 변화는 `appearanceTrack`으로 분리해 프로젝트 왕복 시 보존한다.

## 점진적 이전

`createProjectDocument()`는 현재 런타임 `Rig`를 v3 문서로 분리한다. `materializeProjectRig()`는 편집기 전체가 새 구조를 직접 사용하기 전까지 v3 문서를 기존 런타임 형태로 되돌리는 호환 어댑터다.

편집기의 저장/불러오기 창에서 v3 프로젝트 JSON을 내보내고 복원할 수 있다. 프로젝트 파일은 현재 모델과 애니메이션을 함께 보존하며, 기존 v2 부분 프리셋과 브라우저 자동 저장은 호환 경로로 유지한다.

## 확인된 호환 어댑터 제한

- 현재 편집기 런타임과 v2 포즈 프리셋은 여전히 관절의 부모 상대 `x/y/z` 좌표와 회전을 함께 저장한다.
- 한 체형에서 관절 Z 회전만 변경해 저장한 포즈를 다른 체형에 적용해도, 저장 좌표가 대상 체형의 `baseOffset`을 덮어써 신체 길이 또는 관절 위치가 변형될 수 있다.
- 따라서 v3 문서의 `offsetRotation`, `lengthScale`, `orientation` 분리는 정의·프로젝트 왕복에는 반영됐지만, 모든 프리셋 적용과 편집 런타임이 이를 직접 사용하는 단계는 아직 완료되지 않았다.
- 다음 작업에서는 회전 전용 포즈가 대상 체형의 `restOffset`과 길이를 유지하도록 포즈 적용기를 v3 파라미터 기준으로 전환하고, 성인체와 아동체 사이의 양방향 적용 회귀 테스트를 추가한다.
