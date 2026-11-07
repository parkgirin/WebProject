import { createDefaultRig } from "./rig/default-rig.ts";
import { getArtShapeVertexPoint } from "./rig/geometry.ts";
import {
  applyAvatarProportionPreset,
  applyTPose,
  applyUserBodyPreset,
  applyUserPosePreset,
  AVATAR_PROPORTION_PRESETS,
  BUILTIN_T_POSE_ID,
  BUILTIN_T_POSE_NAME,
  createUserBodyPreset,
  createUserPosePreset,
  DEFAULT_AVATAR_PRESET_ID,
  type UserBodyPreset,
  type UserPosePreset,
} from "./presets/index.ts";
import { FILE_BODY_PRESETS, FILE_POSE_PRESETS } from "./presets/preset-catalog.ts";
import { RigState } from "./rig/rig-state.ts";
import { renderSvgEditor } from "./editor/svg-editor.ts";
import { enablePointerInput } from "./editor/pointer-input.ts";
import { createInspector, renderInspector } from "./editor/inspector.ts";
import { createExportPreview, exportDrawingAsPng, exportDrawingAsSvg } from "./editor/export-image.ts";
import { exportPoseAnimationFrames } from "./editor/export-animation.ts";
import { applyRigPreset, createRigPreset, parseRigPreset, type PresetParts } from "./storage/rig-preset.ts";
import { createPoseAnimationFile, parsePoseAnimationFile } from "./storage/pose-animation.ts";
import { createWorkspaceCache, loadWorkspaceCache, saveWorkspaceCache } from "./storage/workspace-cache.ts";
import {
  addPoseKey,
  advancePosePlayback,
  createPoseKey,
  getPosePlaybackFrames,
  getPosePlaybackSettings,
  reorderPoseKey,
  samplePosePlayback,
  samplePoseClip,
  type PoseClip,
} from "./rig/pose-interpolation.ts";
import type { Rig } from "./rig/types.ts";
import type { EditorSelection, EditorViewState } from "./editor/types.ts";

