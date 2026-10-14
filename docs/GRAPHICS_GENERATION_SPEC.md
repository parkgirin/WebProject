# Pose Mesh Editor 그래픽 생성 규칙

## 1. 개념

캐릭터 그래픽은 관절 원과 관절 사이의 면으로 구성한다.

각 관절은 중심을 통과하는 **여러 축선**을 가질 수 있다. 각 축선은 독립된 각도와 고유 ID를 가지며, 원과 축선이 만나는 두 점 중 필요한 점을 연결점으로 사용한다. 면의 꼭짓점은 `관절 ID + 축선 ID + 방향`을 명시적으로 참조한다.

이 구조를 사용하는 이유는 한 관절에서 만나는 면마다 서로 다른 기울기를 허용하기 위해서다. 예를 들어 어깨에서 상체 면은 `torso` 축을, 위팔 면은 `upper-arm` 축을 사용하므로 두 면의 경계를 독립적으로 회전할 수 있다.

현재 인체 리그의 편집·검증 정책은 **관절당 최대 2개 축선**이다. 그러나 데이터는 고정된 `axis1`, `axis2` 필드가 아닌 배열로 저장한다. 이후 동물, 기계, 소품 등 일반 리그로 범위를 넓힐 때 `maxAxesPerJoint` 정책값만 높이고 축선을 추가할 수 있어야 한다.

## 2. 관절과 축선 데이터

```ts
type AxisPointSide = -1 | 1;

interface JointAxis {
  id: string;
  angle: number;
  pointSides: AxisPointSide[];
}

interface Joint {
  id: string;
  x: number;
  y: number;
  radius: number;
  bodyRadius?: number; // 임시 미리보기 전용, 이후 ArtShape로 이전
  axes: JointAxis[];
  renderOrder: number;
  guideVisible: boolean;
  bodyVisible: boolean;
}

interface RigLimits {
  maxAxesPerJoint: number;
}

const DEFAULT_RIG_LIMITS = {
  maxAxesPerJoint: 2,
};
```

필드의 의미:

- `x`, `y`: 관절 원의 중심점
- `radius`: 관절 원의 반지름
- `bodyRadius`: 도형 추가 기능 전까지 사용하는 임시 미리보기 출력 반지름이다. 최종 구조에서는 관절 속성이 아니라 관절에 바인딩된 `ArtShape`의 크기와 바인딩 영향값으로 이전한다.
- `axes`: 관절 중심을 지나는 축선 배열
- `JointAxis.id`: 같은 관절 안에서 축선을 식별하는 안정적인 ID
- `JointAxis.angle`: 해당 축선만의 회전각(degree)
- `JointAxis.pointSides`: 면 생성에 사용할 축 끝점. `1`, `-1`을 각각 최대 한 번 가진다.
- `renderOrder`: 관절을 그리는 앞뒤 순서. 값이 작을수록 먼저 그린다.

축선 개수 제한은 스키마가 아니라 검증 정책이다. 현재 기본값은 2지만, 저장 형식과 면 참조 형식을 바꾸지 않고 더 큰 값으로 확장할 수 있다.

화면 좌표는 저장하지 않는다. 관절 위치·반지름 또는 개별 축선 각도가 바뀌면 렌더링할 때 다시 계산한다.

### 축선과 끝점의 개수

- 관절당 축선: 현재 `0~2개`; 이후 정책값으로 확장 가능
- 축선당 끝점: `0~2개`
- 끝점 0개: 가이드 또는 예약 축선
- 끝점 1개: 한쪽 연결만 사용하는 끝 관절이나 특수 파츠
- 끝점 2개: 면의 폭을 만드는 일반 축선

## 3. 축 끝점 계산

축선마다 자신의 각도를 라디안으로 변환한다.

```ts
function getAxisPoint(joint: Joint, axis: JointAxis, side: -1 | 1) {
  const radians = (axis.angle * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);

  return {
    x: joint.x + dx * joint.radius * side,
    y: joint.y + dy * joint.radius * side,
  };
}
```

