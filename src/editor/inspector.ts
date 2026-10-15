import type { RigState } from "../rig/rig-state";
import { getAxisWorldAngle, getJointWorldTransform } from "../rig/geometry";
import type { EditorSelection, EditorViewState } from "./types";

const END_JOINT_IDS = ["left-wrist", "right-wrist", "left-ankle", "right-ankle"];

export function createInspector(): HTMLElement {
  const element = document.createElement("aside");
  element.className = "inspector";
  return element;
}

export function renderInspector(
  element: HTMLElement,
  state: RigState,
  selection: EditorSelection,
  setSelection: (selection: EditorSelection) => void,
  viewState: EditorViewState,
  setViewState: (next: Partial<EditorViewState>) => void,
): void {
  const joint = selection.jointId ? state.getJoint(selection.jointId) : null;
  const selectedAxis = joint?.axes.find((axis) => axis.id === selection.axisId);
  const selectedAxisWorldAngle = joint && selectedAxis
    ? getAxisWorldAngle(state.rig, joint, selectedAxis)
    : null;
  const selectedFace = state.getFace(viewState.selectedFaceId);
  const selectedFaceColor = selectedFace.color ?? state.rig.defaultColor;
  const hasFaceColorOverride = selectedFace.color !== undefined;
  const selectedJointColor = joint?.color ?? state.rig.defaultColor;
  const hasJointColorOverride = joint?.color !== undefined;
  const faceRotation = state.getFaceRotationAngle(viewState.selectedFaceId);
  const lowerBodyRotation = state.getLowerBodyRotation();
  const jointWorld = joint ? getJointWorldTransform(state.rig, joint.id) : null;

  const jointMarkup = joint ? `
    <h2>관절 속성</h2>
    <div class="property-group">
      <span class="eyebrow">선택 관절</span>
      <strong class="selection-name">${escapeHtml(joint.id)}</strong>
      ${selection.jointIds.length > 1 ? `<span class="multi-selection-count">${selection.jointIds.length}개 관절 선택됨</span>` : ""}
      <div class="numeric-field-grid">
        <label for="joint-world-x"><span>월드 X</span><input id="joint-world-x" type="number" step="1" value="${jointWorld!.x.toFixed(1)}" /></label>
        <label for="joint-world-y"><span>월드 Y</span><input id="joint-world-y" type="number" step="1" value="${jointWorld!.y.toFixed(1)}" /></label>
      </div>
    </div>
    <label class="field-label" for="parent-joint">부모 관절</label>
    <select id="parent-joint" class="parent-select">
      <option value="">없음 (최상위)</option>
      ${state.getValidParents(joint.id).map((candidateId) => `<option value="${escapeHtml(candidateId)}"${candidateId === joint.parentJointId ? " selected" : ""}>${escapeHtml(candidateId)}</option>`).join("")}
    </select>
    <p class="hint">부모를 변경해도 현재 화면 포즈는 유지됩니다.</p>
    <label class="field-label" for="joint-radius">반지름</label>
    <div class="range-number-control">
      <input id="joint-radius" type="range" min="8" max="80" step="1" value="${joint.radius}" />
      <input id="joint-radius-number" type="number" min="8" max="80" step="1" value="${joint.radius.toFixed(0)}" aria-label="관절 반지름 숫자 입력" />
    </div>
    <div class="axis-section">
      <div class="section-heading">
        <h3>축선</h3>
        <span>${joint.axes.length}/2</span>
      </div>
      ${joint.axes.length === 0 ? `<p class="muted">이 관절에는 연결 축선이 없습니다.</p>` : `
        <div class="axis-tabs">
          ${joint.axes.map((axis, index) => `
            <button type="button" class="axis-tab${axis.id === selection.axisId ? " is-active" : ""}"
              data-inspector-axis="${escapeHtml(axis.id)}">
              <i class="axis-swatch axis-${index + 1}"></i>${escapeHtml(axis.id)}
            </button>`).join("")}
        </div>`}
      ${selectedAxis ? `
        <label class="field-label" for="axis-angle">선택 축 각도</label>
        <div class="range-number-control angle-control">
          <input id="axis-angle" type="range" min="0" max="359" step="1" value="${selectedAxisWorldAngle}" />
          <span><input id="axis-angle-number" type="number" min="0" max="359" step="1" value="${selectedAxisWorldAngle!.toFixed(0)}" aria-label="선택 축 각도 숫자 입력" />°</span>
        </div>
        <p class="hint">연결 축은 관절 연결선과 직교합니다. 회전하면 연결된 하위 관절과 도형도 함께 회전합니다.</p>` : ""}
    </div>` : `
      <h2>관절 속성</h2>
      <div class="empty-state">
        <strong>관절을 선택하세요</strong>
        <p>Shift+클릭이나 빈 공간 드래그로 여러 관절을 선택할 수 있습니다. 축선을 회전하면 연결된 하위 트리가 함께 움직입니다.</p>
      </div>`;

  const selectionPanel = `
    ${renderPoseNavigator(state, selection, viewState.selectedFaceId)}
    ${jointMarkup}
    <div class="lower-body-section">
      <div class="section-heading"><h3>하체 회전</h3><span>상체 고정</span></div>
      <label class="field-label" for="lower-body-angle">골반 기준 각도</label>
      <div class="range-number-control angle-control">
        <input id="lower-body-angle" type="range" min="-180" max="180" step="1" value="${lowerBodyRotation}" />
        <span><input id="lower-body-angle-number" type="number" min="-180" max="180" step="1" value="${lowerBodyRotation.toFixed(0)}" aria-label="하체 회전 각도 숫자 입력" />°</span>
      </div>
      <p class="hint">허리를 중심으로 골반과 양다리만 회전합니다. 캔버스의 보라색 하체 회전 핸들로도 조작할 수 있습니다.</p>
    </div>`;

  const layerPanel = `
    <div class="layer-section is-tab-root">
      <div class="section-heading">
        <h2>레이어와 그룹</h2>
        <button type="button" class="add-group-button" data-add-layer-group>그룹 추가</button>
      </div>
      ${joint ? `
        <div class="layer-editor-row">
          <span>선택 관절</span>
          <select aria-label="선택 관절 그룹" data-joint-group>${renderGroupOptions(state, joint.groupId)}</select>
          <label>레이어 <input type="number" min="-999" max="999" step="1" value="${joint.renderOrder}" data-joint-layer /></label>
        </div>` : ""}
      <div class="layer-editor-row">
        <span>선택 면</span>
        <select aria-label="선택 면 그룹" data-face-group>${renderGroupOptions(state, selectedFace.groupId)}</select>
        <label>레이어 <input type="number" min="-999" max="999" step="1" value="${state.getFaceLayerOrder(selectedFace.id)}" data-face-layer /></label>
      </div>
      ${state.rig.groups.length > 0 ? `
        <div class="group-visibility-list">
          ${state.rig.groups.map((group) => `
            <div class="group-order-row">
              <label><input type="checkbox" data-layer-group-visible="${escapeHtml(group.id)}"${group.visible ? " checked" : ""} />${escapeHtml(group.name)}</label>
              <input type="number" min="-999" max="999" step="1" value="${group.order}" data-layer-group-order="${escapeHtml(group.id)}" aria-label="${escapeHtml(group.name)} 그룹 렌더 순서" />
              <button type="button" data-select-layer-group="${escapeHtml(group.id)}">선택</button>
            </div>
          `).join("")}
        </div>` : `<p class="hint">그룹을 추가하면 여러 관절과 면의 표시를 함께 전환할 수 있습니다.</p>`}
      <p class="hint">그룹의 선택 버튼은 포함된 모든 관절을 선택합니다. 캔버스에서 Shift+면 클릭을 하면 그 면을 구성하는 관절이 현재 선택에 추가됩니다.</p>
    </div>`;

  const colorPanel = `
    <div class="appearance-section is-tab-root">
      <div class="section-heading">
        <h2>색상</h2>
        <span>${state.rig.faces.length}개 면</span>
      </div>
      <p class="panel-intro">페인트 색상을 고른 뒤 캔버스의 면이나 관절을 클릭하면 즉시 적용됩니다.</p>
      <label class="color-setting-row paint-color-row">
        <span>페인트 색상</span>
        <input type="color" aria-label="몸에 칠할 페인트 색상" value="${escapeHtml(viewState.paintColor)}" data-paint-color-panel />
      </label>
      <label class="color-setting-row">
        <span>전체 기본 색상</span>
        <input type="color" aria-label="전체 기본 색상" value="${escapeHtml(state.rig.defaultColor)}" data-default-color />
      </label>
      ${joint ? `
        <label class="color-setting-row">
          <span>선택 관절 색상</span>
          <input type="color" aria-label="선택 관절 색상" value="${escapeHtml(selectedJointColor)}" data-joint-color${hasJointColorOverride ? "" : " disabled"} />
        </label>
        <label class="face-override-toggle">
          <input type="checkbox" data-joint-color-override${hasJointColorOverride ? " checked" : ""} />
          선택 관절에 별도 색상 사용
        </label>` : ""}
      <div class="face-color-row">
        <select aria-label="색상을 변경할 면" data-face-select>
          ${state.rig.faces.map((face) => `<option value="${escapeHtml(face.id)}"${face.id === selectedFace.id ? " selected" : ""}>${escapeHtml(face.id)}</option>`).join("")}
        </select>
        <input type="color" aria-label="선택 면 색상" value="${escapeHtml(selectedFaceColor)}" data-face-color${hasFaceColorOverride ? "" : " disabled"} />
      </div>
      <label class="face-override-toggle">
        <input type="checkbox" data-face-color-override${hasFaceColorOverride ? " checked" : ""} />
        선택 면에 별도 색상 사용
      </label>
      <p class="hint">별도 색상을 끄면 선택 면은 전체 기본 색상을 따라갑니다.</p>
      <div class="face-rotation-section">
        <div class="section-heading"><h3>선택 면 회전</h3></div>
        ${faceRotation === null
          ? `<p class="hint">골반 면의 가상 피벗 회전은 준비 중입니다.</p>`
          : `<label class="field-label" for="face-angle">회전 각도</label>
             <div class="range-number-control angle-control">
               <input id="face-angle" type="range" min="0" max="359" step="1" value="${faceRotation}" />
               <span><input id="face-angle-number" type="number" min="0" max="359" step="1" value="${faceRotation.toFixed(0)}" aria-label="선택 면 회전 각도 숫자 입력" />°</span>
             </div>
             <p class="hint">연결선을 드래그하는 것과 같은 회전 조작입니다.</p>`}
      </div>
      <div class="section-heading end-joint-heading"><h3>손목·발목 표시</h3></div>
      <div class="visibility-list">
        ${END_JOINT_IDS.map((jointId) => {
          const endJoint = state.getJoint(jointId);
          return `<label><input type="checkbox" data-body-visible="${escapeHtml(jointId)}"${endJoint.bodyVisible ? " checked" : ""} />${escapeHtml(jointId)}</label>`;
        }).join("")}
      </div>
    </div>`;

  element.innerHTML = `
    <div class="inspector-tabs" role="tablist" aria-label="속성 패널">
      <button type="button" data-inspector-tab="selection" class="${viewState.inspectorTab === "selection" ? "is-active" : ""}">선택</button>
      <button type="button" data-inspector-tab="layers" class="${viewState.inspectorTab === "layers" ? "is-active" : ""}">레이어</button>
      <button type="button" data-inspector-tab="color" class="${viewState.inspectorTab === "color" ? "is-active" : ""}">색상</button>
    </div>
    <div class="inspector-panel">
      ${viewState.inspectorTab === "selection" ? selectionPanel : viewState.inspectorTab === "layers" ? layerPanel : colorPanel}
    </div>`;

  element.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const inspectorTab = button.dataset.inspectorTab as EditorViewState["inspectorTab"];
      setViewState({ inspectorTab });
    });
  });
  element.querySelectorAll<HTMLButtonElement>("[data-joint-shortcut]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const jointId = button.dataset.jointShortcut;
      if (!jointId) return;
      const selected = new Set(selection.jointIds);
      if (event.shiftKey) {
        if (selected.has(jointId)) selected.delete(jointId);
        else selected.add(jointId);
      } else {
        selected.clear();
        selected.add(jointId);
      }
      const jointIds = [...selected];
      const primaryId = selected.has(jointId) ? jointId : jointIds.at(-1) ?? null;
      setSelection({
        jointId: primaryId,
        axisId: primaryId ? state.getJoint(primaryId).axes[0]?.id ?? null : null,
        jointIds,
      });
    });
  });
  element.querySelector<HTMLSelectElement>("[data-face-shortcut]")?.addEventListener("change", (event) => {
    setViewState({ selectedFaceId: (event.target as HTMLSelectElement).value });
  });

  bindLiveRange(element, state, "#joint-radius", "#joint-radius-number", (value) => {
    if (joint) state.setJointRadius(joint.id, value);
  });
  bindLiveRange(element, state, "#lower-body-angle", "#lower-body-angle-number", (value) => {
    state.setLowerBodyRotation(value);
  });
  element.querySelector<HTMLInputElement>("#lower-body-angle-number")?.addEventListener("change", (event) => {
    state.setLowerBodyRotation((event.target as HTMLInputElement).valueAsNumber);
  });
  element.querySelector<HTMLInputElement>("#joint-radius-number")?.addEventListener("change", (event) => {
    if (!joint) return;
    state.setJointRadius(joint.id, (event.target as HTMLInputElement).valueAsNumber);
  });
  element.querySelector<HTMLInputElement>("#joint-world-x")?.addEventListener("change", (event) => {
    if (!joint || !jointWorld) return;
    state.moveJoint(joint.id, (event.target as HTMLInputElement).valueAsNumber, jointWorld.y);
  });
  element.querySelector<HTMLInputElement>("#joint-world-y")?.addEventListener("change", (event) => {
    if (!joint || !jointWorld) return;
    state.moveJoint(joint.id, jointWorld.x, (event.target as HTMLInputElement).valueAsNumber);
  });
  element.querySelector<HTMLSelectElement>("#parent-joint")?.addEventListener("change", (event) => {
    if (!joint) return;
    state.setParentJoint(joint.id, (event.target as HTMLSelectElement).value || null);
  });
  bindLiveRange(element, state, "#axis-angle", "#axis-angle-number", (value) => {
    if (joint && selection.axisId) state.setAxisAngle(joint.id, selection.axisId, value);
  });
  element.querySelector<HTMLInputElement>("#axis-angle-number")?.addEventListener("change", (event) => {
    if (!joint || !selection.axisId) return;
    state.setAxisAngle(joint.id, selection.axisId, (event.target as HTMLInputElement).valueAsNumber);
  });
  element.querySelectorAll<HTMLButtonElement>("[data-inspector-axis]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!joint) return;
      setSelection({ jointId: joint.id, axisId: button.dataset.inspectorAxis ?? null, jointIds: selection.jointIds });
    });
  });
  element.querySelector<HTMLSelectElement>("[data-face-select]")?.addEventListener("change", (event) => {
    setViewState({ selectedFaceId: (event.target as HTMLSelectElement).value });
  });
  element.querySelector<HTMLInputElement>("[data-default-color]")?.addEventListener("change", (event) => {
    state.setDefaultColor((event.target as HTMLInputElement).value);
  });
  element.querySelector<HTMLInputElement>("[data-paint-color-panel]")?.addEventListener("change", (event) => {
    const color = (event.target as HTMLInputElement).value;
    const mergedPaletteId = viewState.paintPaletteId
      ? state.setPaletteColor(viewState.paintPaletteId, color)
      : null;
    setViewState({ activeTool: "color", paintColor: color, paintPaletteId: mergedPaletteId ?? viewState.paintPaletteId });
  });
  element.querySelector<HTMLInputElement>("[data-joint-color]")?.addEventListener("change", (event) => {
    if (joint) state.setJointColor(joint.id, (event.target as HTMLInputElement).value);
  });
  element.querySelector<HTMLInputElement>("[data-joint-color-override]")?.addEventListener("change", (event) => {
    if (!joint) return;
    const input = event.target as HTMLInputElement;
    if (input.checked) state.setJointColor(joint.id, selectedJointColor);
    else state.clearJointColor(joint.id);
  });
  element.querySelector<HTMLInputElement>("[data-face-color]")?.addEventListener("change", (event) => {
    state.setFaceColor(viewState.selectedFaceId, (event.target as HTMLInputElement).value);
  });
  element.querySelector<HTMLInputElement>("[data-face-color-override]")?.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.checked) state.setFaceColor(viewState.selectedFaceId, selectedFaceColor);
    else state.clearFaceColor(viewState.selectedFaceId);
  });
  bindLiveRange(element, state, "#face-angle", "#face-angle-number", (value) => {
    state.rotateFace(viewState.selectedFaceId, value);
  });
  element.querySelector<HTMLInputElement>("#face-angle-number")?.addEventListener("change", (event) => {
    state.rotateFace(viewState.selectedFaceId, (event.target as HTMLInputElement).valueAsNumber);
  });
  element.querySelectorAll<HTMLInputElement>("[data-body-visible]").forEach((input) => {
    input.addEventListener("change", () => {
      const jointId = input.dataset.bodyVisible;
      if (jointId) state.setJointBodyVisible(jointId, input.checked);
    });
  });
  element.querySelector<HTMLButtonElement>("[data-add-layer-group]")?.addEventListener("click", () => {
    const name = window.prompt("새 그룹 이름");
    if (name) state.addLayerGroup(name);
  });
  element.querySelector<HTMLSelectElement>("[data-joint-group]")?.addEventListener("change", (event) => {
    if (!joint) return;
    state.setJointGroup(joint.id, (event.target as HTMLSelectElement).value || null);
  });
  element.querySelector<HTMLSelectElement>("[data-face-group]")?.addEventListener("change", (event) => {
    state.setFaceGroup(selectedFace.id, (event.target as HTMLSelectElement).value || null);
  });
  element.querySelector<HTMLInputElement>("[data-joint-layer]")?.addEventListener("change", (event) => {
    if (!joint) return;
    state.setJointRenderOrder(joint.id, (event.target as HTMLInputElement).valueAsNumber);
  });
  element.querySelector<HTMLInputElement>("[data-face-layer]")?.addEventListener("change", (event) => {
    state.setFaceLayerOrder(selectedFace.id, (event.target as HTMLInputElement).valueAsNumber);
  });
  element.querySelectorAll<HTMLInputElement>("[data-layer-group-visible]").forEach((input) => {
    input.addEventListener("change", () => {
      const groupId = input.dataset.layerGroupVisible;
      if (groupId) state.setLayerGroupVisibility(groupId, input.checked);
    });
  });
  element.querySelectorAll<HTMLInputElement>("[data-layer-group-order]").forEach((input) => {
    input.addEventListener("change", () => {
      const groupId = input.dataset.layerGroupOrder;
      if (groupId) state.setLayerGroupOrder(groupId, input.valueAsNumber);
    });
  });
  element.querySelectorAll<HTMLButtonElement>("[data-select-layer-group]").forEach((button) => {
    button.addEventListener("click", () => {
      const groupId = button.dataset.selectLayerGroup;
      if (!groupId) return;
      const jointIds = state.rig.joints
        .filter((candidate) => candidate.groupId === groupId && !candidate.isVirtual)
        .map((candidate) => candidate.id);
      const jointId = jointIds.at(-1) ?? null;
      setSelection({
        jointId,
        axisId: jointId ? state.getJoint(jointId).axes[0]?.id ?? null : null,
        jointIds,
      });
    });
  });
}

