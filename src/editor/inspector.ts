import type { RigState } from "../rig/rig-state.ts";
import { getAxisWorldAngle, getJointWorldTransform } from "../rig/geometry.ts";
import type { EditorSelection, EditorViewState } from "./types.ts";

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
  const collapsedSections = new Set((element.dataset?.collapsedSections ?? "").split(",").filter(Boolean));
  const sectionId = viewState.inspectorTab;
  const joint = selection.jointId ? state.getJoint(selection.jointId) : null;
  const selectedOptionJoints = selection.jointIds
    .map((jointId) => state.getJoint(jointId))
    .filter((candidate) => !candidate.isVirtual);
  const allSelectedBodiesVisible = selectedOptionJoints.every((candidate) => candidate.bodyVisible);
  const someSelectedBodiesVisible = selectedOptionJoints.some((candidate) => candidate.bodyVisible);
  const allSelectedOutlinesVisible = selectedOptionJoints.every((candidate) => candidate.outlineVisible !== false);
  const someSelectedOutlinesVisible = selectedOptionJoints.some((candidate) => candidate.outlineVisible !== false);
  const allSelectedExtensionsEnabled = selectedOptionJoints.every((candidate) => candidate.faceExtensionEnabled !== false);
  const someSelectedExtensionsEnabled = selectedOptionJoints.some((candidate) => candidate.faceExtensionEnabled !== false);
  const selectedAxis = joint?.axes.find((axis) => axis.id === selection.axisId);
  const selectedAxisWorldAngle = joint && selectedAxis
    ? getAxisWorldAngle(state.rig, joint, selectedAxis)
    : null;
  const selectedAxisDisplayAngle = selectedAxisWorldAngle === null ? null : toSignedAngle(selectedAxisWorldAngle);
  const selectedFace = state.getFace(viewState.selectedFaceId);
  const selectedShape = viewState.selectedShapeId ? state.rig.artShapes?.find((shape) => shape.id === viewState.selectedShapeId) ?? null : null;
  const selectedShapeIds = (viewState.selectedShapeIds ?? (selectedShape ? [selectedShape.id] : []))
    .filter((id) => state.rig.artShapes?.some((shape) => shape.id === id));
  const selectedShapeVertex = selectedShape?.vertices.find((vertex) => vertex.id === viewState.selectedShapeVertexId) ?? null;
  const selectedCompositeMode = selectedShape?.compositeMode ?? "paint";
  const selectedCompositeGroup = selectedShape ? selectedShape.compositeGroupId ?? `composite-${selectedShape.id}` : "";
  const compositeGroups = [...new Set((state.rig.artShapes ?? []).map((shape) => shape.compositeGroupId ?? `composite-${shape.id}`))];
  const compositeGroupDefinitions = state.rig.artCompositeGroups ?? [];
  const topCompositeGroup = (groupId: string) => {
    let current = groupId;
    const visited = new Set<string>();
    while (!visited.has(current)) {
      visited.add(current);
      const parent = compositeGroupDefinitions.find((group) => group.id === current)?.parentGroupId;
      if (!parent) return current;
      current = parent;
    }
    return current;
  };
  const selectedTopCompositeGroups = [...new Set(selectedShapeIds.map((shapeId) => {
    const shape = state.rig.artShapes?.find((candidate) => candidate.id === shapeId)!;
    return topCompositeGroup(shape.compositeGroupId ?? `composite-${shape.id}`);
  }))];
  const selectedShapeIdSet = new Set(selectedShapeIds);
  const completeNestedSelection = selectedTopCompositeGroups.length >= 2
    && (state.rig.artShapes ?? []).every((shape) => !selectedTopCompositeGroups.includes(topCompositeGroup(shape.compositeGroupId ?? `composite-${shape.id}`))
      || selectedShapeIdSet.has(shape.id));
  const selectedCompositeDefinition = compositeGroupDefinitions.find((group) => group.id === selectedCompositeGroup);
  const shapeBindingOptions = state.rig.joints.flatMap((candidateJoint) => candidateJoint.axes.flatMap((axis) => (
    axis.pointSides.map((side) => ({ jointId: candidateJoint.id, axisId: axis.id, side }))
  )));
  const selectedFaceColor = selectedFace.color ?? state.rig.defaultColor;
  const hasFaceColorOverride = selectedFace.color !== undefined;
  const selectedJointColor = joint?.color ?? state.rig.defaultColor;
  const hasJointColorOverride = joint?.color !== undefined;
  const faceRotation = state.getFaceRotationAngle(viewState.selectedFaceId);
  const jointWorld = joint ? getJointWorldTransform(state.rig, joint.id) : null;
  const groupOrder = (groupId: string | undefined) => (
    groupId ? state.rig.groups.find((group) => group.id === groupId)?.order ?? 0 : 0
  );
  const elementLayers = state.rig.elementLayers ?? { joints: true, axes: true, faces: true, shapes: true };
  const jointLayerOrder = joint?.renderOrder ?? 0;
  const jointFinalOrder = joint ? groupOrder(joint.groupId) + jointLayerOrder : 0;
  const faceLayerOrder = state.getFaceLayerOrder(selectedFace.id);
  const faceFinalOrder = groupOrder(selectedFace.groupId) + faceLayerOrder;
  const shapeLayerOrder = selectedShape?.layerOrder ?? 0;
  const shapeFinalOrder = selectedShape ? groupOrder(selectedShape.groupId) + shapeLayerOrder : 0;
  const hasEarlierCompositePaint = selectedShape ? (state.rig.artShapes ?? []).some((shape) => {
    if (shape.id === selectedShape.id || (shape.compositeMode ?? "paint") !== "paint"
      || (shape.compositeGroupId ?? `composite-${shape.id}`) !== selectedCompositeGroup) return false;
    const order = groupOrder(shape.groupId) + shape.layerOrder;
    return order < shapeFinalOrder || order === shapeFinalOrder && shape.id.localeCompare(selectedShape.id) < 0;
  }) : false;
  const selectedTargetType = selectedShape ? "shape" : viewState.selectedTarget;
  const selectedTargetName = selectedShape?.id ?? (viewState.selectedTarget === "joint"
    ? joint?.id ?? "선택 없음"
    : selectedFace.id);
  const relations = joint ? [
    ...(joint.parentJointId ? [{ label: `부모 ${joint.parentJointId}`, movingId: joint.id, anchorId: joint.parentJointId }] : []),
    ...state.rig.joints.filter((candidate) => candidate.parentJointId === joint.id)
      .map((child) => ({ label: `자식 ${child.id}`, movingId: child.id, anchorId: joint.id })),
  ] : [];
  const relatedPeerGroups = joint ? state.rig.peerGroups.filter((group) => group.jointIds.length === 2
    && group.jointIds.includes(joint.id)) : [];

  const targetSummary = `
    <div class="selection-target-summary is-${selectedTargetType}">
      <span class="target-kind is-${selectedTargetType}">${selectedTargetType === "joint" ? "관절" : selectedTargetType === "face" ? "면" : "도형"}</span>
      <div><small>현재 편집 대상</small><strong>${escapeHtml(selectedTargetName)}</strong></div>
    </div>`;

  const jointMarkup = joint ? `
    <h2>관절 속성</h2>
    <div class="property-group">
      <span class="eyebrow">선택 관절</span>
      <strong class="selection-name">${escapeHtml(joint.id)}</strong>
      ${selection.jointIds.length > 1 ? `<span class="multi-selection-count">${selection.jointIds.length}개 관절 선택됨</span>` : ""}
      ${selectedOptionJoints.length ? `<div class="joint-output-options">
        <strong>선택 관절 일괄 출력</strong>
        <label class="face-override-toggle"><input type="checkbox" data-selected-joint-body${allSelectedBodiesVisible ? " checked" : ""} />관절을 그림에 표시</label>
        <label class="face-override-toggle"><input type="checkbox" data-selected-joint-outlines${allSelectedOutlinesVisible ? " checked" : ""} />관절 외곽선 표시</label>
        <label class="face-override-toggle"><input type="checkbox" data-selected-joint-extension${allSelectedExtensionsEnabled ? " checked" : ""} />숨김 관절의 연결 면 연장</label>
        <p class="hint">${selectedOptionJoints.length}개 관절에 함께 적용합니다. 관절 표시는 관절 원만 숨기며 편집 가이드와 연결 면은 유지합니다. 전역 외곽선·면 연장 스위치가 꺼져 있으면 개별 설정도 화면에 나타나지 않습니다.</p>
      </div>` : ""}
      <div class="numeric-field-grid">
        <label for="joint-world-x"><span>월드 X</span><input id="joint-world-x" type="number" step="1" value="${jointWorld!.x.toFixed(1)}" /></label>
        <label for="joint-world-y"><span>월드 Y</span><input id="joint-world-y" type="number" step="1" value="${jointWorld!.y.toFixed(1)}" /></label>
      </div>
      <div class="joint-layer-actions">
        <span>겹침 순서</span>
        <div>${renderLayerStepButtons("joint", true)}</div>
      </div>
      <button type="button" data-face-to-shape>면 데이터로 자유 도형 생성</button>
    </div>
    <label class="field-label" for="parent-joint">부모 관절</label>
    <select id="parent-joint" class="parent-select">
      <option value="">없음 (최상위)</option>
      ${state.getValidParents(joint.id).map((candidateId) => `<option value="${escapeHtml(candidateId)}"${candidateId === joint.parentJointId ? " selected" : ""}>${escapeHtml(candidateId)}</option>`).join("")}
    </select>
    <p class="hint">부모를 변경해도 현재 화면 포즈는 유지됩니다.</p>
    ${relatedPeerGroups.map((group) => {
      const distance = state.getPeerGroupDistance(group.id)!;
      const centerOffset = state.getPeerCenterOffset(group.id);
      return `
      <div class="joint-distance-section">
        <strong>${escapeHtml(group.id)} 동등 관계</strong>
        <label class="joint-distance-field"><span>관절 중심 간격<small>두 관절을 중점 기준으로 대칭 이동</small></span><input type="number" min="0" step="any" value="${distance.toFixed(2)}" data-peer-distance="${escapeHtml(group.id)}" aria-label="${escapeHtml(group.id)} 동등 관절 중심 간격" /></label>
        ${group.centerJointId ? `<p class="hint">가상 부모: ${escapeHtml(group.centerJointId)}</p>
          <div class="numeric-field-grid">
            <label><span>중심 오프셋 X</span><input type="number" step="any" value="${centerOffset!.x.toFixed(2)}" data-peer-center-offset-x="${escapeHtml(group.id)}" /></label>
            <label><span>중심 오프셋 Y</span><input type="number" step="any" value="${centerOffset!.y.toFixed(2)}" data-peer-center-offset-y="${escapeHtml(group.id)}" /></label>
          </div>
          <p class="hint">X는 두 관절을 잇는 축 방향, Y는 직교 방향입니다. 현재 포즈는 유지하고 이후 회전 중심만 옮깁니다.</p>`
          : `<button type="button" data-add-peer-center="${escapeHtml(group.id)}"${state.getJoint(group.jointIds[0]).parentJointId !== state.getJoint(group.jointIds[1]).parentJointId ? " disabled" : ""}>가상 부모 관절 추가</button><p class="hint">두 관절이 같은 부모를 가질 때 추가할 수 있습니다. 현재 포즈는 유지됩니다.</p>`}
      </div>`;
    }).join("")}
    ${relations.length ? `
      <div class="joint-distance-section">
        <div class="section-heading"><h3>관절 간 거리</h3></div>
        ${relations.map((relation) => {
          const moving = getJointWorldTransform(state.rig, relation.movingId);
          const anchor = getJointWorldTransform(state.rig, relation.anchorId);
          const distance = Math.hypot(moving.x - anchor.x, moving.y - anchor.y);
          return `<label class="joint-distance-field"><span>${escapeHtml(relation.label)}<small>${escapeHtml(relation.movingId)} 이동 · ${escapeHtml(relation.anchorId)} 고정</small></span><input type="number" min="0" step="any" value="${distance.toFixed(2)}" data-distance-moving="${escapeHtml(relation.movingId)}" data-distance-anchor="${escapeHtml(relation.anchorId)}" aria-label="${escapeHtml(relation.label)} 관절 간 거리" /></label>`;
        }).join("")}
        <p class="hint">거리를 바꾸면 이동 관절과 그 하위 관절이 함께 이동합니다. 거리가 0이면 다시 늘릴 때 오른쪽 방향을 사용합니다.</p>
      </div>` : ""}
    <label class="field-label" for="joint-radius">반지름</label>
    <div class="range-number-control">
      <input id="joint-radius" type="range" min="8" max="80" step="1" value="${joint.radius}" />
      <input id="joint-radius-number" type="number" min="8" max="80" step="1" value="${joint.radius.toFixed(0)}" aria-label="관절 반지름 숫자 입력" />
    </div>
    <div class="axis-section">
      <div class="section-heading">
        <h3>축선</h3>
        <span>${joint.axes.length}/${state.limits.maxAxesPerJoint}</span>
        <button type="button" data-add-axis${joint.axes.length >= state.limits.maxAxesPerJoint ? " disabled" : ""}>축 추가</button>
      </div>
      ${joint.axes.length === 0 ? `<p class="muted">이 관절에는 연결 축선이 없습니다.</p>` : `
        <div class="axis-tabs">
          ${joint.axes.map((axis) => `
            <button type="button" class="axis-tab ${axis.alignment ? "is-derived" : "is-editable"}${axis.id === selection.axisId ? " is-active" : ""}"
              data-inspector-axis="${escapeHtml(axis.id)}">
              <i class="axis-swatch"></i><span>${escapeHtml(axis.id)}</span><small>${axis.alignment ? "자동 고정" : "직접 회전"}</small>
            </button>`).join("")}
        </div>`}
      ${selectedAxis ? `
        <label class="field-label" for="axis-angle">선택 축 각도</label>
        <div class="range-number-control angle-control">
          <input id="axis-angle" type="range" min="-180" max="180" step="1" value="${selectedAxisDisplayAngle}"${selectedAxis.alignment ? " disabled" : ""} />
          <span><input id="axis-angle-number" type="number" min="-180" max="180" step="1" value="${selectedAxisDisplayAngle!.toFixed(0)}" aria-label="선택 축 각도 숫자 입력"${selectedAxis.alignment ? " disabled" : ""} />°</span>
        </div>
        <label class="field-label">축 끝점 길이</label>
        <input type="number" min="1" step="1" value="${(selectedAxis.length ?? joint.radius).toFixed(1)}" data-axis-length />
        <div class="axis-side-options" aria-label="활성 축 끝점">
          <label><input type="checkbox" data-axis-side="-1"${selectedAxis.pointSides.includes(-1) ? " checked" : ""} />− 끝점</label>
          <label><input type="checkbox" data-axis-side="1"${selectedAxis.pointSides.includes(1) ? " checked" : ""} />＋ 끝점</label>
        </div>
        <p class="hint">관절 반지름과 독립적으로 설정됩니다. 한쪽 끝점만 활성화하면 단일 축, 양쪽을 활성화하면 대칭 축으로 사용합니다.</p>
        <p class="hint">${selectedAxis.alignment
          ? selectedAxis.alignment === "reference-axis-outer-tangent"
            ? "이 축은 허리 축 끝점에서 고관절 원으로 이어지는 외측 접점을 자동 추적합니다."
            : `이 축은 부모 관절${selectedAxis.alignment.includes("peer") ? "과 동등 관절 중심의" : ""} 연결선과 항상 ${selectedAxis.alignment.includes("perpendicular") ? "직교" : "평행"}하도록 자동 계산됩니다.`
          : "연결 축은 관절 연결선과 직교합니다. 회전하면 연결된 하위 관절과 도형도 함께 회전합니다."}</p>` : ""}
    </div>` : `
      <h2>관절 속성</h2>
      <div class="empty-state">
        <strong>관절을 선택하세요</strong>
        <p>Shift+클릭이나 빈 공간 드래그로 여러 관절을 선택할 수 있습니다. 축선을 회전하면 연결된 하위 트리가 함께 움직입니다.</p>
      </div>`;

  const faceMarkup = `
    <h2>면 속성</h2>
    <div class="property-group">
      <span class="eyebrow">선택 면</span>
      <strong class="selection-name">${escapeHtml(selectedFace.id)}</strong>
      <div class="selection-order-summary">
        <span>그룹 ${groupOrder(selectedFace.groupId)}</span>
        <span>+</span>
        <span>면 ${faceLayerOrder}</span>
        <strong>= 최종 ${faceFinalOrder}</strong>
      </div>
      <div class="joint-layer-actions">
        <span>겹침 순서</span>
        <div>${renderLayerStepButtons("face", true)}</div>
      </div>
    </div>
    <p class="hint">면을 선택한 상태에서는 순서 변경과 색상 설정이 이 면에 적용됩니다.</p>`;

  const shapeMarkup = selectedShape ? `
    <section class="property-group art-shape-properties">
      <span class="eyebrow">${selectedShape.kind === "line" ? "두께 선분" : selectedShape.kind === "circle" ? "원 도형" : "자유 다각형"}</span><strong class="selection-name">${escapeHtml(selectedShape.id)}</strong>
      ${selectedShapeIds.length > 1 ? `<span class="multi-selection-count">${selectedShapeIds.length}개 도형 선택됨</span>` : ""}
      <p class="hint">${selectedShape.vertices.length}개 ${selectedShape.kind === "line" ? "끝점" : "꼭짓점"} · 선택 점 ${escapeHtml(selectedShapeVertex?.id ?? "없음")} · ${selectedShapeVertex ? escapeHtml(selectedShapeVertex.source) : ""}</p>
      ${selectedShapeVertex ? `
        <div class="shape-vertex-actions">
          <label><span>연결 대상</span><select data-shape-bind-target>
            ${shapeBindingOptions.map((target) => {
              const value = `${target.jointId}|${target.axisId}|${target.side}`;
              const active = selectedShapeVertex.source === "axis-point"
                && selectedShapeVertex.jointId === target.jointId
                && selectedShapeVertex.axisId === target.axisId
                && selectedShapeVertex.side === target.side;
              return `<option value="${escapeHtml(value)}"${active ? " selected" : ""}>${escapeHtml(target.jointId)} / ${escapeHtml(target.axisId)} / ${target.side < 0 ? "−" : "＋"}</option>`;
            }).join("")}
          </select></label>
          <div><button type="button" data-bind-shape-vertex${shapeBindingOptions.length ? "" : " disabled"}>위치 유지 연결</button><button type="button" data-snap-shape-vertex${shapeBindingOptions.length ? "" : " disabled"}>끝점 스냅</button></div>
          <div><button type="button" data-unbind-shape-vertex${selectedShapeVertex.source === "axis-point" ? "" : " disabled"}>연결 해제</button><button type="button" data-delete-shape-vertex${selectedShape.kind === "polygon" && selectedShape.vertices.length > 3 ? "" : " disabled"}>점 삭제</button></div>
        </div>` : ""}
      <label class="color-setting-row"><span>${selectedShape.kind === "line" ? "선 색상" : "채우기"}</span><input type="color" value="${escapeHtml(resolveInspectorColor(state, selectedShape.color, selectedShape.paletteId))}" data-shape-color /></label>
      <div class="shape-composite-settings">
        <label><span>합성 방식</span><select data-shape-composite-mode><option value="paint"${selectedCompositeMode === "paint" ? " selected" : ""}>채움·교차 (paint)</option><option value="overlay"${selectedCompositeMode === "overlay" ? " selected" : ""}>무늬 오버레이 (overlay)</option><option value="cutout"${selectedCompositeMode === "cutout" ? " selected" : ""}${selectedShape.kind === "line" ? " disabled" : ""}>제외 (cutout)</option></select></label>
        <label><span>합성 그룹</span><select data-shape-composite-group>${compositeGroups.map((group) => `<option value="${escapeHtml(group)}"${group === selectedCompositeGroup ? " selected" : ""}>${escapeHtml(group)}</option>`).join("")}</select></label>
        <button type="button" data-new-composite-group>새 합성 그룹</button>
        ${selectedShapeIds.length > 1 ? `<button type="button" data-create-composite-group>선택 도형을 한 그룹으로 묶기</button>
          <button type="button" data-create-nested-composite-group${completeNestedSelection ? "" : " disabled"}>선택 그룹을 상위 그룹으로 중첩</button>` : ""}
        ${selectedCompositeDefinition?.parentGroupId ? `<label><span>상위 합성 방식</span><select data-composite-group-mode><option value="paint"${(selectedCompositeDefinition.compositeMode ?? "paint") === "paint" ? " selected" : ""}>교차 (paint)</option><option value="overlay"${selectedCompositeDefinition.compositeMode === "overlay" ? " selected" : ""}>오버레이 (overlay)</option><option value="cutout"${selectedCompositeDefinition.compositeMode === "cutout" ? " selected" : ""}>제외 (cutout)</option></select></label>
          <p class="hint">상위 그룹 ${escapeHtml(selectedCompositeDefinition.parentGroupId)} 안에서 이 그룹 결과에 적용됩니다.</p>` : ""}
        <p class="hint">합성은 레이어 순서대로 적용합니다. 채움은 현재 영역과 교차하고, 오버레이는 현재 영역 안에 색을 올리며, 제외는 현재 결과에서 빠집니다.</p>
        ${selectedShapeIds.length > 1 && !completeNestedSelection ? `<p class="composite-warning">그룹 중첩은 서로 다른 그룹을 2개 이상 선택하고 각 그룹의 도형을 모두 선택해야 합니다.</p>` : ""}
        ${selectedCompositeMode !== "paint" && !hasEarlierCompositePaint ? `<p class="composite-warning">이 그룹에서 앞선 채움 도형이 없어 출력에서는 ${selectedCompositeMode === "overlay" ? "오버레이" : "제외"} 효과가 적용되지 않습니다.</p>` : ""}
      </div>
      ${selectedShape.kind === "line" ? `<label class="field-label">선 두께</label><input type="number" min="1" step="1" value="${selectedShape.strokeWidth ?? 16}" data-shape-stroke-width />` : ""}
      ${selectedShape.kind === "circle" ? `<div class="numeric-field-grid shape-radius-fields">
        <label><span>가로 반지름</span><input type="number" min="1" step="1" value="${selectedShape.radiusX ?? 1}" data-shape-radius-x /></label>
        <label><span>세로 반지름</span><input type="number" min="1" step="1" value="${selectedShape.radiusY ?? 1}" data-shape-radius-y /></label>
      </div>` : ""}
      <div class="joint-layer-actions"><span>겹침 순서</span><div><button type="button" data-shape-back>← 뒤로</button><button type="button" data-shape-forward>앞으로 →</button></div></div>
      <button type="button" data-delete-shape>선택 도형${selectedShapeIds.length > 1 ? ` ${selectedShapeIds.length}개` : ""} 삭제</button>
    </section>` : "";

  const selectionPanel = `
    ${targetSummary}
    ${shapeMarkup}
    ${renderPoseNavigator(state, selection, viewState.selectedFaceId, viewState.selectedTarget)}
    <label class="face-override-toggle"><input type="checkbox" data-move-selected-individually${viewState.moveSelectedIndividually ? " checked" : ""} />선택 관절만 이동</label>
    <p class="hint">목·허리처럼 부모 관절을 옮겨도 자식 관절은 현재 위치에 남깁니다. 한 관절만 선택했을 때 적용됩니다.</p>
    <label class="face-override-toggle"><input type="checkbox" data-preserve-proportions${viewState.preserveProportions ? " checked" : ""} />비율 유지</label>
    <p class="hint">선택 도구에서 Alt(Option)를 누른 채 관절을 드래그하면 일시적으로 비율을 유지합니다.</p>
    ${viewState.selectedTarget === "joint" ? jointMarkup : faceMarkup}`;

  const stackEntries = [
    ...state.rig.joints
      .filter((candidate) => candidate.bodyVisible)
      .map((candidate) => ({
        type: "joint" as const,
        id: candidate.id,
        order: groupOrder(candidate.groupId) + candidate.renderOrder,
      })),
    ...state.rig.faces.map((face) => ({
      type: "face" as const,
      id: face.id,
      order: groupOrder(face.groupId) + state.getFaceLayerOrder(face.id),
    })),
    ...(state.rig.artShapes ?? []).map((shape) => ({
      type: "shape" as const,
      id: shape.id,
      order: groupOrder(shape.groupId) + shape.layerOrder,
    })),
  ].sort((first, second) => second.order - first.order || first.id.localeCompare(second.id));

  const layerPanel = `
    <div class="layer-section is-tab-root">
      ${targetSummary}
      <div class="section-heading">
        <h2>레이어와 그룹</h2>
        <button type="button" class="add-group-button" data-add-layer-group>그룹 추가</button>
      </div>
      ${joint ? renderLayerEditorRow({
        type: "joint",
        id: joint.id,
        active: viewState.selectedTarget === "joint",
        groupOptions: renderGroupOptions(state, joint.groupId),
        groupOrder: groupOrder(joint.groupId),
        layerOrder: jointLayerOrder,
        finalOrder: jointFinalOrder,
      }) : ""}
      ${renderLayerEditorRow({
        type: "face",
        id: selectedFace.id,
        active: viewState.selectedTarget === "face",
        groupOptions: renderGroupOptions(state, selectedFace.groupId),
        groupOrder: groupOrder(selectedFace.groupId),
        layerOrder: faceLayerOrder,
        finalOrder: faceFinalOrder,
      })}
      ${selectedShape ? renderLayerEditorRow({
        type: "shape",
        id: selectedShape.id,
        active: true,
        groupOptions: renderGroupOptions(state, selectedShape.groupId),
        groupOrder: groupOrder(selectedShape.groupId),
        layerOrder: shapeLayerOrder,
        finalOrder: shapeFinalOrder,
      }) : ""}
      <div class="element-layer-groups">
        <section class="element-layer-group">
          <div class="section-heading"><label class="element-layer-toggle"><input type="checkbox" data-element-layer="joints"${elementLayers.joints ? " checked" : ""} /><strong>관절 레이어</strong></label><span>${state.rig.joints.filter((item) => !item.isVirtual).length}</span></div>
          ${state.rig.joints.filter((item) => !item.isVirtual).map((item) => `<div class="element-layer-item"><button type="button" data-stack-joint="${escapeHtml(item.id)}">${escapeHtml(item.id)}</button><small>${groupOrder(item.groupId) + item.renderOrder}</small></div>`).join("")}
        </section>
        <section class="element-layer-group">
          <div class="section-heading"><label class="element-layer-toggle"><input type="checkbox" data-element-layer="axes"${elementLayers.axes ? " checked" : ""} /><strong>축 가이드 레이어</strong></label><span>${state.rig.joints.reduce((count, item) => count + item.axes.length, 0)}</span></div>
          ${state.rig.joints.flatMap((item) => item.axes.map((axis) => `<div class="element-layer-item"><button type="button" data-stack-axis data-axis-joint-id="${escapeHtml(item.id)}" data-axis-id="${escapeHtml(axis.id)}">${escapeHtml(item.id)} / ${escapeHtml(axis.id)}</button></div>`)).join("")}
        </section>
        <section class="element-layer-group">
          <div class="section-heading"><label class="element-layer-toggle"><input type="checkbox" data-element-layer="faces"${elementLayers.faces ? " checked" : ""} /><strong>연결 면 레이어</strong></label><span>${state.rig.faces.length}</span></div>
          ${state.rig.faces.map((item) => `<div class="element-layer-item"><button type="button" data-stack-face="${escapeHtml(item.id)}">${escapeHtml(item.id)}</button><small>${groupOrder(item.groupId) + state.getFaceLayerOrder(item.id)}</small></div>`).join("")}
        </section>
        <section class="element-layer-group">
          <div class="section-heading"><label class="element-layer-toggle"><input type="checkbox" data-element-layer="shapes"${elementLayers.shapes ? " checked" : ""} /><strong>도형 레이어</strong></label><span>${state.rig.artShapes?.length ?? 0}</span></div>
          ${(state.rig.artShapes ?? []).map((item) => `<div class="element-layer-item"><button type="button" data-stack-shape="${escapeHtml(item.id)}">${escapeHtml(item.id)}</button><small>${groupOrder(item.groupId) + item.layerOrder}</small></div>`).join("") || `<p class="hint">추가된 도형이 없습니다.</p>`}
        </section>
      </div>
      <div class="render-stack-section">
        <div class="section-heading"><h3>통합 출력 순서</h3><span>앞 → 뒤</span></div>
        <div class="render-stack-list">
          ${stackEntries.map((entry) => {
            const active = entry.type === "shape" ? selectedShapeIds.includes(entry.id)
              : entry.type === viewState.selectedTarget
                && (entry.type === "joint" ? entry.id === joint?.id : entry.id === selectedFace.id);
            const label = entry.type === "joint" ? "관절" : entry.type === "face" ? "면" : "도형";
            return `<button type="button" class="render-stack-item${active ? " is-active" : ""}" data-stack-${entry.type}="${escapeHtml(entry.id)}">
              <span class="target-kind is-${entry.type}">${label}</span>
              <strong>${escapeHtml(entry.id)}</strong>
              <small>최종 ${entry.order}</small>
            </button>`;
          }).join("")}
        </div>
      </div>
      ${state.rig.groups.length > 0 ? `
        <div class="group-visibility-list">
          ${[...state.rig.groups].sort((a, b) => b.order - a.order || b.id.localeCompare(a.id)).map((group) => `
            <div class="group-order-row">
              <label><input type="checkbox" data-layer-group-visible="${escapeHtml(group.id)}"${group.visible ? " checked" : ""} />${escapeHtml(group.name)}</label>
              <input type="number" min="-999" max="999" step="any" value="${group.order}" data-layer-group-order="${escapeHtml(group.id)}" aria-label="${escapeHtml(group.name)} 그룹 렌더 순서" />
              <button type="button" data-move-group-back="${escapeHtml(group.id)}" aria-label="${escapeHtml(group.name)} 그룹 뒤로" title="뒤로 한 단계 · Shift: 맨 뒤">←</button>
              <button type="button" data-move-group-forward="${escapeHtml(group.id)}" aria-label="${escapeHtml(group.name)} 그룹 앞으로" title="앞으로 한 단계 · Shift: 맨 앞">→</button>
              <button type="button" data-select-layer-group="${escapeHtml(group.id)}">선택</button>
            </div>
          `).join("")}
        </div>` : `<p class="hint">그룹을 추가하면 여러 관절과 면의 표시를 함께 전환할 수 있습니다.</p>`}
      <p class="hint">그룹 화살표는 한 단계씩 이동하며 Shift를 누르면 맨 앞이나 뒤로 이동합니다. 그룹 순서와 관절·면의 레이어 값을 합산하므로, 그룹 순서가 앞이어도 개별 레이어 값에 따라 항목이 겹칠 수 있습니다.</p>
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
               <input id="face-angle" type="range" min="-180" max="180" step="1" value="${toSignedAngle(faceRotation)}" />
               <span><input id="face-angle-number" type="number" min="-180" max="180" step="1" value="${toSignedAngle(faceRotation).toFixed(0)}" aria-label="선택 면 회전 각도 숫자 입력" />°</span>
             </div>
             <p class="hint">연결선을 드래그하는 것과 같은 회전 조작입니다.</p>`}
      </div>
    </div>`;

  element.innerHTML = `
    <div class="inspector-tabs" role="tablist" aria-label="속성 패널">
      <button type="button" data-inspector-tab="selection" class="${viewState.inspectorTab === "selection" ? "is-active" : ""}">선택</button>
      <button type="button" data-inspector-tab="layers" class="${viewState.inspectorTab === "layers" ? "is-active" : ""}">레이어</button>
      <button type="button" data-inspector-tab="color" class="${viewState.inspectorTab === "color" ? "is-active" : ""}">색상</button>
    </div>
    <div class="inspector-panel">
      <details class="inspector-details" data-inspector-details="${sectionId}"${collapsedSections.has(sectionId) ? "" : " open"}>
        <summary>${sectionId === "selection" ? "선택 상세" : sectionId === "layers" ? "레이어 상세" : "색상 상세"}</summary>
        <div class="inspector-details-content">
          ${viewState.inspectorTab === "selection" ? selectionPanel : viewState.inspectorTab === "layers" ? layerPanel : colorPanel}
        </div>
      </details>
    </div>`;

  const bodyOption = element.querySelector<HTMLInputElement>("[data-selected-joint-body]");
  if (bodyOption) bodyOption.indeterminate = someSelectedBodiesVisible && !allSelectedBodiesVisible;
  const outlineOption = element.querySelector<HTMLInputElement>("[data-selected-joint-outlines]");
  if (outlineOption) outlineOption.indeterminate = someSelectedOutlinesVisible && !allSelectedOutlinesVisible;
  const extensionOption = element.querySelector<HTMLInputElement>("[data-selected-joint-extension]");
  if (extensionOption) extensionOption.indeterminate = someSelectedExtensionsEnabled && !allSelectedExtensionsEnabled;

  element.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const inspectorTab = button.dataset.inspectorTab as EditorViewState["inspectorTab"];
      setViewState({ inspectorTab });
    });
  });
  element.querySelectorAll<HTMLDetailsElement>("[data-inspector-details]").forEach((details) => {
    details.addEventListener("toggle", () => {
      const id = details.dataset.inspectorDetails;
      if (!id) return;
      const next = new Set((element.dataset?.collapsedSections ?? "").split(",").filter(Boolean));
      if (details.open) next.delete(id);
      else next.add(id);
      if (element.dataset) element.dataset.collapsedSections = [...next].join(",");
    });
  });
  element.querySelector<HTMLInputElement>("[data-preserve-proportions]")?.addEventListener("change", (event) => {
    setViewState({ preserveProportions: (event.target as HTMLInputElement).checked });
  });
  element.querySelector<HTMLInputElement>("[data-move-selected-individually]")?.addEventListener("change", (event) => {
    setViewState({ moveSelectedIndividually: (event.target as HTMLInputElement).checked });
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
  element.querySelector<HTMLInputElement>("[data-axis-length]")?.addEventListener("change", (event) => {
    if (joint && selectedAxis) state.setAxisLength(joint.id, selectedAxis.id, (event.target as HTMLInputElement).valueAsNumber);
  });
  element.querySelector<HTMLButtonElement>("[data-add-axis]")?.addEventListener("click", () => {
    if (!joint) return;
    const axisId = state.addAxis(joint.id);
    setSelection({ jointId: joint.id, axisId, jointIds: selection.jointIds.includes(joint.id) ? selection.jointIds : [joint.id] });
  });
  element.querySelectorAll<HTMLInputElement>("[data-axis-side]").forEach((input) => {
    input.addEventListener("change", () => {
      if (!joint || !selectedAxis) return;
      const sides = [...element.querySelectorAll<HTMLInputElement>("[data-axis-side]:checked")]
        .map((candidate) => Number(candidate.dataset.axisSide))
        .filter((side): side is -1 | 1 => side === -1 || side === 1);
      try {
        state.setAxisPointSides(joint.id, selectedAxis.id, sides);
      } catch (error) {
        input.checked = !input.checked;
        input.setCustomValidity(error instanceof Error ? error.message : "축 끝점을 변경할 수 없습니다.");
        input.reportValidity();
        input.setCustomValidity("");
      }
    });
  });
  element.querySelector<HTMLInputElement>("[data-shape-color]")?.addEventListener("change", (event) => {
    if (selectedShape) state.paintArtShapeWithColor(selectedShape.id, (event.target as HTMLInputElement).value);
  });
  element.querySelector<HTMLInputElement>("[data-shape-stroke-width]")?.addEventListener("change", (event) => {
    if (selectedShape) state.setArtShapeStrokeWidth(selectedShape.id, (event.target as HTMLInputElement).valueAsNumber);
  });
  const radiusXInput = element.querySelector<HTMLInputElement>("[data-shape-radius-x]");
  const radiusYInput = element.querySelector<HTMLInputElement>("[data-shape-radius-y]");
  const applyCircleRadii = () => {
    if (selectedShape && radiusXInput && radiusYInput) {
      state.setArtShapeCircleRadii(selectedShape.id, radiusXInput.valueAsNumber, radiusYInput.valueAsNumber);
    }
  };
  radiusXInput?.addEventListener("change", applyCircleRadii);
  radiusYInput?.addEventListener("change", applyCircleRadii);
  element.querySelector<HTMLSelectElement>("[data-shape-composite-mode]")?.addEventListener("change", (event) => {
    if (!selectedShape) return;
    const mode = (event.target as HTMLSelectElement).value;
    state.setArtShapeComposite(selectedShape.id, mode === "cutout" ? "cutout" : mode === "overlay" ? "overlay" : "paint", selectedCompositeGroup);
  });
  element.querySelector<HTMLSelectElement>("[data-shape-composite-group]")?.addEventListener("change", (event) => {
    if (!selectedShape) return;
    state.setArtShapeComposite(selectedShape.id, selectedCompositeMode, (event.target as HTMLSelectElement).value);
  });
  element.querySelector<HTMLButtonElement>("[data-new-composite-group]")?.addEventListener("click", () => {
    if (!selectedShape) return;
    const name = window.prompt("새 합성 그룹 이름", `composite-${selectedShape.id}`);
    if (name?.trim()) state.setArtShapeComposite(selectedShape.id, selectedCompositeMode, name);
  });
  element.querySelector<HTMLButtonElement>("[data-create-composite-group]")?.addEventListener("click", () => {
    state.createArtShapeCompositeGroup(selectedShapeIds);
    setViewState({ selectedShapeIds, inspectorTab: "selection" });
  });
  element.querySelector<HTMLButtonElement>("[data-create-nested-composite-group]")?.addEventListener("click", () => {
    state.createNestedArtCompositeGroup(selectedShapeIds);
    setViewState({ selectedShapeIds, inspectorTab: "selection" });
  });
  element.querySelector<HTMLSelectElement>("[data-composite-group-mode]")?.addEventListener("change", (event) => {
    if (!selectedCompositeDefinition) return;
    const mode = (event.target as HTMLSelectElement).value;
    state.setArtCompositeGroupMode(selectedCompositeDefinition.id,
      mode === "cutout" ? "cutout" : mode === "overlay" ? "overlay" : "paint");
  });
  element.querySelector<HTMLButtonElement>("[data-face-to-shape]")?.addEventListener("click", () => {
    const shapeId = state.addArtShapeFromFace(selectedFace.id);
    setViewState({ selectedShapeId: shapeId, selectedShapeVertexId: null, inspectorTab: "selection" });
  });
  element.querySelector<HTMLButtonElement>("[data-shape-back]")?.addEventListener("click", () => {
    if (selectedShape) state.moveBodyItemInStack("shape", selectedShape.id, -1, false);
  });
  element.querySelector<HTMLButtonElement>("[data-shape-forward]")?.addEventListener("click", () => {
    if (selectedShape) state.moveBodyItemInStack("shape", selectedShape.id, 1, false);
  });
  element.querySelector<HTMLButtonElement>("[data-delete-shape]")?.addEventListener("click", () => {
    if (!selectedShapeIds.length) return;
    state.removeArtShapes(selectedShapeIds);
    setViewState({ selectedShapeId: null, selectedShapeIds: [], selectedShapeVertexId: null });
  });
  const readShapeBindingTarget = () => {
    const value = element.querySelector<HTMLSelectElement>("[data-shape-bind-target]")?.value;
    if (!value) return null;
    const [jointId, axisId, rawSide] = value.split("|");
    const side = Number(rawSide);
    return jointId && axisId && (side === -1 || side === 1) ? { jointId, axisId, side: side as -1 | 1 } : null;
  };
  element.querySelector<HTMLButtonElement>("[data-bind-shape-vertex]")?.addEventListener("click", () => {
    const target = readShapeBindingTarget();
    if (selectedShape && selectedShapeVertex && target) {
      state.bindArtShapeVertexToAxis(selectedShape.id, selectedShapeVertex.id, target.jointId, target.axisId, target.side, false);
    }
  });
  element.querySelector<HTMLButtonElement>("[data-snap-shape-vertex]")?.addEventListener("click", () => {
    const target = readShapeBindingTarget();
    if (selectedShape && selectedShapeVertex && target) {
      state.bindArtShapeVertexToAxis(selectedShape.id, selectedShapeVertex.id, target.jointId, target.axisId, target.side, true);
    }
  });
  element.querySelector<HTMLButtonElement>("[data-unbind-shape-vertex]")?.addEventListener("click", () => {
    if (selectedShape && selectedShapeVertex) state.unbindArtShapeVertex(selectedShape.id, selectedShapeVertex.id);
  });
  element.querySelector<HTMLButtonElement>("[data-delete-shape-vertex]")?.addEventListener("click", () => {
    if (!selectedShape || !selectedShapeVertex) return;
    const nextVertexId = state.removeArtShapeVertex(selectedShape.id, selectedShapeVertex.id);
    setViewState({ selectedShapeVertexId: nextVertexId });
  });
  element.querySelectorAll<HTMLButtonElement>("[data-add-peer-center]").forEach((button) => {
    button.addEventListener("click", () => {
      const groupId = button.dataset.addPeerCenter;
      if (groupId) state.addPeerCenter(groupId);
    });
  });
  element.querySelectorAll<HTMLInputElement>("[data-peer-distance]").forEach((input) => {
    input.addEventListener("change", () => {
      const groupId = input.dataset.peerDistance;
      if (!groupId) return;
      state.setPeerGroupDistance(groupId, input.valueAsNumber);
    });
  });
  element.querySelectorAll<HTMLInputElement>("[data-peer-center-offset-x], [data-peer-center-offset-y]").forEach((input) => {
    input.addEventListener("change", () => {
      const groupId = input.dataset.peerCenterOffsetX ?? input.dataset.peerCenterOffsetY;
      if (!groupId) return;
      const xInput = [...element.querySelectorAll<HTMLInputElement>("[data-peer-center-offset-x]")]
        .find((candidate) => candidate.dataset.peerCenterOffsetX === groupId);
      const yInput = [...element.querySelectorAll<HTMLInputElement>("[data-peer-center-offset-y]")]
        .find((candidate) => candidate.dataset.peerCenterOffsetY === groupId);
      if (xInput && yInput) state.setPeerCenterOffset(groupId, xInput.valueAsNumber, yInput.valueAsNumber);
    });
  });
  element.querySelector<HTMLSelectElement>("[data-face-shortcut]")?.addEventListener("change", (event) => {
    setViewState({ selectedFaceId: (event.target as HTMLSelectElement).value, selectedTarget: "face", selectedShapeId: null, selectedShapeVertexId: null });
  });

  bindLiveRange(element, state, "#joint-radius", "#joint-radius-number", (value) => {
    if (joint) state.setJointRadius(joint.id, value);
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
  bindLayerStepActions(element, "joint", (direction) => {
    state.moveJointsInLayerStack(selection.jointIds, direction);
  });
  element.querySelector<HTMLSelectElement>("#parent-joint")?.addEventListener("change", (event) => {
    if (!joint) return;
    state.setParentJoint(joint.id, (event.target as HTMLSelectElement).value || null);
  });
  element.querySelectorAll<HTMLInputElement>("[data-distance-moving]").forEach((input) => {
    input.addEventListener("change", () => {
      const movingId = input.dataset.distanceMoving;
      const anchorId = input.dataset.distanceAnchor;
      if (!movingId || !anchorId) return;
      const distance = input.valueAsNumber;
      if (Number.isFinite(distance) && distance >= 0) state.setJointDistance(movingId, anchorId, distance);
      const moving = getJointWorldTransform(state.rig, movingId);
      const anchor = getJointWorldTransform(state.rig, anchorId);
      input.value = Math.hypot(moving.x - anchor.x, moving.y - anchor.y).toFixed(2);
    });
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
    setViewState({ selectedFaceId: (event.target as HTMLSelectElement).value, selectedTarget: "face", selectedShapeId: null, selectedShapeVertexId: null });
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
  bodyOption?.addEventListener("change", () => {
    state.setJointsBodyVisible(selectedOptionJoints.map((candidate) => candidate.id), bodyOption.checked);
  });
  outlineOption?.addEventListener("change", () => {
    state.setJointsOutlineVisible(selectedOptionJoints.map((candidate) => candidate.id), outlineOption.checked);
  });
  extensionOption?.addEventListener("change", () => {
    state.setJointsFaceExtensionEnabled(selectedOptionJoints.map((candidate) => candidate.id), extensionOption.checked);
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
  element.querySelector<HTMLSelectElement>("[data-shape-group]")?.addEventListener("change", (event) => {
    if (selectedShape) state.setArtShapeGroup(selectedShape.id, (event.target as HTMLSelectElement).value || null);
  });
  element.querySelector<HTMLInputElement>("[data-joint-layer]")?.addEventListener("change", (event) => {
    if (!joint) return;
    state.setJointRenderOrder(joint.id, (event.target as HTMLInputElement).valueAsNumber);
  });
  element.querySelector<HTMLInputElement>("[data-face-layer]")?.addEventListener("change", (event) => {
    state.setFaceLayerOrder(selectedFace.id, (event.target as HTMLInputElement).valueAsNumber);
  });
  element.querySelector<HTMLInputElement>("[data-shape-layer]")?.addEventListener("change", (event) => {
    if (selectedShape) state.setArtShapeLayerOrder(selectedShape.id, (event.target as HTMLInputElement).valueAsNumber);
  });
  bindLayerStepActions(element, "face", (direction) => {
    state.moveFaceInLayerStack(selectedFace.id, direction);
  });
  bindLayerStepActions(element, "shape", (direction) => {
    if (selectedShape) state.moveBodyItemInStack("shape", selectedShape.id, direction, false);
  });
  element.querySelectorAll<HTMLInputElement>("[data-element-layer]").forEach((input) => {
    input.addEventListener("change", () => {
      const layer = input.dataset.elementLayer;
      if (layer === "joints" || layer === "axes" || layer === "faces" || layer === "shapes") {
        state.setElementLayerVisibility(layer, input.checked);
      }
    });
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
  element.querySelectorAll<HTMLButtonElement>("[data-move-group-back], [data-move-group-forward]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const groupId = button.dataset.moveGroupBack ?? button.dataset.moveGroupForward;
      if (groupId) state.moveLayerGroupInStack(groupId, button.dataset.moveGroupBack ? -1 : 1, event.shiftKey);
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
  element.querySelectorAll<HTMLButtonElement>("[data-stack-joint]").forEach((button) => {
    button.addEventListener("click", () => {
      const jointId = button.dataset.stackJoint;
      if (!jointId) return;
      setSelection({
        jointId,
        axisId: state.getJoint(jointId).axes[0]?.id ?? null,
        jointIds: [jointId],
      });
    });
  });
  element.querySelectorAll<HTMLButtonElement>("[data-stack-face]").forEach((button) => {
    button.addEventListener("click", () => {
      const faceId = button.dataset.stackFace;
      if (faceId) setViewState({ selectedFaceId: faceId, selectedTarget: "face", selectedShapeId: null, selectedShapeVertexId: null });
    });
  });
  element.querySelectorAll<HTMLButtonElement>("[data-stack-shape]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const shapeId = button.dataset.stackShape;
      if (!shapeId) return;
      const selected = new Set(viewState.selectedShapeIds ?? []);
      if (event.shiftKey && selected.has(shapeId)) selected.delete(shapeId);
      else {
        if (!event.shiftKey) selected.clear();
        selected.add(shapeId);
      }
      const selectedShapeIds = [...selected];
      setViewState({ selectedShapeId: selected.has(shapeId) ? shapeId : selectedShapeIds.at(-1) ?? null,
        selectedShapeIds, selectedShapeVertexId: null, inspectorTab: "layers" });
    });
  });
  element.querySelectorAll<HTMLButtonElement>("[data-stack-axis]").forEach((button) => {
    button.addEventListener("click", () => {
      const jointId = button.dataset.axisJointId;
      const axisId = button.dataset.axisId;
      if (jointId && axisId) setSelection({ jointId, axisId, jointIds: [jointId] });
    });
  });
}

type LayerTarget = "joint" | "face" | "shape";

interface LayerEditorRowOptions {
  type: LayerTarget;
  id: string;
  active: boolean;
  groupOptions: string;
  groupOrder: number;
  layerOrder: number;
  finalOrder: number;
}

function renderLayerEditorRow(options: LayerEditorRowOptions): string {
  const { type, id, active, groupOptions, groupOrder, layerOrder, finalOrder } = options;
  const label = type === "joint" ? "관절" : type === "face" ? "면" : "도형";
  return `
    <div class="layer-editor-row${active ? " is-active-target" : ""}">
      <div class="layer-editor-heading"><span class="target-kind is-${type}">${label}</span><strong>${escapeHtml(id)}</strong>${active ? "<em>현재 선택</em>" : ""}</div>
      <select aria-label="선택 ${label} 그룹" data-${type}-group>${groupOptions}</select>
      <label>레이어 <input type="number" min="-999" max="999" step="1" value="${layerOrder}" data-${type}-layer /></label>
      <div class="layer-order-equation"><span>그룹 ${groupOrder}</span><b>+</b><span>${label} ${layerOrder}</span><strong>= 최종 ${finalOrder}</strong></div>
      <div class="layer-item-actions">${renderLayerStepButtons(type)}</div>
    </div>`;
}

function renderLayerStepButtons(type: LayerTarget, withShortcuts = false): string {
  const label = type === "joint" ? "관절" : type === "face" ? "면" : "도형";
  const backShortcut = withShortcuts ? " ([)" : "";
  const forwardShortcut = withShortcuts ? " (])" : "";
  return `
    <button type="button" data-send-${type}-back title="선택 ${label}을 뒤로${backShortcut}">← 뒤로</button>
    <button type="button" data-bring-${type}-forward title="선택 ${label}을 앞으로${forwardShortcut}">앞으로 →</button>`;
}

function bindLayerStepActions(
  element: HTMLElement,
  type: LayerTarget,
  move: (direction: -1 | 1) => void,
): void {
  element.querySelectorAll<HTMLButtonElement>(`[data-send-${type}-back]`)
    .forEach((button) => button.addEventListener("click", () => move(-1)));
  element.querySelectorAll<HTMLButtonElement>(`[data-bring-${type}-forward]`)
    .forEach((button) => button.addEventListener("click", () => move(1)));
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
  selectedTarget: EditorViewState["selectedTarget"],
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
          ${points.map(([id, x, y]) => `<button type="button" class="pose-shortcut${selectedTarget === "joint" && selection.jointIds.includes(id) ? " is-selected" : ""}" style="--x:${x}px;--y:${y}px" data-joint-shortcut="${id}" aria-label="${id} 관절 선택" title="${id}"></button>`).join("")}
        </div>
        <div class="pose-picker-current">
          <span class="eyebrow">CURRENT</span>
          <strong>${selectedTarget === "joint" ? `관절: ${escapeHtml(selection.jointId ?? "선택 없음")}` : `면: ${escapeHtml(selectedFaceId)}`}</strong>
          <select class="pose-face-shortcut${selectedTarget === "face" ? " is-selected" : ""}" data-face-shortcut aria-label="면 선택">
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

function toSignedAngle(angle: number): number {
  const normalized = ((angle % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
}

function resolveInspectorColor(state: RigState, color?: string, paletteId?: string): string {
  return color ?? state.rig.palette.find((entry) => entry.id === paletteId)?.color ?? state.rig.defaultColor;
}