export function createApp(container: HTMLDivElement): void {
  const restoredWorkspace = loadWorkspaceCache();
  const state = new RigState(restoredWorkspace?.rig ?? createDefaultRig());
  let selection: EditorSelection = {
    jointId: "right-elbow",
    axisId: "upper-arm",
    jointIds: ["right-elbow"],
  };
  const viewState: EditorViewState = {
    outlinesVisible: true,
    hideSameJointEdges: true,
    extendHiddenJointFaces: false,
    selectedFaceId: "torso",
    selectedShapeId: null,
    selectedShapeIds: [],
    selectedShapeVertexId: null,
    polygonDraft: [],
    lineDraft: [],
    selectedTarget: "joint",
    inspectorTab: "selection",
    preserveProportions: false,
    moveSelectedIndividually: false,
    activeTool: "select",
    paintColor: state.rig.defaultColor,
    paintPaletteId: null,
  };

  container.innerHTML = `
    <main class="app-shell">
      <header class="app-header app-surface">
        <div class="brand-block">
          <span class="eyebrow">2D RIG WORKSPACE</span>
          <h1>Pose Mesh Editor</h1>
        </div>
        <div class="header-tools">
          <div class="edit-tool-buttons" aria-label="편집 기록과 화면 배율">
            <button type="button" data-undo title="실행 취소 (Ctrl+Z)" aria-label="실행 취소">↶</button>
            <button type="button" data-redo title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행">↷</button>
            <button type="button" data-zoom-out title="축소" aria-label="축소">−</button>
            <button type="button" data-zoom-reset title="100%" aria-label="배율 초기화">100%</button>
            <button type="button" data-zoom-in title="확대" aria-label="확대">＋</button>
            <button type="button" data-fit-selection title="선택 항목 맞춤" aria-label="선택 항목 맞춤">선택 맞춤</button>
          </div>
          <div class="save-buttons">
            <button class="save-image-button is-secondary" type="button" data-open-controls>조작 안내</button>
            <button class="save-image-button is-secondary" type="button" data-open-preset>저장/불러오기</button>
            <button class="save-image-button" type="button" data-open-model-export>내보내기</button>
          </div>
        </div>
      </header>
      <section class="workspace">
        <nav class="toolbox app-surface" aria-label="편집 도구">
          <div class="toolbox-content">
            <span class="toolbox-title">TOOLS</span>
            <button type="button" class="toolbox-button is-active" data-tool-select aria-label="선택과 직접 조작" title="선택과 직접 조작">
              선택
            </button>
            <details class="toolbox-section" open>
              <summary>도형</summary>
              <button type="button" class="toolbox-button" data-tool-polygon aria-label="직선 다각형 펜툴" title="클릭으로 꼭짓점 추가 · 첫 점 또는 Enter로 닫기 · Esc 취소">다각형</button>
              <button type="button" class="toolbox-button" data-tool-circle aria-label="원 도형 추가" title="캔버스를 클릭해 원 도형 추가">원</button>
              <button type="button" class="toolbox-button" data-tool-line aria-label="두께가 있는 선분 추가" title="두 끝점을 차례로 클릭 · 축 끝점 연결 지원">선분</button>
              <button type="button" class="toolbox-button" data-tool-vertex-add aria-label="다각형 꼭짓점 추가" title="선택한 다각형의 변을 클릭해 꼭짓점 추가">점 추가</button>
              <button type="button" class="toolbox-button" data-tool-vertex-bind aria-label="꼭짓점 축 연결" title="꼭짓점을 선택한 뒤 축 끝점 클릭 · Alt+클릭은 끝점에 스냅">점 연결</button>
            </details>
            <details class="toolbox-section" open>
              <summary>색상</summary>
              <div class="toolbox-color-control">
                <button type="button" class="toolbox-button" data-tool-color aria-label="면과 관절 색칠 도구" title="색상을 선택한 뒤 면이나 관절을 클릭하여 적용">
                  색상
                </button>
                <div class="palette-grid" aria-label="작업 색상 팔레트">
                  ${state.rig.palette.map((entry) => `<button type="button" class="palette-swatch" style="--palette-color:${entry.color}" data-palette-id="${entry.id}" title="${entry.color}"><span class="sr-only">${entry.color}</span></button>`).join("")}
                </div>
                <button type="button" class="new-color-button" data-new-palette-color>새 색</button>
                <input type="color" value="${state.rig.defaultColor}" data-paint-color aria-label="선택한 팔레트 또는 새 색상" title="선택한 팔레트 또는 새 색상" />
              </div>
            </details>
            <details class="toolbox-section" open>
              <summary>보기</summary>
              <button type="button" class="toolbox-button" data-tool-zoom aria-label="확대, Shift 클릭으로 축소" title="확대 · Shift 클릭으로 축소">확대</button>
              <button type="button" class="toolbox-button" data-tool-pan aria-pressed="false" aria-label="화면 이동 모드" title="화면 이동 모드">화면</button>
              <button type="button" class="toolbox-button" data-tool-layer-order aria-pressed="false" title="좌클릭: 앞으로 · 우클릭: 뒤로 · Shift: 맨 앞/뒤">순서</button>
            </details>
          </div>
        </nav>
        <div class="editor-column">
          <div class="canvas-panel">
            <div class="canvas-toolbar">
              <div class="canvas-actions">
                <span>관절 ${state.rig.joints.filter((joint) => !joint.isVirtual).length} · 면 ${state.rig.faces.length} · 도형 <b data-shape-count>0</b></span>
                <label class="avatar-preset-control">체형
                  <select data-avatar-preset aria-label="아바타 체형 프리셋">
                    ${AVATAR_PROPORTION_PRESETS.map((preset) => `<option value="${preset.id}">${preset.name}</option>`).join("")}
                  </select>
                  <button type="button" data-apply-avatar-preset>적용</button>
                  <button type="button" data-add-avatar-preset title="현재 체형을 프리셋으로 추가">＋</button>
                  <button type="button" data-delete-avatar-preset disabled title="선택한 사용자 체형 프리셋 삭제">−</button>
                </label>
                <span class="avatar-preset-status" data-avatar-preset-status aria-live="polite"></span>
                <label class="avatar-preset-control pose-preset-control">포즈
                  <select data-pose-preset aria-label="사용자 포즈 프리셋"><option value="">프리셋 없음</option></select>
                  <button type="button" data-apply-pose-preset disabled>적용</button>
                  <button type="button" data-add-pose-preset title="현재 포즈를 프리셋으로 추가">＋</button>
                  <button type="button" data-delete-pose-preset disabled title="선택한 포즈 프리셋 삭제">−</button>
                </label>
                <span class="avatar-preset-status" data-pose-preset-status aria-live="polite"></span>
                <label class="global-rotation-control">전체 회전
                  <input type="range" min="-180" max="180" step="1" value="${toSignedAngle(state.getGlobalRotation())}" data-global-angle />
                  <span><input type="number" min="-180" max="180" step="1" value="${toSignedAngle(state.getGlobalRotation()).toFixed(0)}" data-global-angle-number aria-label="전체 회전 각도 숫자 입력" />°</span>
                </label>
                <label class="toolbar-toggle"><input type="checkbox" data-show-outlines checked />외곽선</label>
                <label class="toolbar-toggle"><input type="checkbox" data-hide-same-joint-edges checked />관절 끝선 숨김</label>
                <label class="toolbar-toggle"><input type="checkbox" data-extend-hidden-joint-faces />숨김 관절 면 연장</label>
              </div>
            </div>
            <svg class="rig-canvas" viewBox="0 0 600 780" role="img" aria-label="관절과 연결 면 편집 화면"></svg>
          </div>
          <section class="interpolation-panel" aria-label="포즈 보간 타임라인">
            <header class="interpolation-header">
              <strong>보간 타임라인</strong>
              <div class="interpolation-controls">
                <button type="button" data-toggle-pose-playback disabled>▶ 재생</button>
                <select data-pose-playback-mode aria-label="애니메이션 재생 방식">
                  <option value="ping-pong">왕복</option>
                  <option value="loop">끝→처음</option>
                </select>
                <label data-closing-frames-control hidden>연결 <input class="pose-gap-input" type="number" min="1" max="120" step="1" value="6" data-closing-frames />f</label>
                <button type="button" data-add-pose-key>키 추가</button>
                <button type="button" data-update-pose-key disabled>키 갱신</button>
                <button type="button" data-delete-pose-key disabled>삭제</button>
                <button type="button" data-save-pose-animation>저장</button>
                <button type="button" data-load-pose-animation>불러오기</button>
                <button type="button" data-open-animation-export disabled>내보내기</button>
                <input type="file" accept="application/json,.json" data-pose-animation-file hidden />
                <label>새 키 간격 <input class="pose-gap-input" type="number" min="1" max="120" step="1" value="6" data-pose-gap />f</label>
                <label>프레임 <input type="range" min="0" max="0" step="1" value="0" data-interpolation-frame disabled /></label>
                <output data-interpolation-status>첫 키프레임을 추가하세요</output>
                <button type="button" data-promote-interpolation hidden>키로 설정</button>
                <button type="button" data-exit-interpolation hidden>현재 프레임 편집</button>
              </div>
              <button type="button" class="panel-collapse-button timeline-collapse-button" data-collapse-timeline aria-expanded="true" aria-label="보간 타임라인 접기" title="보간 타임라인 접기">⌄</button>
            </header>
            <div class="interpolation-track">
              <span class="interpolation-track-label">선택된 포즈</span>
              <div class="timeline-poses" data-pose-key-list><span class="timeline-empty">키프레임 없음</span></div>
            </div>
          </section>
        </div>
        <aside class="inspector-shell">
          <button type="button" class="panel-collapse-button inspector-collapse-button" data-collapse-inspector aria-expanded="true" aria-label="속성 패널 접기" title="속성 패널 접기">›</button>
          <div data-inspector-host></div>
        </aside>
      </section>
      <dialog class="preset-dialog controls-dialog" data-controls-dialog aria-labelledby="controls-title">
        <div class="preset-dialog-header">
          <div><span class="eyebrow">CONTROLS</span><h2 id="controls-title">조작 안내</h2></div>
          <button type="button" class="preview-close-button" data-close-controls aria-label="조작 안내 닫기">×</button>
        </div>
        <div class="controls-dialog-content">
          <section><h3>선택과 관절</h3><dl>
            <dt>클릭 / 드래그</dt><dd>관절이나 면을 선택 / 관절을 이동합니다.</dd>
            <dt>Shift + 클릭</dt><dd>관절 선택을 추가하거나 해제합니다. 면을 클릭하면 면의 관절을 추가합니다.</dd>
            <dt>빈 공간 드래그</dt><dd>사각형 안의 관절을 선택합니다. Shift를 누르면 기존 선택에 추가합니다.</dd>
            <dt>Alt(Option) + 관절 드래그</dt><dd>누르고 있는 동안 부모와의 거리를 유지합니다. 선택 패널의 비율 유지 체크박스로 항상 켤 수도 있습니다.</dd>
            <dt>회전 핸들 드래그</dt><dd>선택 축 또는 여러 관절을 회전합니다. 여러 관절 회전 중 Shift는 15° 단위입니다.</dd>
            <dt>동등 관계 회전 핸들</dt><dd>중심에서 떨어진 보라색 핸들을 중심 주위로 드래그해 어깨 또는 골반을 함께 회전합니다.</dd>
            <dt>동등 관계 중심 간격</dt><dd>선택 패널에서 양쪽 관절을 중점 기준으로 대칭 이동해 어깨 또는 골반 폭을 조절합니다.</dd>
            <dt>가상 중심 오프셋</dt><dd>동등축 방향 X와 직교 방향 Y로 가상 관절을 옮깁니다. 현재 포즈는 유지되고 이후 회전 중심에 적용됩니다.</dd>
            <dt>체형 프리셋</dt><dd>캔버스 상단에서 기본 체형을 적용하거나 현재 체형을 이름 붙여 추가합니다. 사용자 체형은 현재 포즈 방향을 유지한 채 관절 크기와 간격을 적용합니다.</dd>
            <dt>포즈 프리셋</dt><dd>현재 포즈를 이름 붙여 추가하고 목록에서 다시 적용합니다. 사용자 프리셋은 브라우저 자동 저장에 포함됩니다.</dd>
          </dl></section>
          <section><h3>순서 도구</h3><dl>
            <dt>좌클릭 / 우클릭</dt><dd>면이나 관절을 한 단계 앞으로 / 뒤로 이동합니다.</dd>
            <dt>Shift + 좌클릭 / 우클릭</dt><dd>맨 앞으로 / 맨 뒤로 이동합니다.</dd>
          </dl></section>
          <section><h3>화면과 편집</h3><dl>
            <dt>휠 / 확대 도구</dt><dd>화면을 확대·축소합니다. 확대 도구는 Shift 클릭으로 축소합니다.</dd>
            <dt>Space + 드래그 / 휠 버튼 드래그</dt><dd>화면을 이동합니다.</dd>
            <dt>Ctrl(⌘) + Z / Ctrl(⌘) + Shift + Z</dt><dd>실행 취소 / 다시 실행합니다.</dd>
            <dt>[ / ]</dt><dd>선택한 관절, 면 또는 도형의 순서를 뒤로 / 앞으로 이동합니다.</dd>
            <dt>방향키 / Shift + 방향키</dt><dd>선택한 도형이나 꼭짓점을 1px / 10px 평행 이동합니다.</dd>
            <dt>Shift + 도형 드래그</dt><dd>처음 움직인 방향을 기준으로 수평 또는 수직 평행 이동합니다. 짧게 클릭하면 다중 선택을 전환합니다.</dd>
            <dt>Alt(Option) + 도형 드래그</dt><dd>현재 선택 도형을 복제하고 복제본을 이동합니다. Shift를 함께 누르면 수평·수직으로 제한합니다.</dd>
            <dt>Delete / Backspace</dt><dd>선택한 꼭짓점 또는 선택한 도형들을 삭제합니다.</dd>
            <dt>Ctrl(⌘) + A / Esc</dt><dd>도형 편집 중 모든 도형 선택 / 도형 선택 해제입니다.</dd>
          </dl></section>
          <p>운영체제나 브라우저가 Alt 드래그를 가로채는 경우 비율 유지 체크박스를 사용하세요.</p>
        </div>
      </dialog>
      <dialog class="export-preview-dialog" data-export-preview-dialog>
        <div class="export-preview-header">
          <div>
            <span class="eyebrow" data-export-kind>MODEL EXPORT</span>
            <h2 data-export-title>단일 모델 내보내기</h2>
          </div>
          <button type="button" class="preview-close-button" data-close-export-preview aria-label="미리보기 닫기">×</button>
        </div>
        <div class="export-preview-stage">
          <img data-export-preview-image alt="가이드가 제외된 저장 이미지 미리보기" />
        </div>
        <div class="export-preview-footer">
          <div class="export-format-control">
            <label>포맷 <select data-export-format></select></label>
            <span data-export-preview-size></span>
            <span class="export-status" data-export-status aria-live="polite"></span>
          </div>
          <button class="save-image-button" type="button" data-confirm-export>내보내기</button>
        </div>
      </dialog>
      <dialog class="preset-dialog" data-preset-dialog>
        <div class="preset-dialog-header">
          <div><span class="eyebrow">PROJECT DATA</span><h2>저장과 불러오기</h2></div>
          <button type="button" class="preview-close-button" data-close-preset aria-label="저장과 불러오기 닫기">×</button>
        </div>
        <div class="preset-dialog-content">
          <p>저장 파일에는 현재 지원하는 데이터를 모두 담습니다. 아래 체크는 불러올 때 현재 인물에 적용할 항목만 고릅니다.</p>
          <h3 class="preset-section-title">불러오기 적용 항목</h3>
          <div class="preset-part-list">
            <label><input type="checkbox" data-preset-pose checked /> <span><strong>포즈</strong><small>관절 위치와 회전, 축선 각도</small></span></label>
            <label><input type="checkbox" data-preset-proportions checked /> <span><strong>비율</strong><small>관절 크기와 부모 기준 거리</small></span></label>
            <label><input type="checkbox" data-preset-colors checked /> <span><strong>색상</strong><small>기본색과 관절·면별 색상</small></span></label>
            <label><input type="checkbox" data-preset-shapes checked /> <span><strong>자유 도형</strong><small>다각형과 축 끝점 연결</small></span></label>
          </div>
          <p class="preset-status" data-preset-status aria-live="polite"></p>
          <p class="hint" data-workspace-cache-status aria-live="polite">작업 내용은 이 브라우저에 자동 저장됩니다.</p>
        </div>
        <div class="preset-dialog-footer">
          <span>형식: Pose Mesh Editor JSON v1</span>
          <div class="save-buttons">
            <button class="save-image-button is-secondary" type="button" data-load-preset>파일 불러오기</button>
            <button class="save-image-button" type="button" data-save-preset>JSON 저장</button>
          </div>
          <input type="file" accept="application/json,.json" data-preset-file hidden />
        </div>
      </dialog>
    </main>
  `;

  const svg = requireElement<SVGSVGElement>(container, ".rig-canvas");
  const workspace = requireElement<HTMLElement>(container, ".workspace");
  const inspectorHost = requireElement<HTMLElement>(container, "[data-inspector-host]");
  const openModelExportButton = requireElement<HTMLButtonElement>(container, "[data-open-model-export]");
  const openPresetButton = requireElement<HTMLButtonElement>(container, "[data-open-preset]");
  const openControlsButton = requireElement<HTMLButtonElement>(container, "[data-open-controls]");
  const controlsDialog = requireElement<HTMLDialogElement>(container, "[data-controls-dialog]");
  const closeControlsButton = requireElement<HTMLButtonElement>(container, "[data-close-controls]");
  const outlineToggle = requireElement<HTMLInputElement>(container, "[data-show-outlines]");
  const sameJointEdgeToggle = requireElement<HTMLInputElement>(container, "[data-hide-same-joint-edges]");
  const extendHiddenJointFacesToggle = requireElement<HTMLInputElement>(container, "[data-extend-hidden-joint-faces]");
  const previewDialog = requireElement<HTMLDialogElement>(container, "[data-export-preview-dialog]");
  const previewImage = requireElement<HTMLImageElement>(container, "[data-export-preview-image]");
  const previewSize = requireElement<HTMLElement>(container, "[data-export-preview-size]");
  const previewCloseButton = requireElement<HTMLButtonElement>(container, "[data-close-export-preview]");
  const exportKind = requireElement<HTMLElement>(container, "[data-export-kind]");
  const exportTitle = requireElement<HTMLElement>(container, "[data-export-title]");
  const exportFormatSelect = requireElement<HTMLSelectElement>(container, "[data-export-format]");
  const exportStatus = requireElement<HTMLElement>(container, "[data-export-status]");
  const confirmExportButton = requireElement<HTMLButtonElement>(container, "[data-confirm-export]");
  const presetDialog = requireElement<HTMLDialogElement>(container, "[data-preset-dialog]");
  const closePresetButton = requireElement<HTMLButtonElement>(container, "[data-close-preset]");
  const savePresetButton = requireElement<HTMLButtonElement>(container, "[data-save-preset]");
  const loadPresetButton = requireElement<HTMLButtonElement>(container, "[data-load-preset]");
  const presetFileInput = requireElement<HTMLInputElement>(container, "[data-preset-file]");
  const presetStatus = requireElement<HTMLElement>(container, "[data-preset-status]");
  const workspaceCacheStatus = requireElement<HTMLElement>(container, "[data-workspace-cache-status]");
  if (restoredWorkspace) {
    workspaceCacheStatus.textContent = `자동 저장 작업 복원됨 · ${new Date(restoredWorkspace.savedAt).toLocaleString()}`;
  }
  const globalAngleInput = requireElement<HTMLInputElement>(container, "[data-global-angle]");
  const globalAngleNumber = requireElement<HTMLInputElement>(container, "[data-global-angle-number]");
  const avatarPresetSelect = requireElement<HTMLSelectElement>(container, "[data-avatar-preset]");
  avatarPresetSelect.value = DEFAULT_AVATAR_PRESET_ID;
  const applyAvatarPresetButton = requireElement<HTMLButtonElement>(container, "[data-apply-avatar-preset]");
  const addAvatarPresetButton = requireElement<HTMLButtonElement>(container, "[data-add-avatar-preset]");
  const deleteAvatarPresetButton = requireElement<HTMLButtonElement>(container, "[data-delete-avatar-preset]");
  const avatarPresetStatus = requireElement<HTMLElement>(container, "[data-avatar-preset-status]");
  const posePresetSelect = requireElement<HTMLSelectElement>(container, "[data-pose-preset]");
  const applyPosePresetButton = requireElement<HTMLButtonElement>(container, "[data-apply-pose-preset]");
  const addPosePresetButton = requireElement<HTMLButtonElement>(container, "[data-add-pose-preset]");
  const deletePosePresetButton = requireElement<HTMLButtonElement>(container, "[data-delete-pose-preset]");
  const posePresetStatus = requireElement<HTMLElement>(container, "[data-pose-preset-status]");
  const undoButton = requireElement<HTMLButtonElement>(container, "[data-undo]");
  const redoButton = requireElement<HTMLButtonElement>(container, "[data-redo]");
  const zoomOutButton = requireElement<HTMLButtonElement>(container, "[data-zoom-out]");
  const zoomResetButton = requireElement<HTMLButtonElement>(container, "[data-zoom-reset]");
  const zoomInButton = requireElement<HTMLButtonElement>(container, "[data-zoom-in]");
  const fitSelectionButton = requireElement<HTMLButtonElement>(container, "[data-fit-selection]");
  const selectToolButton = requireElement<HTMLButtonElement>(container, "[data-tool-select]");
  const polygonToolButton = requireElement<HTMLButtonElement>(container, "[data-tool-polygon]");
  const circleToolButton = requireElement<HTMLButtonElement>(container, "[data-tool-circle]");
  const lineToolButton = requireElement<HTMLButtonElement>(container, "[data-tool-line]");
  const vertexAddToolButton = requireElement<HTMLButtonElement>(container, "[data-tool-vertex-add]");
  const vertexBindToolButton = requireElement<HTMLButtonElement>(container, "[data-tool-vertex-bind]");
  const colorToolButton = requireElement<HTMLButtonElement>(container, "[data-tool-color]");
  const zoomToolButton = requireElement<HTMLButtonElement>(container, "[data-tool-zoom]");
  const panToolButton = requireElement<HTMLButtonElement>(container, "[data-tool-pan]");
  const layerOrderToolButton = requireElement<HTMLButtonElement>(container, "[data-tool-layer-order]");
  const shapeCount = requireElement<HTMLElement>(container, "[data-shape-count]");
  const paintColorInput = requireElement<HTMLInputElement>(container, "[data-paint-color]");
  const paletteGrid = requireElement<HTMLElement>(container, ".palette-grid");
  const togglePosePlaybackButton = requireElement<HTMLButtonElement>(container, "[data-toggle-pose-playback]");
  const posePlaybackModeSelect = requireElement<HTMLSelectElement>(container, "[data-pose-playback-mode]");
  const closingFramesControl = requireElement<HTMLElement>(container, "[data-closing-frames-control]");
  const closingFramesInput = requireElement<HTMLInputElement>(container, "[data-closing-frames]");
  const addPoseKeyButton = requireElement<HTMLButtonElement>(container, "[data-add-pose-key]");
  const updatePoseKeyButton = requireElement<HTMLButtonElement>(container, "[data-update-pose-key]");
  const deletePoseKeyButton = requireElement<HTMLButtonElement>(container, "[data-delete-pose-key]");
  const savePoseAnimationButton = requireElement<HTMLButtonElement>(container, "[data-save-pose-animation]");
  const loadPoseAnimationButton = requireElement<HTMLButtonElement>(container, "[data-load-pose-animation]");
  const openAnimationExportButton = requireElement<HTMLButtonElement>(container, "[data-open-animation-export]");
  const poseAnimationFileInput = requireElement<HTMLInputElement>(container, "[data-pose-animation-file]");
  const poseGapInput = requireElement<HTMLInputElement>(container, "[data-pose-gap]");
  const interpolationFrameInput = requireElement<HTMLInputElement>(container, "[data-interpolation-frame]");
  const interpolationStatus = requireElement<HTMLOutputElement>(container, "[data-interpolation-status]");
  const promoteInterpolationButton = requireElement<HTMLButtonElement>(container, "[data-promote-interpolation]");
  const exitInterpolationButton = requireElement<HTMLButtonElement>(container, "[data-exit-interpolation]");
  const poseKeyList = requireElement<HTMLElement>(container, "[data-pose-key-list]");
  const collapseInspectorButton = requireElement<HTMLButtonElement>(container, "[data-collapse-inspector]");
  const collapseTimelineButton = requireElement<HTMLButtonElement>(container, "[data-collapse-timeline]");
  let previewUrl: string | null = null;
  let exportTarget: "model" | "animation" = "model";
  let poseClip: PoseClip = restoredWorkspace?.poseClip ?? {
    id: "main-clip",
    name: "기본 클립",
    fps: 12,
    keys: [],
    playback: { mode: "ping-pong", closingFrames: 6 },
  };
  let poseFrame = restoredWorkspace?.poseFrame ?? 0;
  let selectedPoseKeyId: string | null = restoredWorkspace?.selectedPoseKeyId ?? null;
  let poseKeySequence = poseClip.keys.reduce((max, key) => {
    const match = /^pose-(\d+)$/.exec(key.id);
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0);
  let interpolationPreviewActive = restoredWorkspace?.interpolationPreviewActive === true && poseClip.keys.length >= 2;
  let posePlaybackActive = false;
  let posePlaybackDirection: 1 | -1 = 1;
  let posePlaybackRequestId: number | null = null;
  let posePlaybackTimestamp: number | null = null;
  let posePlaybackFrameRemainder = 0;
  let draggedPoseKeyId: string | null = null;
  let posePresets: UserPosePreset[] = restoredWorkspace?.posePresets ?? [];
  let selectedPosePresetId = BUILTIN_T_POSE_ID;
  let posePresetSequence = posePresets.reduce((max, preset) => {
    const match = /^user-pose-(\d+)$/.exec(preset.id);
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0);
  let bodyPresets: UserBodyPreset[] = restoredWorkspace?.bodyPresets ?? [];
  let selectedBodyPresetId: string = DEFAULT_AVATAR_PRESET_ID;
  let bodyPresetSequence = bodyPresets.reduce((max, preset) => {
    const match = /^user-body-(\d+)$/.exec(preset.id);
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0);
  let workspaceCacheTimer: number | null = null;
  const persistWorkspaceCache = () => {
    const cache = createWorkspaceCache(state.rig, poseClip, Math.round(poseFrame), selectedPoseKeyId,
      interpolationPreviewActive, posePresets, bodyPresets);
    if (saveWorkspaceCache(cache)) {
      workspaceCacheStatus.textContent = `자동 저장됨 · ${new Date(cache.savedAt).toLocaleTimeString()}`;
    } else {
      workspaceCacheStatus.textContent = "자동 저장 실패 · 브라우저 저장 공간을 확인하세요.";
    }
  };
  const scheduleWorkspaceCache = () => {
    if (posePlaybackActive) return;
    if (workspaceCacheTimer !== null) window.clearTimeout(workspaceCacheTimer);
    workspaceCacheTimer = window.setTimeout(() => {
      workspaceCacheTimer = null;
      persistWorkspaceCache();
    }, 250);
  };
  window.addEventListener("pagehide", persistWorkspaceCache);
  const getPresetParts = (): PresetParts => ({
    pose: container.querySelector<HTMLInputElement>("[data-preset-pose]")?.checked ?? false,
    proportions: container.querySelector<HTMLInputElement>("[data-preset-proportions]")?.checked ?? false,
    colors: container.querySelector<HTMLInputElement>("[data-preset-colors]")?.checked ?? false,
    shapes: container.querySelector<HTMLInputElement>("[data-preset-shapes]")?.checked ?? false,
  });
  const inspector = createInspector();
  inspectorHost.append(inspector);

  const setSelection = (next: EditorSelection) => {
    const uniqueIds = [...new Set(next.jointIds)];
    selection = {
      ...next,
      jointIds: uniqueIds,
      jointId: next.jointId && uniqueIds.includes(next.jointId)
        ? next.jointId
        : uniqueIds.at(-1) ?? null,
    };
    viewState.selectedTarget = "joint";
    viewState.selectedShapeId = null;
    viewState.selectedShapeIds = [];
    viewState.selectedShapeVertexId = null;
    render();
  };
  const setViewState = (next: Partial<EditorViewState>) => {
    if ("selectedShapeId" in next && !("selectedShapeIds" in next)) {
      next.selectedShapeIds = next.selectedShapeId ? [next.selectedShapeId] : [];
    }
    Object.assign(viewState, next);
    render();
  };
  const applyRigSnapshot = (rig: Rig) => {
    state.beginHistoryTransaction();
    Object.assign(state.rig, structuredClone(rig));
    state.endHistoryTransaction();
  };
  const render = () => {
    if (viewState.selectedShapeId && !state.rig.artShapes?.some((shape) => shape.id === viewState.selectedShapeId)) {
      viewState.selectedShapeId = null;
      viewState.selectedShapeVertexId = null;
    }
    const currentShapes = state.rig.artShapes ?? [];
    const currentShapeIds = new Set(currentShapes.map((shape) => shape.id));
    viewState.selectedShapeIds = (viewState.selectedShapeIds ?? []).filter((id) => currentShapeIds.has(id));
    if (!viewState.selectedShapeId && viewState.selectedShapeIds.length) {
      viewState.selectedShapeId = viewState.selectedShapeIds.at(-1) ?? null;
    }
    for (const key of poseClip.keys) {
      key.rig.artShapes ??= [];
      key.rig.artCompositeGroups = structuredClone(state.rig.artCompositeGroups ?? []);
      key.rig.elementLayers = structuredClone(state.rig.elementLayers);
      for (const currentJoint of state.rig.joints) {
        const keyJoint = key.rig.joints.find((joint) => joint.id === currentJoint.id);
        if (!keyJoint) continue;
        keyJoint.axes = currentJoint.axes.map((currentAxis) => {
          const keyAxis = keyJoint.axes.find((axis) => axis.id === currentAxis.id);
          if (!keyAxis) return structuredClone(currentAxis);
          keyAxis.pointSides = [...currentAxis.pointSides];
          return keyAxis;
        });
          keyJoint.outlineVisible = currentJoint.outlineVisible ?? true;
          keyJoint.faceExtensionEnabled = currentJoint.faceExtensionEnabled ?? true;
      }
      key.rig.artShapes = key.rig.artShapes.filter((shape) => currentShapeIds.has(shape.id));
      for (const shape of currentShapes) {
        const keyShape = key.rig.artShapes.find((candidate) => candidate.id === shape.id);
        if (!keyShape) {
          key.rig.artShapes.push(structuredClone(shape));
          continue;
        }
        keyShape.vertices = shape.vertices.map((vertex) => {
          const existing = keyShape.vertices.find((candidate) => candidate.id === vertex.id);
          const sameBinding = existing?.source === vertex.source
            && (vertex.source === "self"
              || (vertex.source === "root" && existing.source === "root" && existing.rootJointId === vertex.rootJointId)
              || (vertex.source === "axis-point" && existing.source === "axis-point"
                && existing.jointId === vertex.jointId && existing.axisId === vertex.axisId && existing.side === vertex.side));
          return sameBinding ? existing : structuredClone(vertex);
        });
        keyShape.compositeMode = shape.compositeMode ?? "paint";
        keyShape.compositeGroupId = shape.compositeGroupId ?? `composite-${shape.id}`;
      }
    }
    const globalAngle = toSignedAngle(state.getGlobalRotation());
    globalAngleInput.value = String(globalAngle);
    globalAngleNumber.value = globalAngle.toFixed(0);
    undoButton.disabled = !state.canUndo;
    redoButton.disabled = !state.canRedo;
    selectToolButton.classList.toggle("is-active", viewState.activeTool === "select");
    polygonToolButton.classList.toggle("is-active", viewState.activeTool === "polygon");
    lineToolButton.classList.toggle("is-active", viewState.activeTool === "line");
    vertexAddToolButton.classList.toggle("is-active", viewState.activeTool === "vertex-add");
    vertexBindToolButton.classList.toggle("is-active", viewState.activeTool === "vertex-bind");
    colorToolButton.classList.toggle("is-active", viewState.activeTool === "color");
    layerOrderToolButton.classList.toggle("is-active", viewState.activeTool === "layer-order");
    layerOrderToolButton.setAttribute("aria-pressed", String(viewState.activeTool === "layer-order"));
    shapeCount.textContent = String(currentShapes.length);
    const activePalette = viewState.paintPaletteId
      ? state.rig.palette.find((entry) => entry.id === viewState.paintPaletteId)
      : undefined;
    paintColorInput.value = activePalette?.color ?? viewState.paintColor;
    paletteGrid.innerHTML = state.rig.palette.map((entry) => `<button type="button" class="palette-swatch${entry.id === viewState.paintPaletteId ? " is-selected" : ""}" style="--palette-color:${entry.color}" data-palette-id="${entry.id}" title="${entry.color}"><span class="sr-only">${entry.color}</span></button>`).join("");
    avatarPresetSelect.innerHTML = `${AVATAR_PROPORTION_PRESETS
      .map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`).join("")}${FILE_BODY_PRESETS
      .map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`).join("")}${bodyPresets
      .map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`).join("")}`;
    avatarPresetSelect.value = [...AVATAR_PROPORTION_PRESETS, ...FILE_BODY_PRESETS, ...bodyPresets]
      .some((preset) => preset.id === selectedBodyPresetId)
      ? selectedBodyPresetId : DEFAULT_AVATAR_PRESET_ID;
    deleteAvatarPresetButton.disabled = !bodyPresets.some((preset) => preset.id === avatarPresetSelect.value);
    posePresetSelect.innerHTML = `<option value="${BUILTIN_T_POSE_ID}">${BUILTIN_T_POSE_NAME}</option>${FILE_POSE_PRESETS
      .map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`).join("")}${posePresets
      .map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`).join("")}`;
    posePresetSelect.value = selectedPosePresetId === BUILTIN_T_POSE_ID
      || FILE_POSE_PRESETS.some((preset) => preset.id === selectedPosePresetId)
      || posePresets.some((preset) => preset.id === selectedPosePresetId)
      ? selectedPosePresetId : BUILTIN_T_POSE_ID;
    applyPosePresetButton.disabled = false;
    deletePosePresetButton.disabled = !posePresets.some((preset) => preset.id === posePresetSelect.value);
    svg.classList.toggle("is-color-mode", viewState.activeTool === "color");
    svg.classList.toggle("is-layer-mode", viewState.activeTool === "layer-order");
    svg.classList.toggle("is-polygon-mode", viewState.activeTool === "polygon");
    svg.classList.toggle("is-circle-mode", viewState.activeTool === "circle");
    svg.classList.toggle("is-line-mode", viewState.activeTool === "line");
    svg.classList.toggle("is-vertex-add-mode", viewState.activeTool === "vertex-add");
    svg.classList.toggle("is-vertex-bind-mode", viewState.activeTool === "vertex-bind");
    const orderedKeys = [...poseClip.keys].sort((a, b) => a.frame - b.frame);
    const lastFrame = orderedKeys.at(-1)?.frame ?? 0;
    const hasInterpolation = orderedKeys.length >= 2;
    const playback = getPosePlaybackSettings(poseClip);
    const playbackEndFrame = lastFrame + (playback.mode === "loop" && hasInterpolation ? playback.closingFrames : 0);
    const frameKey = orderedKeys.find((key) => key.frame === poseFrame);
    const sample = orderedKeys.length > 0 ? samplePosePlayback(poseClip, poseFrame) : null;
    togglePosePlaybackButton.disabled = !hasInterpolation;
    openAnimationExportButton.disabled = !hasInterpolation || posePlaybackActive;
    togglePosePlaybackButton.textContent = posePlaybackActive ? "■ 정지" : "▶ 재생";
    posePlaybackModeSelect.value = playback.mode;
    posePlaybackModeSelect.disabled = posePlaybackActive;
    closingFramesControl.hidden = playback.mode !== "loop";
    closingFramesInput.value = String(playback.closingFrames);
    closingFramesInput.disabled = posePlaybackActive;
    loadPoseAnimationButton.disabled = posePlaybackActive;
    interpolationFrameInput.disabled = !hasInterpolation || posePlaybackActive;
    interpolationFrameInput.max = String(playbackEndFrame);
    interpolationFrameInput.value = String(Math.min(playbackEndFrame, poseFrame));
    addPoseKeyButton.disabled = posePlaybackActive;
    updatePoseKeyButton.disabled = posePlaybackActive || !selectedPoseKeyId;
    deletePoseKeyButton.disabled = posePlaybackActive || orderedKeys.length <= 1 || !selectedPoseKeyId;
    promoteInterpolationButton.hidden = posePlaybackActive || !interpolationPreviewActive || Boolean(frameKey) || poseFrame > lastFrame;
    exitInterpolationButton.hidden = posePlaybackActive || !interpolationPreviewActive || poseFrame > lastFrame;
    poseKeyList.innerHTML = orderedKeys.length === 0
      ? `<span class="timeline-empty">키프레임 없음</span>`
      : orderedKeys.map((key) => `
          <button type="button" class="timeline-pose${key.id === selectedPoseKeyId ? " is-selected" : ""}" data-pose-key-id="${key.id}" draggable="${!posePlaybackActive}"${posePlaybackActive ? " disabled" : ""} title="드래그하여 키 순서 변경">
            <strong>${key.name}</strong><span>${key.frame}f</span>
          </button>`).join("");
    interpolationStatus.value = orderedKeys.length === 0
      ? "첫 키프레임을 추가하세요"
      : orderedKeys.length === 1
        ? "다음 포즈를 만든 뒤 키를 추가하세요"
        : posePlaybackActive && sample
          ? `${posePlaybackDirection === 1 ? "▶" : "◀"} ${Math.round(poseFrame)}f · ${sample.leftKey.name} → ${sample.rightKey.name}`
        : interpolationPreviewActive && sample
          ? `${Math.round(poseFrame)}f · ${sample.leftKey.name} → ${sample.rightKey.name}`
          : selectedPoseKeyId
            ? `${orderedKeys.find((key) => key.id === selectedPoseKeyId)?.name ?? "키"} 편집 중`
            : `${orderedKeys.length}개 키프레임`;
    container.classList.toggle("is-interpolation-preview", interpolationPreviewActive);
    const renderedRig = interpolationPreviewActive && sample ? sample.rig : state.rig;
    renderSvgEditor(svg, renderedRig, selection, viewState);
    if (inspector.dataset.liveRangeEditing !== "true") {
      renderInspector(inspector, state, selection, setSelection, viewState, setViewState);
    }
    scheduleWorkspaceCache();
  };

  const stopPosePlayback = () => {
    posePlaybackActive = false;
    posePlaybackTimestamp = null;
    posePlaybackFrameRemainder = 0;
    if (posePlaybackRequestId !== null) window.cancelAnimationFrame(posePlaybackRequestId);
    posePlaybackRequestId = null;
  };
  const animatePosePlayback = (timestamp: number) => {
    if (!posePlaybackActive) return;
    if (posePlaybackTimestamp !== null) {
      posePlaybackFrameRemainder += (timestamp - posePlaybackTimestamp) * poseClip.fps / 1000;
      const elapsedFrames = Math.floor(posePlaybackFrameRemainder);
      if (elapsedFrames > 0) {
        posePlaybackFrameRemainder -= elapsedFrames;
        const next = advancePosePlayback(poseClip, poseFrame, posePlaybackDirection, elapsedFrames);
        poseFrame = next.frame;
        posePlaybackDirection = next.direction;
        selectedPoseKeyId = poseClip.keys.find((key) => key.frame === poseFrame)?.id ?? null;
        render();
      }
    }
    posePlaybackTimestamp = timestamp;
    posePlaybackRequestId = window.requestAnimationFrame(animatePosePlayback);
  };
  const startPosePlayback = () => {
    if (poseClip.keys.length < 2) return;
    posePlaybackActive = true;
    interpolationPreviewActive = true;
    posePlaybackTimestamp = null;
    posePlaybackFrameRemainder = 0;
    const orderedKeys = [...poseClip.keys].sort((a, b) => a.frame - b.frame);
    const firstFrame = orderedKeys[0].frame;
    const lastFrame = orderedKeys[orderedKeys.length - 1].frame;
    const playback = getPosePlaybackSettings(poseClip);
    const playbackEndFrame = lastFrame + (playback.mode === "loop" ? playback.closingFrames : 0);
    if (poseFrame < firstFrame || poseFrame > playbackEndFrame
      || (playback.mode === "loop" && poseFrame >= playbackEndFrame)) poseFrame = firstFrame;
    if (playback.mode === "loop") posePlaybackDirection = 1;
    else if (poseFrame >= lastFrame) posePlaybackDirection = -1;
    render();
    posePlaybackRequestId = window.requestAnimationFrame(animatePosePlayback);
  };

  state.subscribe(render);
  const viewport = enablePointerInput(svg, {
    state,
    getSelection: () => selection,
    getPreserveProportions: () => viewState.preserveProportions,
    getMoveSelectedIndividually: () => viewState.moveSelectedIndividually,
    getPaintColor: () => viewState.activeTool === "color" ? viewState.paintColor : null,
    getLayerToolActive: () => viewState.activeTool === "layer-order",
    getPolygonToolActive: () => viewState.activeTool === "polygon",
    getCircleToolActive: () => viewState.activeTool === "circle",
    getLineToolActive: () => viewState.activeTool === "line",
    getVertexAddToolActive: () => viewState.activeTool === "vertex-add",
    getVertexBindToolActive: () => viewState.activeTool === "vertex-bind",
    getSelectedShapeIds: () => viewState.selectedShapeIds ?? (viewState.selectedShapeId ? [viewState.selectedShapeId] : []),
    duplicateSelectedShapes: (clickedShapeId) => {
      const selectedShapeIds = viewState.selectedShapeIds ?? [];
      const sourceIds = selectedShapeIds.includes(clickedShapeId) ? selectedShapeIds : [clickedShapeId];
      const copyIds = state.duplicateArtShapes(sourceIds);
      if (copyIds.length) {
        viewState.selectedShapeId = copyIds.at(-1) ?? null;
        viewState.selectedShapeIds = copyIds;
        viewState.selectedShapeVertexId = null;
        render();
      }
      return copyIds;
    },
    addPolygonPoint: (point) => {
      viewState.polygonDraft = [...(viewState.polygonDraft ?? []), point];
      render();
    },
    finishPolygon: () => {
      const points = viewState.polygonDraft ?? [];
      if (points.length < 3) return;
      const shapeId = state.addPolygon(points);
      viewState.polygonDraft = [];
      viewState.activeTool = "select";
      viewState.selectedShapeId = shapeId;
      viewState.selectedShapeIds = [shapeId];
      viewState.selectedShapeVertexId = state.getArtShape(shapeId).vertices[0]?.id ?? null;
      render();
    },
    cancelPolygon: () => { viewState.polygonDraft = []; render(); },
    removeLastPolygonPoint: () => { viewState.polygonDraft = (viewState.polygonDraft ?? []).slice(0, -1); render(); },
    addCircle: (point) => {
      const shapeId = state.addCircle(point.x, point.y);
      setViewState({ activeTool: "select", selectedShapeId: shapeId, selectedShapeVertexId: "center", inspectorTab: "selection" });
    },
    addLinePoint: (point) => {
      const points = [...(viewState.lineDraft ?? []), point];
      if (points.length < 2) {
        viewState.lineDraft = points;
        render();
        return;
      }
      const shapeId = state.addLine(points.slice(0, 2));
      viewState.lineDraft = [];
      viewState.activeTool = "select";
      viewState.selectedShapeId = shapeId;
      viewState.selectedShapeIds = [shapeId];
      viewState.selectedShapeVertexId = null;
      render();
    },
    cancelLine: () => { viewState.lineDraft = []; render(); },
    removeLastLinePoint: () => { viewState.lineDraft = (viewState.lineDraft ?? []).slice(0, -1); render(); },
    insertShapeVertex: (shapeId, afterVertexId, point) => {
      const vertexId = state.insertArtShapeVertex(shapeId, afterVertexId, point.x, point.y);
      setViewState({ selectedShapeId: shapeId, selectedShapeVertexId: vertexId, inspectorTab: "selection" });
    },
    bindSelectedShapeVertex: (jointId, axisId, side, snap) => {
      if (!viewState.selectedShapeId || !viewState.selectedShapeVertexId) return;
      state.bindArtShapeVertexToAxis(viewState.selectedShapeId, viewState.selectedShapeVertexId, jointId, axisId, side, snap);
    },
    deleteSelectedShapeVertex: () => {
      if (!viewState.selectedShapeId || !viewState.selectedShapeVertexId) return false;
      const shape = state.getArtShape(viewState.selectedShapeId);
      if (shape.kind !== "polygon" || shape.vertices.length <= 3) return false;
      viewState.selectedShapeVertexId = state.removeArtShapeVertex(shape.id, viewState.selectedShapeVertexId);
      render();
      return true;
    },
    setSelection,
    setSelectedFace: (selectedFaceId) => setViewState({ selectedFaceId, selectedTarget: "face", selectedShapeId: null, selectedShapeVertexId: null }),
    setSelectedShape: (selectedShapeId, selectedShapeVertexId, additive = false) => {
      const selected = new Set(viewState.selectedShapeIds ?? []);
      if (additive && selected.has(selectedShapeId)) selected.delete(selectedShapeId);
      else {
        if (!additive) selected.clear();
        selected.add(selectedShapeId);
      }
      const selectedShapeIds = [...selected];
      setViewState({
        selectedShapeId: selected.has(selectedShapeId) ? selectedShapeId : selectedShapeIds.at(-1) ?? null,
        selectedShapeIds,
        selectedShapeVertexId: additive ? null : selectedShapeVertexId ?? null,
        selectedTarget: "joint",
        inspectorTab: "selection",
      });
    },
    setSelectedShapes: (selectedShapeIds) => {
      setViewState({
        selectedShapeId: selectedShapeIds.at(-1) ?? null,
        selectedShapeIds,
        selectedShapeVertexId: null,
        selectedTarget: "joint",
        inspectorTab: "selection",
      });
    },
  });
  undoButton.addEventListener("click", () => state.undo());
  redoButton.addEventListener("click", () => state.redo());
  zoomOutButton.addEventListener("click", () => viewport.zoomBy(1.25));
  zoomResetButton.addEventListener("click", () => viewport.resetView());
  zoomInButton.addEventListener("click", () => viewport.zoomBy(0.8));
  fitSelectionButton.addEventListener("click", () => viewport.fitSelection());
  togglePosePlaybackButton.addEventListener("click", () => {
    if (posePlaybackActive) {
      stopPosePlayback();
      render();
    } else {
      startPosePlayback();
    }
  });
  posePlaybackModeSelect.addEventListener("change", () => {
    const mode = posePlaybackModeSelect.value === "loop" ? "loop" : "ping-pong";
    poseClip = { ...poseClip, playback: { ...getPosePlaybackSettings(poseClip), mode } };
    const lastFrame = Math.max(0, ...poseClip.keys.map((key) => key.frame));
    if (mode === "ping-pong" && poseFrame > lastFrame) poseFrame = lastFrame;
    posePlaybackDirection = 1;
    render();
  });
  closingFramesInput.addEventListener("change", () => {
    const closingFrames = Math.max(1, Math.round(closingFramesInput.valueAsNumber || 1));
    poseClip = { ...poseClip, playback: { ...getPosePlaybackSettings(poseClip), closingFrames } };
    const lastFrame = Math.max(0, ...poseClip.keys.map((key) => key.frame));
    poseFrame = Math.min(poseFrame, lastFrame + closingFrames);
    closingFramesInput.value = String(closingFrames);
    render();
  });
  const insertPoseKey = (frame: number, rig: Rig) => {
    const keyIndex = poseKeySequence++;
    const key = createPoseKey(
      `pose-${keyIndex + 1}`,
      `포즈 ${poseKeyLabel(keyIndex)}`,
      frame,
      rig,
    );
    poseClip = addPoseKey(poseClip, key);
    selectedPoseKeyId = key.id;
    poseFrame = frame;
    interpolationPreviewActive = false;
    applyRigSnapshot(rig);
    render();
  };
  addPoseKeyButton.addEventListener("click", () => {
    const orderedKeys = [...poseClip.keys].sort((a, b) => a.frame - b.frame);
    const firstFrame = orderedKeys[0]?.frame ?? 0;
    const lastFrame = orderedKeys.at(-1)?.frame ?? 0;
    const canInsertAtCurrentFrame = poseFrame > firstFrame
      && poseFrame < lastFrame
      && !orderedKeys.some((key) => key.frame === poseFrame);
    if (canInsertAtCurrentFrame) {
      const insertedRig = interpolationPreviewActive ? samplePoseClip(poseClip, poseFrame).rig : state.rig;
      insertPoseKey(poseFrame, insertedRig);
      return;
    }
    const gap = Math.max(1, Math.round(Number(poseGapInput.value) || 1));
    insertPoseKey(orderedKeys.length === 0 ? 0 : lastFrame + gap, state.rig);
  });
  updatePoseKeyButton.addEventListener("click", () => {
    if (!selectedPoseKeyId) return;
    poseClip = {
      ...poseClip,
      keys: poseClip.keys.map((key) => key.id === selectedPoseKeyId
        ? { ...key, rig: structuredClone(state.rig) }
        : key),
    };
    render();
  });
  deletePoseKeyButton.addEventListener("click", () => {
    if (!selectedPoseKeyId || poseClip.keys.length <= 1) return;
    const orderedKeys = [...poseClip.keys].sort((a, b) => a.frame - b.frame);
    const deletedIndex = orderedKeys.findIndex((key) => key.id === selectedPoseKeyId);
    const remaining = orderedKeys.filter((key) => key.id !== selectedPoseKeyId);
    const nextKey = remaining[Math.min(Math.max(0, deletedIndex), remaining.length - 1)];
    poseClip = { ...poseClip, keys: remaining };
    selectedPoseKeyId = nextKey.id;
    poseFrame = nextKey.frame;
    interpolationPreviewActive = false;
    applyRigSnapshot(nextKey.rig);
    render();
  });
  interpolationFrameInput.addEventListener("input", () => {
    poseFrame = Number(interpolationFrameInput.value);
    selectedPoseKeyId = poseClip.keys.find((key) => key.frame === poseFrame)?.id ?? null;
    interpolationPreviewActive = poseClip.keys.length >= 2;
    render();
  });
  exitInterpolationButton.addEventListener("click", () => {
    if (poseClip.keys.length === 0) return;
    const editableRig = samplePoseClip(poseClip, poseFrame).rig;
    interpolationPreviewActive = false;
    applyRigSnapshot(editableRig);
    render();
  });
  promoteInterpolationButton.addEventListener("click", () => {
    if (!interpolationPreviewActive || poseClip.keys.some((key) => key.frame === poseFrame)) return;
    const sampledRig = samplePoseClip(poseClip, poseFrame).rig;
    insertPoseKey(poseFrame, sampledRig);
  });
  poseKeyList.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-pose-key-id]");
    const key = poseClip.keys.find((candidate) => candidate.id === button?.dataset.poseKeyId);
    if (!key) return;
    selectedPoseKeyId = key.id;
    poseFrame = key.frame;
    interpolationPreviewActive = false;
    applyRigSnapshot(key.rig);
    render();
  });
  const clearPoseDropIndicators = () => {
    for (const button of poseKeyList.querySelectorAll(".timeline-pose")) {
      button.classList.remove("is-drop-before", "is-drop-after", "is-dragging");
    }
  };
  poseKeyList.addEventListener("dragstart", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-pose-key-id]");
    if (!button || posePlaybackActive) return;
    draggedPoseKeyId = button.dataset.poseKeyId ?? null;
    if (!draggedPoseKeyId) return;
    button.classList.add("is-dragging");
    event.dataTransfer?.setData("text/plain", draggedPoseKeyId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  poseKeyList.addEventListener("dragover", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-pose-key-id]");
    if (!button || !draggedPoseKeyId || button.dataset.poseKeyId === draggedPoseKeyId) return;
    event.preventDefault();
    for (const candidate of poseKeyList.querySelectorAll(".timeline-pose")) {
      candidate.classList.remove("is-drop-before", "is-drop-after");
    }
    const insertAfter = event.clientX >= button.getBoundingClientRect().left + button.offsetWidth / 2;
    button.classList.add(insertAfter ? "is-drop-after" : "is-drop-before");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  });
  poseKeyList.addEventListener("drop", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-pose-key-id]");
    const targetKeyId = button?.dataset.poseKeyId;
    if (!button || !draggedPoseKeyId || !targetKeyId || targetKeyId === draggedPoseKeyId) return;
    event.preventDefault();
    const insertAfter = event.clientX >= button.getBoundingClientRect().left + button.offsetWidth / 2;
    poseClip = reorderPoseKey(poseClip, draggedPoseKeyId, targetKeyId, insertAfter);
    const movedKey = poseClip.keys.find((key) => key.id === draggedPoseKeyId)!;
    selectedPoseKeyId = movedKey.id;
    poseFrame = movedKey.frame;
    interpolationPreviewActive = false;
    applyRigSnapshot(movedKey.rig);
    draggedPoseKeyId = null;
    render();
  });
  poseKeyList.addEventListener("dragend", () => {
    draggedPoseKeyId = null;
    clearPoseDropIndicators();
  });
  savePoseAnimationButton.addEventListener("click", () => {
    if (poseClip.keys.length === 0) {
      interpolationStatus.value = "저장할 키프레임이 없습니다";
      return;
    }
    const content = JSON.stringify(createPoseAnimationFile(poseClip), null, 2);
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    link.href = url;
    link.download = "pose-animation.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    interpolationStatus.value = `${poseClip.keys.length}개 키프레임 저장 시작`;
  });
  loadPoseAnimationButton.addEventListener("click", () => poseAnimationFileInput.click());
  poseAnimationFileInput.addEventListener("change", async () => {
    const file = poseAnimationFileInput.files?.[0];
    if (!file) return;
    try {
      poseClip = parsePoseAnimationFile(await file.text()).clip;
      poseKeySequence = poseClip.keys.reduce((max, key) => {
        const match = /^pose-(\d+)$/.exec(key.id);
        return Math.max(max, match ? Number(match[1]) : 0);
      }, 0);
      const firstKey = [...poseClip.keys].sort((a, b) => a.frame - b.frame)[0];
      selectedPoseKeyId = firstKey?.id ?? null;
      poseFrame = firstKey?.frame ?? 0;
      interpolationPreviewActive = false;
      if (firstKey) applyRigSnapshot(firstKey.rig);
      render();
      interpolationStatus.value = `${poseClip.keys.length}개 키프레임을 불러왔습니다`;
    } catch (error) {
      interpolationStatus.value = error instanceof Error ? error.message : "애니메이션을 불러오지 못했습니다.";
    } finally {
      poseAnimationFileInput.value = "";
    }
  });
  const setPanelCollapsed = (
    button: HTMLButtonElement,
    className: string,
    collapsed: boolean,
    labels: { open: string; close: string; openGlyph: string; closeGlyph: string },
  ) => {
    workspace.classList.toggle(className, collapsed);
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", collapsed ? labels.open : labels.close);
    button.title = collapsed ? labels.open : labels.close;
    button.textContent = collapsed ? labels.openGlyph : labels.closeGlyph;
    window.requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  };
  collapseInspectorButton.addEventListener("click", () => {
    const collapsed = !workspace.classList.contains("is-inspector-collapsed");
    setPanelCollapsed(collapseInspectorButton, "is-inspector-collapsed", collapsed, {
      open: "속성 패널 펼치기", close: "속성 패널 접기", openGlyph: "‹", closeGlyph: "›",
    });
  });
  collapseTimelineButton.addEventListener("click", () => {
    const collapsed = !workspace.classList.contains("is-timeline-collapsed");
    setPanelCollapsed(collapseTimelineButton, "is-timeline-collapsed", collapsed, {
      open: "보간 타임라인 펼치기", close: "보간 타임라인 접기", openGlyph: "⌃", closeGlyph: "⌄",
    });
  });
  const setPanMode = (enabled: boolean) => {
    panToolButton.setAttribute("aria-pressed", String(enabled));
    panToolButton.classList.toggle("is-active", enabled);
    viewport.setPanMode(enabled);
  };
  const activateTool = (activeTool: EditorViewState["activeTool"], inspectorTab: EditorViewState["inspectorTab"]) => {
    setPanMode(false);
    setViewState({
      activeTool,
      inspectorTab,
      ...(activeTool === "polygon" ? {} : { polygonDraft: [] }),
      ...(activeTool === "line" ? {} : { lineDraft: [] }),
    });
  };
  selectToolButton.addEventListener("click", () => activateTool("select", "selection"));
  polygonToolButton.addEventListener("click", () => {
    setPanMode(false);
    setViewState({ activeTool: "polygon", inspectorTab: "selection", polygonDraft: [], lineDraft: [] });
  });
  circleToolButton.addEventListener("click", () => activateTool("circle", "selection"));
  lineToolButton.addEventListener("click", () => {
    setPanMode(false);
    setViewState({ activeTool: "line", inspectorTab: "selection", lineDraft: [], polygonDraft: [] });
  });
  vertexAddToolButton.addEventListener("click", () => activateTool("vertex-add", "selection"));
  vertexBindToolButton.addEventListener("click", () => activateTool("vertex-bind", "selection"));
  colorToolButton.addEventListener("click", () => activateTool("color", "color"));
  layerOrderToolButton.addEventListener("click", () => activateTool("layer-order", "layers"));
  paletteGrid.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-palette-id]");
    const paletteId = button?.dataset.paletteId;
    const palette = state.rig.palette.find((entry) => entry.id === paletteId);
    if (!palette) return;
    setPanMode(false);
    setViewState({ activeTool: "color", inspectorTab: "color", paintPaletteId: palette.id, paintColor: palette.color });
  });
  container.querySelector<HTMLButtonElement>("[data-new-palette-color]")?.addEventListener("click", () => {
    setPanMode(false);
    setViewState({ activeTool: "color", inspectorTab: "color", paintPaletteId: null });
  });
  paintColorInput.addEventListener("change", () => {
    const mergedPaletteId = viewState.paintPaletteId
      ? state.setPaletteColor(viewState.paintPaletteId, paintColorInput.value)
      : null;
    setPanMode(false);
    setViewState({
      activeTool: "color",
      inspectorTab: "color",
      paintColor: paintColorInput.value,
      paintPaletteId: mergedPaletteId ?? viewState.paintPaletteId,
    });
  });
  zoomToolButton.addEventListener("click", (event) => viewport.zoomBy(event.shiftKey ? 1.25 : 0.8));
  panToolButton.addEventListener("click", () => {
    const enabled = panToolButton.getAttribute("aria-pressed") !== "true";
    setPanMode(enabled);
  });
  applyAvatarPresetButton.addEventListener("click", () => {
    const builtIn = AVATAR_PROPORTION_PRESETS.find((candidate) => candidate.id === selectedBodyPresetId);
    const userPreset = [...FILE_BODY_PRESETS, ...bodyPresets]
      .find((candidate) => candidate.id === selectedBodyPresetId);
    if (builtIn) {
      applyAvatarProportionPreset(state, builtIn.id);
      avatarPresetStatus.textContent = `${builtIn.name} 적용됨`;
    } else if (userPreset) {
      try {
        applyUserBodyPreset(state, userPreset);
        avatarPresetStatus.textContent = `${userPreset.name} 적용됨`;
      } catch (error) {
        avatarPresetStatus.textContent = error instanceof Error ? error.message : "체형 프리셋을 적용하지 못했습니다.";
      }
    }
  });
  avatarPresetSelect.addEventListener("change", () => {
    selectedBodyPresetId = avatarPresetSelect.value;
    deleteAvatarPresetButton.disabled = !bodyPresets.some((preset) => preset.id === selectedBodyPresetId);
    avatarPresetStatus.textContent = "";
  });
  addAvatarPresetButton.addEventListener("click", () => {
    const name = window.prompt("새 체형 프리셋 이름", `체형 ${bodyPresets.length + 1}`)?.trim();
    if (!name) return;
    let id = `user-body-${++bodyPresetSequence}`;
    while ([...FILE_BODY_PRESETS, ...bodyPresets].some((preset) => preset.id === id)) {
      id = `user-body-${++bodyPresetSequence}`;
    }
    const preset = createUserBodyPreset(id, name, state.rig);
    bodyPresets = [...bodyPresets, preset];
    selectedBodyPresetId = preset.id;
    avatarPresetStatus.textContent = `${preset.name} 추가됨`;
    render();
  });
  deleteAvatarPresetButton.addEventListener("click", () => {
    const preset = bodyPresets.find((candidate) => candidate.id === selectedBodyPresetId);
    if (!preset) return;
    bodyPresets = bodyPresets.filter((candidate) => candidate.id !== preset.id);
    selectedBodyPresetId = DEFAULT_AVATAR_PRESET_ID;
    avatarPresetStatus.textContent = `${preset.name} 삭제됨`;
    render();
  });
  posePresetSelect.addEventListener("change", () => {
    selectedPosePresetId = posePresetSelect.value;
    applyPosePresetButton.disabled = !selectedPosePresetId;
    deletePosePresetButton.disabled = !posePresets.some((preset) => preset.id === selectedPosePresetId);
    posePresetStatus.textContent = "";
  });
  addPosePresetButton.addEventListener("click", () => {
    const name = window.prompt("새 포즈 프리셋 이름", `포즈 ${posePresets.length + 1}`)?.trim();
    if (!name) return;
    let id = `user-pose-${++posePresetSequence}`;
    while ([...FILE_POSE_PRESETS, ...posePresets].some((preset) => preset.id === id)) {
      id = `user-pose-${++posePresetSequence}`;
    }
    const preset = createUserPosePreset(id, name, state.rig);
    posePresets = [...posePresets, preset];
    selectedPosePresetId = preset.id;
    posePresetStatus.textContent = `${preset.name} 추가됨`;
    render();
  });
  applyPosePresetButton.addEventListener("click", () => {
    const preset = [...FILE_POSE_PRESETS, ...posePresets]
      .find((candidate) => candidate.id === selectedPosePresetId);
    try {
      interpolationPreviewActive = false;
      if (selectedPosePresetId === BUILTIN_T_POSE_ID) {
        applyTPose(state);
        posePresetStatus.textContent = `${BUILTIN_T_POSE_NAME} 적용됨`;
      } else if (preset) {
        applyUserPosePreset(state, preset);
        posePresetStatus.textContent = `${preset.name} 적용됨`;
      }
    } catch (error) {
      posePresetStatus.textContent = error instanceof Error ? error.message : "포즈 프리셋을 적용하지 못했습니다.";
    }
  });
  deletePosePresetButton.addEventListener("click", () => {
    const preset = posePresets.find((candidate) => candidate.id === selectedPosePresetId);
    if (!preset) return;
    posePresets = posePresets.filter((candidate) => candidate.id !== preset.id);
    selectedPosePresetId = posePresets[0]?.id ?? "";
    posePresetStatus.textContent = `${preset.name} 삭제됨`;
    render();
  });
  globalAngleInput.addEventListener("input", () => {
    if (globalAngleInput.dataset.historyActive !== "true") {
      globalAngleInput.dataset.historyActive = "true";
      state.beginHistoryTransaction();
    }
    state.setGlobalRotation(Number(globalAngleInput.value));
  });
  globalAngleInput.addEventListener("change", () => {
    delete globalAngleInput.dataset.historyActive;
    state.endHistoryTransaction();
  });
  globalAngleNumber.addEventListener("change", () => {
    state.setGlobalRotation(globalAngleNumber.valueAsNumber);
  });
  bindCheckbox(outlineToggle, (outlinesVisible) => setViewState({ outlinesVisible }));
  bindCheckbox(sameJointEdgeToggle, (hideSameJointEdges) => setViewState({ hideSameJointEdges }));
  bindCheckbox(extendHiddenJointFacesToggle, (extendHiddenJointFaces) => setViewState({ extendHiddenJointFaces }));
  bindDialog(openControlsButton, closeControlsButton, controlsDialog);
  bindDialog(openPresetButton, closePresetButton, presetDialog, () => {
    presetStatus.textContent = "";
  });
  savePresetButton.addEventListener("click", () => {
    const content = JSON.stringify(createRigPreset(state.rig, {
      pose: true,
      proportions: true,
      colors: true,
      shapes: true,
    }), null, 2);
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    link.href = url;
    link.download = "pose-mesh-preset.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    presetStatus.textContent = "포즈 · 비율 · 색상 · 자유 도형을 포함한 JSON 저장을 시작했습니다.";
  });
  loadPresetButton.addEventListener("click", () => presetFileInput.click());
  presetFileInput.addEventListener("change", async () => {
    const file = presetFileInput.files?.[0];
    if (!file) return;
    try {
      const applied = applyRigPreset(state, parseRigPreset(await file.text()), getPresetParts());
      presetStatus.textContent = applied.length ? `${applied.join(" · ")}을(를) 불러왔습니다.` : "선택한 항목이 파일에 없습니다.";
    } catch (error) {
      presetStatus.textContent = error instanceof Error ? error.message : "불러오기에 실패했습니다.";
    } finally {
      presetFileInput.value = "";
    }
  });
  const closePreview = () => {
    previewDialog.close();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    previewImage.removeAttribute("src");
  };
  const openExportDialog = (target: "model" | "animation") => {
    exportTarget = target;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const preview = createExportPreview(svg);
    previewUrl = preview.url;
    previewImage.src = preview.url;
    exportKind.textContent = target === "model" ? "MODEL EXPORT" : "ANIMATION EXPORT";
    exportTitle.textContent = target === "model" ? "단일 모델 내보내기" : "애니메이션 내보내기";
    exportFormatSelect.innerHTML = target === "model"
      ? `<option value="png">PNG 이미지</option><option value="svg">SVG 벡터</option>`
      : `<option value="png">PNG 프레임 시퀀스 (.zip)</option><option value="svg">SVG 프레임 시퀀스 (.zip)</option>`;
    exportStatus.textContent = "";
    previewSize.textContent = target === "model"
      ? `${Math.round(preview.width)} × ${Math.round(preview.height)} · 투명 배경`
      : `${getPosePlaybackFrames(poseClip).length}프레임 · ${poseClip.fps}fps · 고정 캔버스 · 투명 배경`;
    previewDialog.showModal();
  };
  openModelExportButton.addEventListener("click", () => openExportDialog("model"));
  openAnimationExportButton.addEventListener("click", () => openExportDialog("animation"));
  previewCloseButton.addEventListener("click", closePreview);
  previewDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePreview();
  });
  previewDialog.addEventListener("click", (event) => {
    if (event.target === previewDialog) closePreview();
  });
  confirmExportButton.addEventListener("click", async () => {
    confirmExportButton.disabled = true;
    confirmExportButton.textContent = "내보내는 중…";
    exportStatus.textContent = "파일을 생성하고 있습니다.";
    try {
      const format = exportFormatSelect.value === "svg" ? "svg" : "png";
      if (exportTarget === "animation") await exportPoseAnimationFrames(poseClip, svg, viewState, format);
      else if (format === "svg") exportDrawingAsSvg(svg);
      else await exportDrawingAsPng(svg);
      exportStatus.textContent = "내보내기를 시작했습니다.";
    } catch (error) {
      console.error(error);
      exportStatus.textContent = error instanceof Error ? error.message : "내보내기에 실패했습니다.";
    } finally {
      confirmExportButton.disabled = false;
      confirmExportButton.textContent = "내보내기";
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (controlsDialog.open || presetDialog.open || previewDialog.open) return;
    const target = event.target as HTMLElement | null;
    const editingText = target instanceof HTMLElement
      && target.matches("input, select, textarea, button, [contenteditable='true']");
    if (editingText) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) state.redo();
      else state.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && viewState.selectedShapeId) {
      event.preventDefault();
      const selectedShapeIds = (state.rig.artShapes ?? []).map((shape) => shape.id);
      setViewState({ selectedShapeId: viewState.selectedShapeId ?? selectedShapeIds.at(-1) ?? null,
        selectedShapeIds, selectedShapeVertexId: null });
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const selectedShapeIds = viewState.selectedShapeIds ?? (viewState.selectedShapeId ? [viewState.selectedShapeId] : []);
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && selectedShapeIds.length) {
      event.preventDefault();
      const distance = event.shiftKey ? 10 : 1;
      const deltaX = event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0;
      const deltaY = event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0;
      if (viewState.selectedShapeId && viewState.selectedShapeVertexId) {
        const shape = state.getArtShape(viewState.selectedShapeId);
        const vertex = shape.vertices.find((candidate) => candidate.id === viewState.selectedShapeVertexId);
        if (vertex) {
          const point = getArtShapeVertexPoint(state.rig, vertex);
          state.moveArtShapeVertex(shape.id, vertex.id, point.x + deltaX, point.y + deltaY);
        }
      } else state.moveArtShapes(selectedShapeIds, deltaX, deltaY);
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selectedShapeIds.length) {
      event.preventDefault();
      viewState.selectedShapeId = null;
      viewState.selectedShapeIds = [];
      viewState.selectedShapeVertexId = null;
      state.removeArtShapes(selectedShapeIds);
      return;
    }
    if (event.key === "Escape" && selectedShapeIds.length) {
      event.preventDefault();
      setViewState({ selectedShapeId: null, selectedShapeIds: [], selectedShapeVertexId: null });
      return;
    }
    if (event.key === "[") {
      event.preventDefault();
      if (viewState.selectedShapeId) state.moveBodyItemInStack("shape", viewState.selectedShapeId, -1, false);
      else if (viewState.selectedTarget === "face") state.moveFaceInLayerStack(viewState.selectedFaceId, -1);
      else if (selection.jointIds.length > 0) state.moveJointsInLayerStack(selection.jointIds, -1);
    } else if (event.key === "]") {
      event.preventDefault();
      if (viewState.selectedShapeId) state.moveBodyItemInStack("shape", viewState.selectedShapeId, 1, false);
      else if (viewState.selectedTarget === "face") state.moveFaceInLayerStack(viewState.selectedFaceId, 1);
      else if (selection.jointIds.length > 0) state.moveJointsInLayerStack(selection.jointIds, 1);
    }
  });
  render();
}

function toSignedAngle(angle: number): number {
  const normalized = ((angle % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
}

function poseKeyLabel(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Required editor element was not created: ${selector}`);
  return element;
}

function bindCheckbox(input: HTMLInputElement, update: (checked: boolean) => void): void {
  input.addEventListener("change", () => update(input.checked));
}

function bindDialog(
  openButton: HTMLButtonElement,
  closeButton: HTMLButtonElement,
  dialog: HTMLDialogElement,
  beforeOpen?: () => void,
): void {
  openButton.addEventListener("click", () => {
    beforeOpen?.();
    dialog.showModal();
  });
  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}