function renderGroupOptions(state: RigState, selectedGroupId: string | undefined): string {
  return `
    <option value="">기본 그룹</option>
    ${state.rig.groups.map((group) => `<option value="${escapeHtml(group.id)}"${group.id === selectedGroupId ? " selected" : ""}>${escapeHtml(group.name)}</option>`).join("")}`;
}

function renderPoseNavigator(
  state: RigState,
  selection: EditorSelection,
  selectedFaceId: string,
): string {
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
    <section class="pose-picker" aria-label="기본 포즈 관절 선택기">
      <div class="section-heading">
        <div><span class="eyebrow">SELECT TARGET</span><h2>관절 및 면 선택</h2></div>
        <span>${selection.jointIds.length > 1 ? `${selection.jointIds.length}개 선택` : "기본 포즈"}</span>
      </div>
      <div class="pose-picker-card">
        <div class="pose-navigator-map">
          <svg viewBox="0 0 92 100" aria-hidden="true">
            <path d="M46 9 L46 25 M28 25 L64 25 M28 25 L24 39 L21 53 M64 25 L68 39 L71 53 M46 25 L46 43 M46 43 L38 53 L38 70 L38 87 M46 43 L54 53 L54 70 L54 87" />
          </svg>
          ${points.map(([id, x, y]) => `<button type="button" class="pose-shortcut${selection.jointIds.includes(id) ? " is-selected" : ""}" style="--x:${x}px;--y:${y}px" data-joint-shortcut="${id}" aria-label="${id} 관절 선택" title="${id}"></button>`).join("")}
        </div>
        <div class="pose-picker-current">
          <span class="eyebrow">CURRENT</span>
          <strong>${escapeHtml(selection.jointId ?? "선택 없음")}</strong>
          <select class="pose-face-shortcut" data-face-shortcut aria-label="면 선택">
            ${state.rig.faces.map((face) => `<option value="${escapeHtml(face.id)}"${face.id === selectedFaceId ? " selected" : ""}>면: ${escapeHtml(face.id)}</option>`).join("")}
          </select>
          <small>Shift+클릭으로 다중 선택</small>
        </div>
      </div>
    </section>`;
}

function bindLiveRange(
  element: HTMLElement,
  state: RigState,
  rangeSelector: string,
  numberSelector: string,
  update: (value: number) => void,
): void {
  const range = element.querySelector<HTMLInputElement>(rangeSelector);
  const number = element.querySelector<HTMLInputElement>(numberSelector);
  if (!range) return;

  const applyValue = (live: boolean) => {
    const value = range.valueAsNumber;
    if (!Number.isFinite(value)) return;
    if (live) {
      if (element.dataset.liveRangeEditing !== "true") state.beginHistoryTransaction();
      element.dataset.liveRangeEditing = "true";
    } else {
      delete element.dataset.liveRangeEditing;
    }
    if (number) number.value = value.toFixed(0);
    update(value);
    if (!live) state.endHistoryTransaction();
  };

  range.addEventListener("input", () => applyValue(true));
  range.addEventListener("change", () => applyValue(false));
  range.addEventListener("blur", () => {
    if (element.dataset.liveRangeEditing === "true") applyValue(false);
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}
