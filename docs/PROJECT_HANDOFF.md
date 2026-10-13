# Pose Mesh Editor — 기획 및 작업 인계서

## 1. 프로젝트 목적

그림을 직접 그리는 부담을 줄이기 위해, **원형 관절과 연결 면으로 2D 캐릭터를 만들고 포즈를 편집하는 웹 도구**를 만든다.

최종적으로는 2D 기반이지만 관절 위치·크기·회전·앞뒤 레이어를 조절해 3D처럼 보이는 자세를 만들 수 있어야 한다. 스토리용 캐릭터를 대상으로 하며, 복잡한 실시간 물리나 3D 모델링은 범위 밖이다.

## 2. 확정된 시각·리그 규칙

- 캐릭터 비율의 기본은 **5등신 남성체**다.
- 캐릭터는 정면과 좌·우 3/4 방향을 주로 사용한다. 완전 측면은 우선순위가 낮다.
- 관절은 원으로 표현한다. 각 원은 `위치`, `반지름`, `회전값`을 가진다.
- 팔다리와 몸통은 관절 원의 **원주 위 고정 포트(port)**를 이어 생성한 면(face)이다.
- 포트는 관절 로컬 좌표계에서 각도로 고정된다. 관절이 회전하면 포트도 원주를 따라 함께 회전한다.
- 포즈에서는 관절의 중심 위치와 회전을 바꾸고, 연결 면은 포트의 최신 월드 좌표로 다시 계산한다.
- 한 면의 꼭짓점 순서는 고정한다. 관절 중심 간의 교차점을 매 프레임 새로 찾지 않는다.
- 사지 면은 보통 4개 포트로 만든 사다리꼴이다.
  - 예: `어깨 바깥 → 팔꿈치 바깥 → 팔꿈치 안쪽 → 어깨 안쪽`
- 몸통·골반처럼 여러 관절이 만나는 부분은 별도 다각형 면 또는 안정적인 삼각형 묶음으로 정의한다.
  - 상체: 좌·우 어깨와 가슴 중심 관절을 잇는 연결 면
  - 골반: 가슴 중심과 좌·우 골반 관절을 잇는 연결 면
  - 양쪽 골반 관절 사이도 별도 면으로 채워 다리 사이가 비지 않게 한다.
- 관절 원은 편집 화면에서는 보이지만, 실제 캐릭터 출력에서는 숨길 수 있다.
- 손·발은 끝 관절에 붙는 선택 파츠다. 끝 관절은 숨겨도 리그 계산과 팔·다리 끝 폭 결정에는 사용한다.

## 3. 구현 기술 결정

### 초기 편집기: SVG

관절 드래그, 회전 핸들, 포트, 연결 면의 선택·레이어 표현은 SVG로 구현한다.

SVG를 선택한 이유:

- 관절 원·다각형·핸들이 각각 독립된 요소라 선택과 드래그가 쉽다.
- 면의 꼭짓점과 레이어를 디버그하기 좋다.
- Canvas만으로 시작했을 때 필요한 히트 테스트와 전체 재렌더링을 피할 수 있다.

### 이후 아트 렌더러: Canvas

캐릭터 그림·질감·브러시 결과는 나중에 Canvas 레이어로 분리한다.

```text
Canvas: 실제 그림·색·질감
SVG: 관절, 포트, 연결 면 윤곽, 회전 핸들, 선택 표시
```

면 안의 그림까지 포즈에 따라 휘게 하려면, 추후 면을 삼각형으로 나누고 Canvas 또는 WebGL에서 텍스처를 매핑한다. 초기 버전에서는 단색 SVG 면만 구현한다.

## 4. 데이터 모델 초안

```ts
interface Joint {
  id: string;
  x: number;
  y: number;
  radius: number;
  rotation: number;
  guideVisible: boolean;
  bodyVisible: boolean;
}

interface Port {
  id: string;
  jointId: string;
  angle: number; // 관절 기준의 로컬 각도
}

interface Face {
  id: string;
  portIds: string[]; // 꼭짓점 순서가 곧 면의 위상
  color: string;
  zIndex: number;
}
```

