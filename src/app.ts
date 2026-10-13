import { createDefaultRig } from "./rig/default-rig";
import { RigState } from "./rig/rig-state";
import { renderSvgEditor } from "./editor/svg-editor";
import { enablePointerInput } from "./editor/pointer-input";
import { createInspector, renderInspector } from "./editor/inspector";
import { exportDrawingAsPng, exportDrawingAsSvg } from "./editor/export-image";
import type { EditorSelection, EditorViewState } from "./editor/types";

export function createApp(container: HTMLDivElement): void {
  const state = new RigState(createDefaultRig());
  let selection: EditorSelection = { jointId: "right-elbow", axisId: "upper-arm" };
  const viewState: EditorViewState = { outlinesVisible: true, selectedFaceId: "torso" };

  container.innerHTML = `
    <main class="app-shell">
      <header class="app-header">
        <div>
          <span class="eyebrow">2D RIG WORKSPACE</span>
          <h1>Pose Mesh Editor</h1>
        </div>
        <p><span class="status-dot"></span>다중 축선 편집 모드</p>
      </header>
      <section class="workspace">
        <div class="canvas-panel">
          <div class="canvas-toolbar">
            <span>5등신 가이드</span>
            <div class="canvas-actions">
              <span>관절 ${state.rig.joints.length} · 면 ${state.rig.faces.length}</span>
              <label class="toolbar-toggle"><input type="checkbox" data-show-outlines checked />외곽선</label>
              <div class="save-buttons">
                <button class="save-image-button is-secondary" type="button" data-save-svg>SVG 저장</button>
                <button class="save-image-button" type="button" data-save-png>PNG 저장</button>
              </div>
            </div>
          </div>
          <svg class="rig-canvas" viewBox="0 0 600 780" role="img" aria-label="관절과 연결 면 편집 화면"></svg>
        </div>
        <div data-inspector-host></div>
      </section>
    </main>
  `;

  const svg = container.querySelector<SVGSVGElement>(".rig-canvas");
  const inspectorHost = container.querySelector<HTMLElement>("[data-inspector-host]");
  const savePngButton = container.querySelector<HTMLButtonElement>("[data-save-png]");
  const saveSvgButton = container.querySelector<HTMLButtonElement>("[data-save-svg]");
  const outlineToggle = container.querySelector<HTMLInputElement>("[data-show-outlines]");
  if (!svg || !inspectorHost || !savePngButton || !saveSvgButton || !outlineToggle) {
    throw new Error("Editor hosts were not created");
  }
  const inspector = createInspector();
  inspectorHost.append(inspector);

  const setSelection = (next: EditorSelection) => {
    selection = next;
    render();
  };
  const setViewState = (next: Partial<EditorViewState>) => {
    Object.assign(viewState, next);
    render();
  };
  const render = () => {
    renderSvgEditor(svg, state.rig, selection, viewState);
    renderInspector(inspector, state, selection, setSelection, viewState, setViewState);
  };

  state.subscribe(render);
  enablePointerInput(svg, {
    state,
    getSelection: () => selection,
    setSelection,
    setSelectedFace: (selectedFaceId) => setViewState({ selectedFaceId }),
  });
  outlineToggle.addEventListener("change", () => {
    setViewState({ outlinesVisible: outlineToggle.checked });
  });
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
}
