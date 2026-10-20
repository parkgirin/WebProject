import { createDefaultRig } from "./rig/default-rig.ts";
import { applyAvatarProportionPreset, AVATAR_PROPORTION_PRESETS } from "./rig/avatar-presets.ts";
import { RigState } from "./rig/rig-state.ts";
import { renderSvgEditor } from "./editor/svg-editor.ts";
import { enablePointerInput } from "./editor/pointer-input.ts";
import { createInspector, renderInspector } from "./editor/inspector.ts";
import { createExportPreview, exportDrawingAsPng, exportDrawingAsSvg } from "./editor/export-image.ts";
import { applyRigPreset, createRigPreset, parseRigPreset, type PresetParts } from "./storage/rig-preset.ts";
import type { EditorSelection, EditorViewState } from "./editor/types.ts";

export function createApp(container: HTMLDivElement): void {
  const state = new RigState(createDefaultRig());
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
    selectedTarget: "joint",
    inspectorTab: "selection",
    preserveProportions: false,
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
            <button class="save-image-button is-secondary" type="button" data-show-export-preview>미리보기</button>
            <button class="save-image-button is-secondary" type="button" data-save-svg>SVG</button>
            <button class="save-image-button" type="button" data-save-png>PNG 저장</button>
          </div>
        </div>
      </header>
      <section class="workspace">
        <nav class="toolbox app-surface" aria-label="편집 도구">
          <span class="toolbox-title">TOOLS</span>
          <button type="button" class="toolbox-button is-active" data-tool-select aria-label="선택과 직접 조작" title="선택과 직접 조작">
            선택
          </button>
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
          <button type="button" class="toolbox-button" data-tool-zoom aria-label="확대, Shift 클릭으로 축소" title="확대 · Shift 클릭으로 축소">
            확대
          </button>
          <button type="button" class="toolbox-button" data-tool-pan aria-pressed="false" aria-label="화면 이동 모드" title="화면 이동 모드">
            화면
          </button>
          <button type="button" class="toolbox-button" data-tool-layer-order aria-pressed="false" title="좌클릭: 앞으로 · 우클릭: 뒤로 · Shift: 맨 앞/뒤">순서</button>
        </nav>
        <div class="canvas-panel">
          <div class="canvas-toolbar">
            <span><span class="status-dot"></span> 직접 조작 · 5등신 가이드</span>
            <div class="canvas-actions">
              <span>관절 ${state.rig.joints.filter((joint) => !joint.isVirtual).length} · 면 ${state.rig.faces.length}</span>
              <label class="avatar-preset-control">체형
                <select data-avatar-preset aria-label="아바타 체형 프리셋">
                  ${AVATAR_PROPORTION_PRESETS.map((preset) => `<option value="${preset.id}">${preset.name}</option>`).join("")}
                </select>
                <button type="button" data-apply-avatar-preset>적용</button>
              </label>
              <span class="avatar-preset-status" data-avatar-preset-status aria-live="polite"></span>
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
        <div data-inspector-host></div>
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
            <dt>체형 프리셋</dt><dd>캔버스 상단에서 7종 체형을 고르고 적용합니다. 현재 회전·색상·가상 중심 오프셋은 유지됩니다.</dd>
          </dl></section>
          <section><h3>순서 도구</h3><dl>
            <dt>좌클릭 / 우클릭</dt><dd>면이나 관절을 한 단계 앞으로 / 뒤로 이동합니다.</dd>
            <dt>Shift + 좌클릭 / 우클릭</dt><dd>맨 앞으로 / 맨 뒤로 이동합니다.</dd>
          </dl></section>
          <section><h3>화면과 편집</h3><dl>
            <dt>휠 / 확대 도구</dt><dd>화면을 확대·축소합니다. 확대 도구는 Shift 클릭으로 축소합니다.</dd>
            <dt>Space + 드래그 / 휠 버튼 드래그</dt><dd>화면을 이동합니다.</dd>
            <dt>Ctrl(⌘) + Z / Ctrl(⌘) + Shift + Z</dt><dd>실행 취소 / 다시 실행합니다.</dd>
            <dt>[ / ]</dt><dd>선택한 관절이나 면의 순서를 뒤로 / 앞으로 이동합니다.</dd>
          </dl></section>
          <p>운영체제나 브라우저가 Alt 드래그를 가로채는 경우 비율 유지 체크박스를 사용하세요.</p>
        </div>
      </dialog>
      <dialog class="export-preview-dialog" data-export-preview-dialog>
        <div class="export-preview-header">
          <div>
            <span class="eyebrow">EXPORT PREVIEW</span>
            <h2>저장할 이미지 미리보기</h2>
          </div>
          <button type="button" class="preview-close-button" data-close-export-preview aria-label="미리보기 닫기">×</button>
        </div>
        <div class="export-preview-stage">
          <img data-export-preview-image alt="가이드가 제외된 저장 이미지 미리보기" />
        </div>
        <div class="export-preview-footer">
          <span data-export-preview-size></span>
          <div class="save-buttons">
            <button class="save-image-button is-secondary" type="button" data-preview-save-svg>SVG 저장</button>
            <button class="save-image-button" type="button" data-preview-save-png>PNG 저장</button>
          </div>
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
            <label class="is-disabled"><input type="checkbox" disabled /> <span><strong>인물 전체</strong><small>도형·텍스처 추가 후 제공 예정</small></span></label>
          </div>
          <p class="preset-status" data-preset-status aria-live="polite"></p>
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

  const svg = container.querySelector<SVGSVGElement>(".rig-canvas");
  const inspectorHost = container.querySelector<HTMLElement>("[data-inspector-host]");
  const savePngButton = container.querySelector<HTMLButtonElement>("[data-save-png]");
  const saveSvgButton = container.querySelector<HTMLButtonElement>("[data-save-svg]");
  const openPresetButton = container.querySelector<HTMLButtonElement>("[data-open-preset]");
  const openControlsButton = container.querySelector<HTMLButtonElement>("[data-open-controls]");
  const controlsDialog = container.querySelector<HTMLDialogElement>("[data-controls-dialog]");
  const closeControlsButton = container.querySelector<HTMLButtonElement>("[data-close-controls]");
  const outlineToggle = container.querySelector<HTMLInputElement>("[data-show-outlines]");
  const sameJointEdgeToggle = container.querySelector<HTMLInputElement>("[data-hide-same-joint-edges]");
  const extendHiddenJointFacesToggle = container.querySelector<HTMLInputElement>("[data-extend-hidden-joint-faces]");
  const previewButton = container.querySelector<HTMLButtonElement>("[data-show-export-preview]");
  const previewDialog = container.querySelector<HTMLDialogElement>("[data-export-preview-dialog]");
  const previewImage = container.querySelector<HTMLImageElement>("[data-export-preview-image]");
  const previewSize = container.querySelector<HTMLElement>("[data-export-preview-size]");
  const previewCloseButton = container.querySelector<HTMLButtonElement>("[data-close-export-preview]");
  const previewSavePngButton = container.querySelector<HTMLButtonElement>("[data-preview-save-png]");
  const previewSaveSvgButton = container.querySelector<HTMLButtonElement>("[data-preview-save-svg]");
  const presetDialog = container.querySelector<HTMLDialogElement>("[data-preset-dialog]");
  const closePresetButton = container.querySelector<HTMLButtonElement>("[data-close-preset]");
  const savePresetButton = container.querySelector<HTMLButtonElement>("[data-save-preset]");
  const loadPresetButton = container.querySelector<HTMLButtonElement>("[data-load-preset]");
  const presetFileInput = container.querySelector<HTMLInputElement>("[data-preset-file]");
  const presetStatus = container.querySelector<HTMLElement>("[data-preset-status]");
  const globalAngleInput = container.querySelector<HTMLInputElement>("[data-global-angle]");
  const globalAngleNumber = container.querySelector<HTMLInputElement>("[data-global-angle-number]");
  const avatarPresetSelect = container.querySelector<HTMLSelectElement>("[data-avatar-preset]");
  const applyAvatarPresetButton = container.querySelector<HTMLButtonElement>("[data-apply-avatar-preset]");
  const avatarPresetStatus = container.querySelector<HTMLElement>("[data-avatar-preset-status]");
  const undoButton = container.querySelector<HTMLButtonElement>("[data-undo]");
  const redoButton = container.querySelector<HTMLButtonElement>("[data-redo]");
  const zoomOutButton = container.querySelector<HTMLButtonElement>("[data-zoom-out]");
  const zoomResetButton = container.querySelector<HTMLButtonElement>("[data-zoom-reset]");
  const zoomInButton = container.querySelector<HTMLButtonElement>("[data-zoom-in]");
  const fitSelectionButton = container.querySelector<HTMLButtonElement>("[data-fit-selection]");
  const selectToolButton = container.querySelector<HTMLButtonElement>("[data-tool-select]");
  const colorToolButton = container.querySelector<HTMLButtonElement>("[data-tool-color]");
  const zoomToolButton = container.querySelector<HTMLButtonElement>("[data-tool-zoom]");
  const panToolButton = container.querySelector<HTMLButtonElement>("[data-tool-pan]");
  const layerOrderToolButton = container.querySelector<HTMLButtonElement>("[data-tool-layer-order]");
  const paintColorInput = container.querySelector<HTMLInputElement>("[data-paint-color]");
  const paletteGrid = container.querySelector<HTMLElement>(".palette-grid");
  if (!svg || !inspectorHost || !savePngButton || !saveSvgButton || !openPresetButton || !openControlsButton || !controlsDialog || !closeControlsButton || !outlineToggle
    || !sameJointEdgeToggle || !extendHiddenJointFacesToggle || !previewButton || !previewDialog || !previewImage
    || !previewSize || !previewCloseButton || !previewSavePngButton || !previewSaveSvgButton
    || !undoButton || !redoButton || !zoomOutButton || !zoomResetButton || !zoomInButton
    || !fitSelectionButton || !selectToolButton || !colorToolButton || !zoomToolButton
    || !panToolButton || !layerOrderToolButton || !paintColorInput || !paletteGrid || !presetDialog || !closePresetButton
    || !savePresetButton || !loadPresetButton || !presetFileInput || !presetStatus
    || !avatarPresetSelect || !applyAvatarPresetButton || !avatarPresetStatus) {
    throw new Error("Editor hosts were not created");
  }
  let previewUrl: string | null = null;
  const getPresetParts = (): PresetParts => ({
    pose: container.querySelector<HTMLInputElement>("[data-preset-pose]")?.checked ?? false,
    proportions: container.querySelector<HTMLInputElement>("[data-preset-proportions]")?.checked ?? false,
    colors: container.querySelector<HTMLInputElement>("[data-preset-colors]")?.checked ?? false,
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
    render();
  };
  const setViewState = (next: Partial<EditorViewState>) => {
    Object.assign(viewState, next);
    render();
  };
  const render = () => {
    if (globalAngleInput && globalAngleNumber) {
      const globalAngle = toSignedAngle(state.getGlobalRotation());
      globalAngleInput.value = String(globalAngle);
      globalAngleNumber.value = globalAngle.toFixed(0);
    }
    undoButton.disabled = !state.canUndo;
    redoButton.disabled = !state.canRedo;
    selectToolButton.classList.toggle("is-active", viewState.activeTool === "select");
    colorToolButton.classList.toggle("is-active", viewState.activeTool === "color");
    layerOrderToolButton.classList.toggle("is-active", viewState.activeTool === "layer-order");
    layerOrderToolButton.setAttribute("aria-pressed", String(viewState.activeTool === "layer-order"));
    const activePalette = viewState.paintPaletteId
      ? state.rig.palette.find((entry) => entry.id === viewState.paintPaletteId)
      : undefined;
    paintColorInput.value = activePalette?.color ?? viewState.paintColor;
    paletteGrid.innerHTML = state.rig.palette.map((entry) => `<button type="button" class="palette-swatch${entry.id === viewState.paintPaletteId ? " is-selected" : ""}" style="--palette-color:${entry.color}" data-palette-id="${entry.id}" title="${entry.color}"><span class="sr-only">${entry.color}</span></button>`).join("");
    svg.classList.toggle("is-color-mode", viewState.activeTool === "color");
    svg.classList.toggle("is-layer-mode", viewState.activeTool === "layer-order");
    renderSvgEditor(svg, state.rig, selection, viewState);
    if (inspector.dataset.liveRangeEditing !== "true") {
      renderInspector(inspector, state, selection, setSelection, viewState, setViewState);
    }
  };

  state.subscribe(render);
  const viewport = enablePointerInput(svg, {
    state,
    getSelection: () => selection,
    getPreserveProportions: () => viewState.preserveProportions,
    getPaintColor: () => viewState.activeTool === "color" ? viewState.paintColor : null,
    getLayerToolActive: () => viewState.activeTool === "layer-order",
    setSelection,
    setSelectedFace: (selectedFaceId) => setViewState({ selectedFaceId, selectedTarget: "face" }),
  });
  undoButton.addEventListener("click", () => state.undo());
  redoButton.addEventListener("click", () => state.redo());
  zoomOutButton.addEventListener("click", () => viewport.zoomBy(1.25));
  zoomResetButton.addEventListener("click", () => viewport.resetView());
  zoomInButton.addEventListener("click", () => viewport.zoomBy(0.8));
  fitSelectionButton.addEventListener("click", () => viewport.fitSelection());
  const setPanMode = (enabled: boolean) => {
    panToolButton.setAttribute("aria-pressed", String(enabled));
    panToolButton.classList.toggle("is-active", enabled);
    viewport.setPanMode(enabled);
  };
  selectToolButton.addEventListener("click", () => {
    setPanMode(false);
    setViewState({ activeTool: "select", inspectorTab: "selection" });
  });
  colorToolButton.addEventListener("click", () => {
    setPanMode(false);
    setViewState({ activeTool: "color", inspectorTab: "color" });
  });
  layerOrderToolButton.addEventListener("click", () => {
    setPanMode(false);
    setViewState({ activeTool: "layer-order", inspectorTab: "layers" });
  });
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
    const preset = AVATAR_PROPORTION_PRESETS.find((candidate) => candidate.id === avatarPresetSelect.value);
    if (!preset) return;
    applyAvatarProportionPreset(state, preset.id);
    avatarPresetStatus.textContent = `${preset.name} 적용됨`;
  });
  globalAngleInput?.addEventListener("input", () => {
    if (globalAngleInput.dataset.historyActive !== "true") {
      globalAngleInput.dataset.historyActive = "true";
      state.beginHistoryTransaction();
    }
    state.setGlobalRotation(Number(globalAngleInput.value));
  });
  globalAngleInput?.addEventListener("change", () => {
    delete globalAngleInput.dataset.historyActive;
    state.endHistoryTransaction();
  });
  globalAngleNumber?.addEventListener("change", () => {
    state.setGlobalRotation(globalAngleNumber.valueAsNumber);
  });
  outlineToggle.addEventListener("change", () => {
    setViewState({ outlinesVisible: outlineToggle.checked });
  });
  sameJointEdgeToggle.addEventListener("change", () => {
    setViewState({ hideSameJointEdges: sameJointEdgeToggle.checked });
  });
  extendHiddenJointFacesToggle.addEventListener("change", () => {
    setViewState({ extendHiddenJointFaces: extendHiddenJointFacesToggle.checked });
  });
  openControlsButton.addEventListener("click", () => controlsDialog.showModal());
  closeControlsButton.addEventListener("click", () => controlsDialog.close());
  controlsDialog.addEventListener("click", (event) => {
    if (event.target === controlsDialog) controlsDialog.close();
  });
  openPresetButton.addEventListener("click", () => {
    presetStatus.textContent = "";
    presetDialog.showModal();
  });
  closePresetButton.addEventListener("click", () => presetDialog.close());
  presetDialog.addEventListener("click", (event) => {
    if (event.target === presetDialog) presetDialog.close();
  });
  savePresetButton.addEventListener("click", () => {
    const content = JSON.stringify(createRigPreset(state.rig, {
      pose: true,
      proportions: true,
      colors: true,
    }), null, 2);
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    link.href = url;
    link.download = "pose-mesh-preset.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    presetStatus.textContent = "포즈 · 비율 · 색상을 포함한 JSON 저장을 시작했습니다.";
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
  previewButton.addEventListener("click", () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const preview = createExportPreview(svg);
    previewUrl = preview.url;
    previewImage.src = preview.url;
    previewSize.textContent = `SVG ${Math.round(preview.width)} × ${Math.round(preview.height)} · PNG 2배 해상도 · 투명 배경`;
    previewDialog.showModal();
  });
  previewCloseButton.addEventListener("click", closePreview);
  previewDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePreview();
  });
  previewDialog.addEventListener("click", (event) => {
    if (event.target === previewDialog) closePreview();
  });
  previewSavePngButton.addEventListener("click", () => exportDrawingAsPng(svg));
  previewSaveSvgButton.addEventListener("click", () => exportDrawingAsSvg(svg));
  savePngButton.addEventListener("click", async () => {
    savePngButton.disabled = true;
    savePngButton.textContent = "저장 중…";
    try {
      await exportDrawingAsPng(svg);
      savePngButton.textContent = "저장 완료";
    } catch (error) {
      console.error(error);
      savePngButton.textContent = "저장 실패";
    } finally {
      window.setTimeout(() => {
        savePngButton.disabled = false;
        savePngButton.textContent = "PNG 저장";
      }, 1200);
    }
  });
  saveSvgButton.addEventListener("click", () => {
    try {
      exportDrawingAsSvg(svg);
      saveSvgButton.textContent = "저장 완료";
    } catch (error) {
      console.error(error);
      saveSvgButton.textContent = "저장 실패";
    } finally {
      window.setTimeout(() => {
        saveSvgButton.textContent = "SVG 저장";
      }, 1200);
    }
  });
  window.addEventListener("keydown", (event) => {
    if (controlsDialog.open || presetDialog.open || previewDialog.open) return;
    const target = event.target as HTMLElement | null;
    const editingText = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
    if (editingText) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) state.redo();
      else state.undo();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "[") {
      event.preventDefault();
      if (viewState.selectedTarget === "face") state.moveFaceInLayerStack(viewState.selectedFaceId, -1);
      else if (selection.jointIds.length > 0) state.moveJointsInLayerStack(selection.jointIds, -1);
    } else if (event.key === "]") {
      event.preventDefault();
      if (viewState.selectedTarget === "face") state.moveFaceInLayerStack(viewState.selectedFaceId, 1);
      else if (selection.jointIds.length > 0) state.moveJointsInLayerStack(selection.jointIds, 1);
    }
  });
  render();
}

function toSignedAngle(angle: number): number {
  const normalized = ((angle % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
}