```text
P(axis, +) = Center + Direction(axis.angle) × radius
P(axis, -) = Center - Direction(axis.angle) × radius
```

모든 축선은 같은 관절 중심과 반지름을 공유하지만 각도는 공유하지 않는다. 따라서 한 축선을 회전해도 같은 관절의 다른 축선과 그 축선을 사용하는 면에는 영향이 없다.

## 4. 면 데이터와 축선 선택

면은 좌표 대신 각 꼭짓점이 사용할 관절, 축선, 방향을 저장한다.

```ts
interface JointPointRef {
  jointId: string;
  axisId: string;
  side: -1 | 1;
}

interface Face {
  id: string;
  vertices: JointPointRef[];
  color?: string;
  orderOffset: number;
}

interface Rig {
  defaultColor: string;
  joints: Joint[];
  faces: Face[];
}
```

`vertices` 순서가 면의 위상이다. 렌더링 중 가까운 점을 찾거나 점 순서를 자동으로 바꾸지 않는다.

예를 들어 어깨와 팔꿈치의 `upper-arm` 축선으로 위팔 면을 만든다.

```ts
const upperArm: Face = {
  id: "right-upper-arm",
  vertices: [
    { jointId: "right-shoulder", axisId: "upper-arm", side: 1 },
    { jointId: "right-elbow", axisId: "upper-arm", side: 1 },
    { jointId: "right-elbow", axisId: "upper-arm", side: -1 },
    { jointId: "right-shoulder", axisId: "upper-arm", side: -1 },
  ],
  orderOffset: 0,
};
```

모든 면과 출력용 관절 원은 `Rig.defaultColor`를 사용한다. 특정 면의 `color`가 정의된 경우에만 그 면이 기본색을 덮어쓴다.

같은 어깨에서 상체 면은 별도 축선을 참조할 수 있다.

```ts
const torsoVertex: JointPointRef = {
  jointId: "right-shoulder",
  axisId: "torso",
  side: -1,
};
```

이제 `right-shoulder.axes`의 `upper-arm.angle`과 `torso.angle`을 각각 바꾸면 위팔과 상체 면이 서로 다른 기울기를 가진다. 여러 면이 의도적으로 같은 기울기를 공유해야 할 때만 같은 `axisId`를 참조한다.

### 확정된 인체 연결 위상

상체는 가슴 중심 관절을 기준 꼭짓점으로 사용하지 않고 `어깨 띠`와 `몸통`의 두 4점 면으로 나눈다. 두 면은 좌우 어깨의 아래쪽 점을 공유한다.

```text
어깨 띠:
왼쪽 어깨 torso축 위쪽
→ 오른쪽 어깨 torso축 위쪽
→ 오른쪽 어깨 torso축 아래쪽
→ 왼쪽 어깨 torso축 아래쪽

몸통:
왼쪽 어깨 torso축 아래쪽
→ 오른쪽 어깨 torso축 아래쪽
→ 허리 upper-torso축 오른쪽
→ 허리 upper-torso축 왼쪽
```

화면의 Y축이 아래로 증가할 때 어깨의 `torso` 축을 `angle: -90`으로 두면 `side: 1`이 위쪽, `side: -1`이 아래쪽 점이 된다. 어깨 관절 원을 출력하지 않아도 면 자체가 어깨 두께와 겨드랑이 경계를 유지한다.

어깨 띠와 몸통을 하나의 6점 면으로 합치지 않는다. 각 면을 고정된 두 삼각형으로 나눌 수 있어 큰 관절 회전과 향후 UV 텍스처 변형을 예측하기 쉽기 때문이다. 두 면의 공통 경계는 같은 `(jointId, axisId, side)` 참조를 사용해야 한다.

