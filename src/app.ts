import { createDefaultRig } from "./rig/default-rig";
import { RigState } from "./rig/rig-state";
import { renderSvgEditor } from "./editor/svg-editor";
import { enablePointerInput } from "./editor/pointer-input";
import { createInspector, renderInspector } from "./editor/inspector";
import { createExportPreview, exportDrawingAsPng, exportDrawingAsSvg } from "./editor/export-image";
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
    inspectorTab: "selection",
    preserveProportions: false,
    activeTool: "select",
    paintColor: state.rig.defaultColor,
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
            <span class="tool-icon tool-icon-select" aria-hidden="true">↖</span><small>선택</small>
          </button>
          <div class="toolbox-color-control">
            <button type="button" class="toolbox-button" data-tool-color aria-label="면과 관절 색칠 도구" title="색상을 선택한 뒤 면이나 관절을 클릭하여 적용">
              <span class="tool-icon tool-icon-color" aria-hidden="true"><i></i></span><small>색상</small>
            </button>
            <input type="color" value="${state.rig.defaultColor}" data-paint-color aria-label="몸에 칠할 색상" title="몸에 칠할 색상" />
          </div>
          <button type="button" class="toolbox-button" data-tool-zoom aria-label="확대, Shift 클릭으로 축소" title="확대 · Shift 클릭으로 축소">
            <span class="tool-icon" aria-hidden="true">⌕</span><small>확대</small>
          </button>
          <button type="button" class="toolbox-button" data-tool-pan aria-pressed="false" aria-label="화면 이동 모드" title="화면 이동 모드">
            <span class="tool-icon" aria-hidden="true">✋</span><small>화면</small>
          </button>
          <div class="toolbox-divider"></div>
          <button type="button" class="toolbox-button is-toggle" data-tool-proportions aria-pressed="false" aria-label="몸 비율과 하위 각도 유지" title="부모와의 거리 및 하위 도형 각도 유지">
            <span class="tool-icon" aria-hidden="true">⌁</span><small>비율</small>
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
    </main>
  `;

  const svg = container.querySelector<SVGSVGElement>(".rig-canvas");
  const inspectorHost = container.querySelector<HTMLElement>("[data-inspector-host]");
  const savePngButton = container.querySelector<HTMLButtonElement>("[data-save-png]");
  const saveSvgButton = container.querySelector<HTMLButtonElement>("[data-save-svg]");
  const outlineToggle = container.querySelector<HTMLInputElement>("[data-show-outlines]");
  const sameJointEdgeToggle = container.querySelector<HTMLInputElement>("[data-hide-same-joint-edges]");
  const previewButton = container.querySelector<HTMLButtonElement>("[data-show-export-preview]");
  const previewDialog = container.querySelector<HTMLDialogElement>("[data-export-preview-dialog]");
  const previewImage = container.querySelector<HTMLImageElement>("[data-export-preview-image]");
  const previewSize = container.querySelector<HTMLElement>("[data-export-preview-size]");
  const previewCloseButton = container.querySelector<HTMLButtonElement>("[data-close-export-preview]");
  const previewSavePngButton = container.querySelector<HTMLButtonElement>("[data-preview-save-png]");
  const previewSaveSvgButton = container.querySelector<HTMLButtonElement>("[data-preview-save-svg]");
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
  if (!svg || !inspectorHost || !savePngButton || !saveSvgButton || !outlineToggle
    || !sameJointEdgeToggle || !previewButton || !previewDialog || !previewImage
    || !previewSize || !previewCloseButton || !previewSavePngButton || !previewSaveSvgButton
    || !undoButton || !redoButton || !zoomOutButton || !zoomResetButton || !zoomInButton
    || !fitSelectionButton || !selectToolButton || !colorToolButton || !zoomToolButton
    || !panToolButton || !proportionToolButton || !paintColorInput) {
    throw new Error("Editor hosts were not created");
  }
  let previewUrl: string | null = null;
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
    paintColorInput.value = viewState.paintColor;
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
    setSelectedFace: (selectedFaceId) => setViewState({ selectedFaceId }),
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
  paintColorInput.addEventListener("change", () => {
    setPanMode(false);
    setViewState({ activeTool: "color", inspectorTab: "color", paintColor: paintColorInput.value });
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
    if (editingText || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
    event.preventDefault();
    if (event.shiftKey) state.redo();
    else state.undo();
  });
  render();
}
