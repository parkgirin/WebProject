import { createDefaultRig } from "./rig/default-rig";
import { RigState } from "./rig/rig-state";
import { renderSvgEditor } from "./editor/svg-editor";
import { enablePointerInput } from "./editor/pointer-input";
import { createInspector, renderInspector } from "./editor/inspector";
import { createExportPreview, exportDrawingAsPng, exportDrawingAsSvg } from "./editor/export-image";
import { applyRigPreset, createRigPreset, parseRigPreset, type PresetParts } from "./storage/rig-preset";
import type { EditorSelection, EditorViewState } from "./editor/types";

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
          <div class="toolbox-divider"></div>
          <button type="button" class="toolbox-button is-toggle" data-tool-proportions aria-pressed="false" aria-label="몸 비율과 하위 각도 유지" title="부모와의 거리 및 하위 도형 각도 유지">
            비율
          </button>
        </nav>
        <div class="canvas-panel">
          <div class="canvas-toolbar">
            <span><span class="status-dot"></span> 직접 조작 · 5등신 가이드</span>
            <div class="canvas-actions">
              <span>관절 ${state.rig.joints.filter((joint) => !joint.isVirtual).length} · 면 ${state.rig.faces.length}</span>
              <label class="global-rotation-control">전체 회전
                <input type="range" min="0" max="359" step="1" value="${state.getGlobalRotation()}" data-global-angle />
                <span><input type="number" min="0" max="359" step="1" value="${state.getGlobalRotation().toFixed(0)}" data-global-angle-number aria-label="전체 회전 각도 숫자 입력" />°</span>
              </label>
              <label class="toolbar-toggle"><input type="checkbox" data-show-outlines checked />외곽선</label>
              <label class="toolbar-toggle"><input type="checkbox" data-hide-same-joint-edges checked />관절 끝선 숨김</label>
            </div>
          </div>
          <svg class="rig-canvas" viewBox="0 0 600 780" role="img" aria-label="관절과 연결 면 편집 화면"></svg>
        </div>
        <div data-inspector-host></div>
      </section>
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
  const outlineToggle = container.querySelector<HTMLInputElement>("[data-show-outlines]");
  const sameJointEdgeToggle = container.querySelector<HTMLInputElement>("[data-hide-same-joint-edges]");
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
  const proportionToolButton = container.querySelector<HTMLButtonElement>("[data-tool-proportions]");
  const paintColorInput = container.querySelector<HTMLInputElement>("[data-paint-color]");
  const paletteGrid = container.querySelector<HTMLElement>(".palette-grid");
  if (!svg || !inspectorHost || !savePngButton || !saveSvgButton || !openPresetButton || !outlineToggle
    || !sameJointEdgeToggle || !previewButton || !previewDialog || !previewImage
    || !previewSize || !previewCloseButton || !previewSavePngButton || !previewSaveSvgButton
    || !undoButton || !redoButton || !zoomOutButton || !zoomResetButton || !zoomInButton
    || !fitSelectionButton || !selectToolButton || !colorToolButton || !zoomToolButton
    || !panToolButton || !proportionToolButton || !paintColorInput || !paletteGrid || !presetDialog || !closePresetButton
    || !savePresetButton || !loadPresetButton || !presetFileInput || !presetStatus) {
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
      globalAngleInput.value = String(state.getGlobalRotation());
      globalAngleNumber.value = state.getGlobalRotation().toFixed(0);
    }
    undoButton.disabled = !state.canUndo;
    redoButton.disabled = !state.canRedo;
    proportionToolButton.classList.toggle("is-active", viewState.preserveProportions);
    proportionToolButton.setAttribute("aria-pressed", String(viewState.preserveProportions));
    selectToolButton.classList.toggle("is-active", viewState.activeTool === "select");
    colorToolButton.classList.toggle("is-active", viewState.activeTool === "color");
    const activePalette = viewState.paintPaletteId
      ? state.rig.palette.find((entry) => entry.id === viewState.paintPaletteId)
      : undefined;
    paintColorInput.value = activePalette?.color ?? viewState.paintColor;
    paletteGrid.innerHTML = state.rig.palette.map((entry) => `<button type="button" class="palette-swatch${entry.id === viewState.paintPaletteId ? " is-selected" : ""}" style="--palette-color:${entry.color}" data-palette-id="${entry.id}" title="${entry.color}"><span class="sr-only">${entry.color}</span></button>`).join("");
    svg.classList.toggle("is-color-mode", viewState.activeTool === "color");
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
  proportionToolButton.addEventListener("click", () => {
    setViewState({ preserveProportions: !viewState.preserveProportions });
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