골반은 하나의 6점 면으로 만들지 않는다. 중앙 사각형과 좌우 삼각형으로 나눠 회전 핸들의 가상 피벗을 중앙 면 내부에 안정적으로 배치하고, 이후 삼각형 기반 텍스처 변형에도 그대로 사용할 수 있게 한다.

```text
중앙 사각형:
허리 pelvis축 왼쪽
→ 허리 pelvis축 오른쪽
→ 오른쪽 고관절 pelvis축 안쪽
→ 왼쪽 고관절 pelvis축 안쪽

왼쪽 삼각형:
허리 pelvis축 왼쪽
→ 왼쪽 고관절 pelvis축 안쪽
→ 왼쪽 고관절 pelvis축 바깥쪽

오른쪽 삼각형:
허리 pelvis축 오른쪽
→ 오른쪽 고관절 pelvis축 바깥쪽
→ 오른쪽 고관절 pelvis축 안쪽
```

고관절의 `pelvis` 축이 수평일 때 왼쪽 고관절은 `-1`이 바깥쪽, `1`이 안쪽이고 오른쪽 고관절은 반대다. 두 안쪽 점이 겹치면 중앙 사각형이 퇴화하므로 기본 고관절 중심 간격은 지름보다 크게 둔다. 세 면은 허리–고관절 경계를 공유하며 동일한 골반 피벗 회전을 적용한다.

관절별 축선 역할은 다음과 같다.

| 관절 | 축선 1 | 축선 2 |
|---|---|---|
| 어깨 | `torso` | `upper-arm` |
| 허리 | `upper-torso` | `pelvis` |
| 고관절 | `pelvis` | `upper-leg` |
| 팔꿈치 | `upper-arm` | `lower-arm` |
| 무릎 | `upper-leg` | `lower-leg` |
| 손목 | `lower-arm` | 추후 손 파츠용 축 |
| 발목 | `lower-leg` | 추후 발 파츠용 축 |

손목과 발목은 화면에서 생략된 경우에도 리그 관절과 축선을 유지한다. `bodyVisible`이 `true`이면 관절부 아트를 표시해 연결 끝을 덮고, `false`이면 연결 면의 끝을 그대로 노출한다.

목은 `head` 관절과 가슴 중심 관절에 각각 수평 `neck` 축을 두고 네 끝점을 잇는 4점 면으로 정의한다. 별도 `neck` 관절을 만들지 않는다. `head.radius`는 목 연결 폭과 편집 가이드에 사용한다. 현재 `head.bodyRadius`로 그리는 큰 머리 원은 관절 바인딩 `ArtShape`의 미리보기다. 이후에는 머리 도형이 `head` 관절의 이동·회전과 선택적인 변형 영향을 받아 따라가며, 목 면보다 높은 아트 레이어에서 연결부를 덮는다.

## 5. 회전 편집 규칙

- 관절 전체에 단일 `rotation`을 두지 않는다.
- 선택 상태는 최소한 `jointId`와 `axisId`를 포함한다.
- 회전 핸들은 선택된 축선의 `angle`만 변경한다.
- 관절 중심 이동과 반지름 변경은 그 관절의 모든 축선 및 연결 면에 영향을 준다.
- 축선을 삭제하거나 ID를 바꾸기 전에 이를 참조하는 면이 있는지 검사한다.

필요하면 향후 관절 전체를 한 번에 회전하는 편집 명령을 추가할 수 있다. 이 경우에도 저장 모델의 단일 회전값을 복구하지 않고, 명령이 모든 `axes[].angle`에 같은 변화량을 적용하도록 한다.

## 6. 렌더링 순서

먼저 `LayerGroup.order`로 그룹 전체의 앞뒤를 정한다. 기본 팔다리는 좌우를 별도 그룹으로 두어 서로 겹칠 때 경계와 앞뒤를 독립적으로 표현한다. 그룹 안에서 관절은 `renderOrder`를 직접 가지며, 면의 기본 순서는 참조하는 고유 관절들의 `renderOrder` 평균에 `orderOffset`을 더해 계산한다.

