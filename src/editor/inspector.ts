import type { RigState } from "../rig/rig-state";
import { getJointWorldTransform } from "../rig/geometry";
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
  const selectedFace = state.getFace(viewState.selectedFaceId);
  const selectedFaceColor = selectedFace.color ?? state.rig.defaultColor;
  const hasFaceColorOverride = selectedFace.color !== undefined;
  const faceRotation = state.getFaceRotationAngle(viewState.selectedFaceId);
  const jointWorld = joint ? getJointWorldTransform(state.rig, joint.id) : null;

  const jointMarkup = joint ? `
    <h2>관절 속성</h2>
    <div class="property-group">
      <span class="eyebrow">선택 관절</span>
      <strong class="selection-name">${escapeHtml(joint.id)}</strong>
      <dl class="coordinate-list">
        <div><dt>월드 X</dt><dd>${jointWorld!.x.toFixed(1)}</dd></div>
        <div><dt>월드 Y</dt><dd>${jointWorld!.y.toFixed(1)}</dd></div>
      </dl>
    </div>
    <label class="field-label" for="parent-joint">부모 관절</label>
    <select id="parent-joint" class="parent-select">
      <option value="">없음 (최상위)</option>
      ${state.getValidParents(joint.id).map((candidateId) => `<option value="${escapeHtml(candidateId)}"${candidateId === joint.parentJointId ? " selected" : ""}>${escapeHtml(candidateId)}</option>`).join("")}
    </select>
    <p class="hint">부모를 변경해도 현재 화면 포즈는 유지됩니다.</p>
    <label class="field-label" for="joint-radius">반지름 <output>${joint.radius.toFixed(0)}</output></label>
    <input id="joint-radius" type="range" min="8" max="80" step="1" value="${joint.radius}" />
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
        <label class="field-label" for="axis-angle">선택 축 각도 <output>${selectedAxis.angle.toFixed(0)}°</output></label>
        <input id="axis-angle" type="range" min="0" max="359" step="1" value="${selectedAxis.angle}" />
        <p class="hint">캔버스의 원형 핸들을 드래그해도 같은 축선만 회전합니다.</p>` : ""}
    </div>` : `
      <h2>관절 속성</h2>
      <div class="empty-state">
        <strong>관절을 선택하세요</strong>
        <p>원을 드래그하면 이동하고, 축선을 선택하면 해당 면의 기울기를 독립적으로 회전할 수 있습니다.</p>
      </div>`;

  element.innerHTML = `
    ${jointMarkup}
    <div class="appearance-section">
      <div class="section-heading">
        <h3>면 색상</h3>
        <span>${state.rig.faces.length}개</span>
      </div>
      <label class="color-setting-row">
        <span>전체 기본 색상</span>
        <input type="color" aria-label="전체 기본 색상" value="${escapeHtml(state.rig.defaultColor)}" data-default-color />
      </label>
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
          : `<label class="field-label" for="face-angle">회전 각도 <output>${faceRotation.toFixed(0)}°</output></label>
             <input id="face-angle" type="range" min="0" max="359" step="1" value="${faceRotation}" />
             <p class="hint">연결선을 드래그하는 것과 같은 회전 조작입니다.</p>`}
      </div>
      <div class="section-heading end-joint-heading">
        <h3>손목·발목 표시</h3>
      </div>
      <div class="visibility-list">
        ${END_JOINT_IDS.map((jointId) => {
          const endJoint = state.getJoint(jointId);
          return `<label><input type="checkbox" data-body-visible="${escapeHtml(jointId)}"${endJoint.bodyVisible ? " checked" : ""} />${escapeHtml(jointId)}</label>`;
        }).join("")}
      </div>
    </div>`;

  element.querySelector<HTMLInputElement>("#joint-radius")?.addEventListener("change", (event) => {
    if (!joint) return;
    state.setJointRadius(joint.id, Number((event.target as HTMLInputElement).value));
  });
  element.querySelector<HTMLSelectElement>("#parent-joint")?.addEventListener("change", (event) => {
    if (!joint) return;
    state.setParentJoint(joint.id, (event.target as HTMLSelectElement).value || null);
  });
  element.querySelector<HTMLInputElement>("#axis-angle")?.addEventListener("change", (event) => {
    if (!joint || !selection.axisId) return;
    state.setAxisAngle(joint.id, selection.axisId, Number((event.target as HTMLInputElement).value));
  });
  element.querySelectorAll<HTMLButtonElement>("[data-inspector-axis]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!joint) return;
      setSelection({ jointId: joint.id, axisId: button.dataset.inspectorAxis ?? null });
    });
  });
  element.querySelector<HTMLSelectElement>("[data-face-select]")?.addEventListener("change", (event) => {
    setViewState({ selectedFaceId: (event.target as HTMLSelectElement).value });
  });
  element.querySelector<HTMLInputElement>("[data-default-color]")?.addEventListener("change", (event) => {
    state.setDefaultColor((event.target as HTMLInputElement).value);
  });
  element.querySelector<HTMLInputElement>("[data-face-color]")?.addEventListener("change", (event) => {
    state.setFaceColor(viewState.selectedFaceId, (event.target as HTMLInputElement).value);
  });
  element.querySelector<HTMLInputElement>("[data-face-color-override]")?.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.checked) state.setFaceColor(viewState.selectedFaceId, selectedFaceColor);
    else state.clearFaceColor(viewState.selectedFaceId);
  });
  element.querySelector<HTMLInputElement>("#face-angle")?.addEventListener("change", (event) => {
    state.rotateFace(viewState.selectedFaceId, Number((event.target as HTMLInputElement).value));
  });
  element.querySelectorAll<HTMLInputElement>("[data-body-visible]").forEach((input) => {
    input.addEventListener("change", () => {
      const jointId = input.dataset.bodyVisible;
      if (jointId) state.setJointBodyVisible(jointId, input.checked);
    });
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