포트의 화면 좌표 계산:

```text
worldPoint = jointCenter
  + rotate(port.angle + joint.rotation)
  × joint.radius
```

포즈는 리그 구조를 복제하지 않고, 관절별 `x`, `y`, `radius`, `rotation` 변경값을 저장한다. 포즈 전환 애니메이션은 이 값들을 시간에 따라 보간한다.

## 5. 첫 구현 목표 (MVP)

1. 고정 5등신 그리드가 있는 SVG 편집 화면
2. 기본 관절 10~12개 표시
3. 관절 중심 드래그
4. 선택한 관절의 반지름 조절
5. 회전 핸들로 `rotation` 변경
6. 포트 좌표 계산
7. 팔 하나를 사다리꼴 연결 면으로 자동 생성
8. 모든 변경을 즉시 SVG에 반영

이 단계에서는 포즈 저장, 실제 캐릭터 아트, Canvas 질감, GitHub Pages 배포 자동화는 구현하지 않는다.

## 6. 이후 구현 순서

1. 팔·다리 전체 연결 면 추가
2. 상체·골반 다관절 면 추가
3. `zIndex`로 앞팔/뒷팔·앞다리/뒷다리 순서 제어
4. 손·발 파츠 On/Off
5. 정면·좌 3/4·우 3/4 포즈 저장과 불러오기
6. 포즈 보간으로 숨쉬기, 고개 끄덕임, 팔 흔들기
7. Canvas 아트 레이어
8. GitHub Pages 자동 배포

## 7. 프로젝트 구조

```text
src/
  app.ts                    전체 화면과 상태 연결
  main.ts                   시작점
  styles.css                기본 스타일
  rig/
    types.ts                Joint, Port, Face, Rig 타입
    geometry.ts             포트의 월드 좌표 계산
    rig-state.ts            리그 상태 관리
    default-rig.ts          기본 인체 리그
  editor/
    svg-editor.ts           SVG 편집기 렌더링
    pointer-input.ts        드래그·회전 입력
    inspector.ts            관절 속성 패널
  render/
    canvas-renderer.ts      이후 아트 렌더러
  storage/
    pose-storage.ts         이후 포즈 저장
```

## 8. 로컬 실행과 배포

- 프로젝트 위치: `D:\web\pose-mesh-editor`
- PowerShell 실행 정책 때문에 `npm` 대신 `npm.cmd`를 사용한다.

```powershell
cd D:\web\pose-mesh-editor
npm.cmd install
npm.cmd run dev
```

개발 서버는 로컬 전용이며, 보통 `http://localhost:5173/`에서 열린다.

원격 저장소: `https://github.com/parkgirin/WebProject.git`

GitHub Pages에는 Vite의 빌드 결과물인 `dist/`를 배포한다. 공개 주소는 배포 후 일반적으로 아래 형태다.

```text
https://parkgirin.github.io/WebProject/
```

현재 `vite.config.ts`는 상대 경로 배포를 위한 `base: "./"`를 사용한다.

## 9. 라이선스

- 코드: MIT (`LICENSE`)
- 창작 에셋: 기본적으로 재사용 불가 (`LICENSE-ASSETS.md`)
- 공개 전 `LICENSE`의 저작권자 표기는 저장소 소유자 `parkgirin`으로 유지한다.

## 10. 현재 상태

- Vite + TypeScript 프로젝트 골격 생성됨
- Node.js 및 npm 설치됨
- `npm.cmd run dev`로 로컬 페이지 접속 확인됨
- CSS import 타입 오류 해결을 위해 `src/styles.d.ts` 추가됨
- GitHub 원격 저장소 병합 과정에서 `LICENSE` 충돌이 발생했고, 원격의 `parkgirin` 저작권 표기를 선택해 해결하는 절차를 안내함
- 실제 SVG 관절 편집 기능은 아직 구현 전