```ts
faceOrder =
  average(uniqueReferencedJoints.map((joint) => joint.renderOrder))
  + face.orderOffset;
```

동일한 순서에서는 다음 순서를 사용한다.

1. 면
2. 출력용 관절 원
3. 편집 가이드와 선택 핸들

최종 정렬 키는 `(계산된 순서, 요소 종류 우선순위, id)`로 고정한다.

## 7. 전체 그래픽 생성 과정

### 1단계 — 데이터 검증

- 관절 ID와 면 ID가 중복되지 않는지 확인한다.
- 반지름이 0보다 큰지 확인한다.
- `axes.length`가 현재 `maxAxesPerJoint` 이하인지 확인한다.
- 한 관절 안에서 축선 ID가 중복되지 않는지 확인한다.
- 각 축선의 `pointSides`에 `1`, `-1` 이외 값이나 중복이 없는지 확인한다.
- 면의 모든 `jointId`가 실제 관절을 참조하는지 확인한다.
- 면의 모든 `axisId`가 해당 관절의 실제 축선을 참조하는지 확인한다.
- 면의 `side`가 해당 축선에서 활성화되어 있는지 확인한다.

### 2단계 — 축선별 파생 좌표 계산

각 관절의 모든 축선을 순회하며 활성화된 끝점의 월드 좌표를 계산한다.

```text
Joint
  → axes[]
    → 각 axis.angle을 방향 벡터로 변환
    → Center ± Direction × radius
```

### 3단계 — 면 꼭짓점 계산

각 면의 `vertices`를 순서대로 순회해 `(jointId, axisId, side)`에 해당하는 좌표로 치환한다.

### 4단계 — 통합 렌더 목록 생성

면 순서를 계산하고 면과 출력용 관절 원을 하나의 목록으로 합친 뒤 정렬한다. 편집 가이드와 핸들은 별도의 최상위 편집 레이어에 둔다.

### 5단계 — 가이드 렌더링

`guideVisible`인 관절에는 다음을 표시한다.

- 관절 원의 윤곽과 중심점
- 모든 축선과 활성화된 끝점
- 축선을 구분하는 색상 또는 라벨
- 선택된 축선의 회전 핸들
- 필요 시 관절 ID, 축선 ID, `renderOrder`

### 6단계 — 변경 시 재계산

관절 중심, 반지름, 축선 배열, 개별 축선 각도, 렌더 순서 또는 면 참조가 바뀌면 관련 파생 좌표와 렌더 목록을 다시 계산한다. 면 좌표는 별도 상태로 저장하지 않는다.

## 8. 상태 변경에 따른 영향

| 변경 데이터 | 다시 계산되는 항목 |
|---|---|
| 중심점 `x`, `y` | 해당 관절의 모든 축 끝점, 연결 면, 원, 가이드 |
| `radius` | 해당 관절의 모든 축 끝점, 연결 면, 원, 가이드 |
| 특정 `axis.angle` | 그 축선, 그 축선의 끝점, 그 축선을 참조하는 면, 핸들 |
| `axes` 또는 `pointSides` | 사용 가능한 면 꼭짓점, 참조 무결성, 연결 면 |
| `renderOrder` | 관절 순서, 연결된 모든 면의 순서 |
| 면의 `vertices` | 해당 면의 모양과 참조 무결성 |
| 면의 `orderOffset` | 해당 면의 렌더링 순서 |

## 9. 권장 SVG 그룹 구조

```html
<svg>
  <g data-layer="grid"></g>
  <g data-layer="body"></g>
  <g data-layer="editor-guides"></g>
</svg>
```

