import { createDefaultRig } from "./rig/default-rig";
import { RigState } from "./rig/rig-state";
import { renderSvgEditor } from "./editor/svg-editor";
import { enablePointerInput } from "./editor/pointer-input";
import { createInspector, renderInspector } from "./editor/inspector";
import { createExportPreview, exportDrawingAsPng, exportDrawingAsSvg } from "./editor/export-image";
import type { EditorSelection, EditorViewState } from "./editor/types";

export function createApp(container: HTMLDivElement): void {
  const state = new RigState(createDefaultRig());
  let selection: EditorSelection = { jointId: "right-elbow", axisId: "upper-arm" };
  const viewState: EditorViewState = {
    outlinesVisible: true,
    hideSameJointEdges: true,
    selectedFaceId: "torso",
  };

  container.innerHTML = `
    <main class="app-shell">
      <header class="app-header">
        <div>
          <span class="eyebrow">2D RIG WORKSPACE</span>
          <h1>Pose Mesh Editor</h1>
        </div>
        <div class="header-tools">
          <p><span class="status-dot"></span>다중 축선 편집 모드</p>
          ${createPoseNavigatorMarkup()}
        </div>
      </header>
      <section class="workspace">
        <div class="canvas-panel">
          <div class="canvas-toolbar">
            <span>5등신 가이드</span>
            <div class="canvas-actions">
              <span>관절 ${state.rig.joints.filter((joint) => !joint.isVirtual).length} · 면 ${state.rig.faces.length}</span>
              <label class="global-rotation-control">전체 회전
                <input type="range" min="0" max="359" step="1" value="${state.getGlobalRotation()}" data-global-angle />
                <span><input type="number" min="0" max="359" step="1" value="${state.getGlobalRotation().toFixed(0)}" data-global-angle-number aria-label="전체 회전 각도 숫자 입력" />°</span>
              </label>
              <label class="toolbar-toggle"><input type="checkbox" data-show-outlines checked />외곽선</label>
              <label class="toolbar-toggle"><input type="checkbox" data-hide-same-joint-edges checked />관절 끝선 숨김</label>
              <div class="save-buttons">
                <button class="save-image-button is-secondary" type="button" data-show-export-preview>저장 미리보기</button>
                <button class="save-image-button is-secondary" type="button" data-save-svg>SVG 저장</button>
                <button class="save-image-button" type="button" data-save-png>PNG 저장</button>
              </div>
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
  const faceShortcut = container.querySelector<HTMLSelectElement>("[data-face-shortcut]");
  const globalAngleInput = container.querySelector<HTMLInputElement>("[data-global-angle]");
  const globalAngleNumber = container.querySelector<HTMLInputElement>("[data-global-angle-number]");
  if (!svg || !inspectorHost || !savePngButton || !saveSvgButton || !outlineToggle
    || !sameJointEdgeToggle || !previewButton || !previewDialog || !previewImage
    || !previewSize || !previewCloseButton || !previewSavePngButton || !previewSaveSvgButton) {
    throw new Error("Editor hosts were not created");
  }
  let previewUrl: string | null = null;
  const inspector = createInspector();
  inspectorHost.append(inspector);

  const updateNavigatorSelection = () => {
    container.querySelectorAll<HTMLButtonElement>("[data-joint-shortcut]").forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.jointShortcut === selection.jointId);
    });
  };

  const setSelection = (next: EditorSelection) => {
    selection = next;
    updateNavigatorSelection();
    render();
  };
  const setViewState = (next: Partial<EditorViewState>) => {
    Object.assign(viewState, next);
    if (faceShortcut) faceShortcut.value = viewState.selectedFaceId;
    render();
  };
  const render = () => {
    if (globalAngleInput && globalAngleNumber) {
      globalAngleInput.value = String(state.getGlobalRotation());
      globalAngleNumber.value = state.getGlobalRotation().toFixed(0);
    }
    renderSvgEditor(svg, state.rig, selection, viewState);
    if (inspector.dataset.liveRangeEditing !== "true") {
      renderInspector(inspector, state, selection, setSelection, viewState, setViewState);
    }
  };

  state.subscribe(render);
  enablePointerInput(svg, {
    state,
    getSelection: () => selection,
    setSelection,
    setSelectedFace: (selectedFaceId) => setViewState({ selectedFaceId }),
  });
  container.querySelectorAll<HTMLButtonElement>("[data-joint-shortcut]").forEach((button) => {
    button.addEventListener("click", () => {
      const jointId = button.dataset.jointShortcut;
      if (!jointId) return;
      const joint = state.getJoint(jointId);
      setSelection({ jointId, axisId: joint.axes[0]?.id ?? null });
    });
  });
  faceShortcut?.addEventListener("change", () => {
    setViewState({ selectedFaceId: faceShortcut.value });
  });
  globalAngleInput?.addEventListener("input", () => {
    state.setGlobalRotation(Number(globalAngleInput.value));
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
  render();
  updateNavigatorSelection();
}

function createPoseNavigatorMarkup(): string {
  const points = [
    ["head", 46, 9], ["chest", 46, 25], ["waist", 46, 43],
    ["left-shoulder", 28, 25], ["right-shoulder", 64, 25],
    ["left-elbow", 24, 39], ["right-elbow", 68, 39],
    ["left-wrist", 21, 53], ["right-wrist", 71, 53],
    ["left-hip", 38, 53], ["right-hip", 54, 53],
    ["left-knee", 38, 70], ["right-knee", 54, 70],
    ["left-ankle", 38, 87], ["right-ankle", 54, 87],
  ] as const;
  return `
    <div class="pose-navigator" aria-label="기본 포즈 관절 선택기">
      <span>관절 선택</span>
      <div class="pose-navigator-map">
        <svg viewBox="0 0 92 100" aria-hidden="true">
          <path d="M46 9 L46 25 M28 25 L64 25 M28 25 L24 39 L21 53 M64 25 L68 39 L71 53 M46 25 L46 43 M46 43 L38 53 L38 70 L38 87 M46 43 L54 53 L54 70 L54 87" />
        </svg>
        ${points.map(([id, x, y]) => `<button type="button" class="pose-shortcut" style="--x:${x}px;--y:${y}px" data-joint-shortcut="${id}" aria-label="${id} 관절 선택" title="${id}"></button>`).join("")}
      </div>
      <select class="pose-face-shortcut" data-face-shortcut aria-label="면 선택">
        <option value="torso">면: torso</option>
        <option value="shoulder-band">면: shoulder-band</option>
        <option value="neck">면: neck</option>
        <option value="pelvis">면: pelvis</option>
        <option value="left-pelvis-triangle">면: left pelvis triangle</option>
        <option value="right-pelvis-triangle">면: right pelvis triangle</option>
        <option value="left-upper-arm">면: left upper arm</option>
        <option value="left-lower-arm">면: left lower arm</option>
        <option value="right-upper-arm">면: right upper arm</option>
        <option value="right-lower-arm">면: right lower arm</option>
        <option value="left-upper-leg">면: left upper leg</option>
        <option value="left-lower-leg">면: left lower leg</option>
        <option value="right-upper-leg">면: right upper leg</option>
        <option value="right-lower-leg">면: right lower leg</option>
      </select>
    </div>`;
}