`body` 안에는 `LayerGroup.order` 순서의 렌더 그룹을 만들고, 각 그룹 안에서 면과 출력용 관절 원을 통합 순서로 그린다. 윤곽 표시가 켜지면 각 면의 꼭짓점 쌍을 독립 선분으로 그린다. `관절 끝선 숨김`이 켜진 경우 두 꼭짓점의 `jointId`가 같은 선분만 생략하고, 서로 다른 관절을 잇는 길이 방향 선분은 유지한다. 출력용 관절 원은 다른 출력 관절이나 면의 채움과 겹치는 윤곽 구간을 마스크하고 노출된 바깥 호만 그린다. 그룹 전체를 하나의 실루엣으로 합치지 않으므로 다른 그룹이 겹치는 경계와 앞쪽 도형의 외곽을 바로 확인할 수 있다. 이후 관절별 앞뒤 관계가 도입되면 13장의 규칙에 따라 렌더 조각 또는 로컬 합성 그룹으로 확장한다. `editor-guides`는 모든 축선을 보여 주되 선택 축선이 명확히 구분되어야 한다.

## 10. 유지해야 할 불변 조건

1. 모든 축선은 관절 중심을 지난다.
2. 모든 축 끝점은 관절 원주 위에 있다.
3. 현재 기본 정책에서는 관절당 축선이 최대 2개다.
4. 축선 개수 제한을 늘려도 데이터 스키마와 면 참조 방식은 바뀌지 않는다.
5. 같은 관절의 축선은 서로 독립된 각도를 가진다.
6. 면 꼭짓점은 사용할 축선 ID를 명시하며, 순서는 데이터 정의를 유지한다.
7. 면 좌표는 관절과 축선 데이터에서 파생하며 별도로 저장하지 않는다.
8. 편집 가이드는 본체 렌더 순서와 무관하게 항상 최상위에 표시한다.

## 11. 리그와 아트 데이터 분리

현재 `Rig.defaultColor`는 전체 기본색이고, 선택적인 `Face.color`는 개별 면의 덮어쓰기 색상이다. 기본 리그는 모든 `Face.color`를 비워 하나의 색으로 시작한다. 관절 위치, 축선, 면 위상과 같은 리그 구조에 최종 그림·외부 파일 경로를 섞지 않는다.

향후 `Face`는 `materialId`를 통해 별도 재질을 참조하고, 재질은 다시 `assetId`로 가져온 이미지 또는 생성 이미지를 참조한다.

```ts
interface Material {
  id: string;
  type: "solid" | "texture";
  color?: string;
  assetId?: string;
}

interface TextureAsset {
  id: string;
  source: "imported" | "generated";
  fileName: string;
}
```

파일 시스템 경로나 일회성 Object URL을 `Face`에 직접 저장하지 않는다. 실제 저장 형식과 가져오기 방식은 아트 계층에서 관리한다.

초기 SVG의 `pattern`/`clipPath`는 텍스처 배치 시험에는 사용할 수 있지만, 관절 변형에 맞춰 그림이 자연스럽게 휘지는 않는다. 최종 아트 렌더링은 면마다 고정된 삼각형 분할과 UV 좌표를 정의하고 Canvas 또는 WebGL에서 삼각형별로 텍스처를 변형한다.

관절의 `bodyVisible`은 관절부 아트 표시 여부만 결정한다. 관절부의 실제 색상과 텍스처는 `Joint`의 구조 필드가 아니라 별도 아트 데이터에서 결정한다.

## 12. 구현 단위

- `types.ts`: `JointAxis`, `JointPointRef`, 다중 축 기반 `Joint`/`Face`, `RigLimits`
- `geometry.ts`: 축선별 끝점과 면 꼭짓점 계산
- `rig-state.ts`: 최대 축선 수와 참조 무결성 검증, 축선별 변경 알림
- `render-order.ts`: 면 순서 계산과 통합 렌더 목록 정렬
- `default-rig.ts`: 관절별 최대 2개 축선과 면 참조 데이터
- `svg-editor.ts`: 모든 축선 가이드와 선택 축선 핸들 렌더링
- `pointer-input.ts`: 관절 중심 이동과 선택 축선 회전
- 이후 아트 모듈: `Material`, `TextureAsset`, 삼각형/UV 데이터와 외부 이미지 가져오기

## 13. 기본 구현 이후 확장 설계

아래 항목은 현재 기본 리그와 편집 기능이 안정화된 뒤 진행한다. 현재 `Joint`, `Face` 구조를 즉시 변경하는 확정 사양이 아니라, 저장 형식의 버전을 올릴 때 적용할 확장 방향이다.

### 13.1 관절 기준 면의 앞뒤 관계

하나의 전역 `renderOrder`만으로는 팔이 몸통 앞에 있으면서 특정 관절에서는 다른 면 뒤로 들어가는 관계를 충분히 표현하기 어렵다. 이후에는 **관절과 면의 관계마다** 관절보다 앞인지 뒤인지를 기록한다.

```ts
type JointFaceSide = -1 | 1;

interface JointFaceDepth {
  jointId: string;
  faceId: string;
  side: JointFaceSide; // -1: 관절 뒤, +1: 관절 앞
  order: number;       // 같은 side 안에서의 보조 순서
}
```

- `side`는 부호이지 고유 순번이 아니다. 같은 관절에서 두 개 이상의 면이 모두 `+1` 또는 모두 `-1`일 수 있다.
- 같은 부호에 속한 면은 `order`, 기존 면 순서, 마지막으로 `faceId`를 사용해 결정적으로 정렬한다.
- 관계가 없는 면은 기존 전역 레이어 규칙을 따른다.
- 한 면이 여러 관절을 참조하므로 `(jointId, faceId)` 쌍마다 서로 다른 값을 가질 수 있다.
- 같은 면이 한 관절에서는 앞이고 다른 관절에서는 뒤인 경우, SVG의 단일 다각형 하나만으로는 두 깊이를 동시에 표현할 수 없다. 초기 구현에서는 이런 충돌을 금지하거나 대표 관절의 관계를 사용한다. 일반 구현에서는 면을 삼각형 또는 렌더 조각으로 나누어 관절별 합성 그룹에 배치한다.
- 참조하지 않는 관절에 깊이 관계를 만들지 못하게 하고, 삭제된 면과 관절을 가리키는 관계를 검증 단계에서 거부한다.

### 13.2 관절 계층과 로컬·월드 변환

현재 관절 좌표와 축 각도는 월드 공간 값이다. 이후에는 부모 관절을 지정하고 로컬 값을 저장하며, 월드 값은 계층을 따라 계산한다.

```ts
interface HierarchicalJoint {
  id: string;
  parentJointId?: string;
  localX: number;
  localY: number;
  localRotation: number;
  axes: JointAxis[]; // axis.angle도 관절 로컬 각도로 해석
}
```

```text
jointWorldMatrix = parentWorldMatrix × jointLocalMatrix
worldPoint = jointWorldMatrix × localPoint
```

- 어깨를 이동하거나 회전하면 팔꿈치와 손목의 월드 위치·방향이 함께 변한다.
- 팔꿈치의 로컬 회전은 어깨 변환이 적용된 뒤 추가되고 손목으로 전달된다.
- 편집 화면에서 관절을 월드 좌표로 드래그할 때는 부모 월드 행렬의 역행렬로 변환해 `localX`, `localY`에 저장한다.
- 루트 관절은 부모가 없으며 로컬 값과 월드 값이 같다.
- 부모 참조는 순환할 수 없다. 로드 시 존재하지 않는 부모, 자기 참조, 순환 계층을 검사한다.
- 월드 행렬은 파생값이므로 저장하지 않는다. 한 관절이 바뀌면 그 관절과 모든 하위 관절의 월드 행렬, 축 끝점, 연결 면을 다시 계산한다.
- 기존 월드 좌표 기반 포즈를 읽을 수 있도록 스키마 버전과 마이그레이션을 함께 둔다.

권장 인체 계층은 몸통 루트를 기준으로 어깨 → 팔꿈치 → 손목, 고관절 → 무릎 → 발목의 가지를 만든다. 머리와 목, 좌우 사지는 서로 다른 가지로 유지한다.

### 13.3 추가 다각형 도형과 부착 대상

얼굴 윤곽, 머리카락, 옷, 장식처럼 리그의 연결 면이 아닌 자유 다각형을 별도 아트 도형으로 추가한다. 리그 위상인 `Face`와 장식·외형인 `ArtShape`를 구분한다.

```ts
interface ArtShape {
  id: string;
  vertices: ArtShapeVertex[];
  materialId?: string;
  layer: number;
  translationInfluence: number; // 0..1
  rotationInfluence: number;    // 0..1
  deformationInfluence: number; // 0..1
}

interface ArtShapeVertex {
  x: number;
  y: number;
  bindings: ShapeBinding[];
}

type ShapeBinding =
  | { target: "joint"; jointId: string; weight: number }
  | { target: "face"; faceId: string; triangleId: string; weight: number };
```

- 각 도형은 하나 이상의 관절 또는 면에 영향을 받을 수 있다.
- `translationInfluence`는 부모 이동을 따라가는 정도, `rotationInfluence`는 부모 회전을 따라가는 정도, `deformationInfluence`는 여러 대상 사이에서 휘는 정도를 조절한다.
- 일반적으로 이동은 `1`을 기본으로 해 도형이 캐릭터에서 떨어지지 않게 하고, 얼굴 윤곽처럼 형태 보존이 중요한 도형은 회전·변형 영향만 낮춘다.
- 관절 바인딩은 관절의 월드 행렬을 사용한다.
- 면 바인딩은 면 전체를 하나의 회전값으로 간주하지 않는다. 면을 고정된 삼각형으로 분할하고, 정점의 삼각형 내부 위치를 barycentric 좌표로 저장해 면 변형을 따라가게 한다.
- 한 정점의 `bindings[].weight` 합은 정규화 후 `1`이 되어야 한다. 대상이 삭제됐거나 가중치가 유효하지 않으면 저장과 렌더 전에 오류로 처리한다.
- 도형 전체의 영향값으로 빠르게 조절하되, 얼굴·옷의 세밀한 변형이 필요해지면 정점별 영향값으로 확장한다.

예시:

- 현재 큰 머리 원의 이전 형태: `head` 관절 이동 `1`, 회전 `1`, 변형 `0`인 원형 `ArtShape`
- 얼굴 윤곽: 머리 관절 이동 `1`, 회전 `0.6~1`, 변형 `0~0.3`
- 몸통에 붙은 단단한 장식: 몸통 관절 이동·회전 `1`, 변형 `0`
- 상체를 가로지르는 옷: 어깨와 몸통 면에 여러 가중치를 주고 변형 `0.7~1`

### 13.4 렌더링과 저장 시 주의점

- 계산 순서는 `로컬 관절값 → 월드 행렬 → 축 끝점/리그 면 → 면 삼각형 → ArtShape 정점 → 깊이 정렬`로 고정한다.
- 면 앞뒤 관계, 관절 계층, 도형 바인딩은 포즈 값과 구분해 리그/아트 구조 데이터로 저장한다.
- PNG와 SVG 저장 모두 최종 변형 좌표와 깊이 순서를 사용해야 한다.
- SVG 출력은 가중치나 계층 정보를 실행 코드로 넣지 않고 계산이 끝난 `polygon`/`path` 좌표로 평탄화한다.
- 편집 중에는 원본 로컬 좌표와 바인딩을 유지하므로 저장한 프로젝트를 다시 열어 계속 수정할 수 있어야 한다.
- 다각형 자기 교차, 뒤집힌 삼각형, 깊이 관계 충돌을 시각적으로 표시하는 진단 모드를 둔다.
