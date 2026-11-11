import type { PolygonDraftPoint } from "../rig/rig-state.ts";

export interface EditorSelection {
  jointId: string | null;
  axisId: string | null;
  jointIds: string[];
}

export interface EditorViewState {
  outlinesVisible: boolean;
  hideSameJointEdges: boolean;
  /** Extend two adjacent faces to their boundary intersections when their shared joint is hidden. */
  extendHiddenJointFaces?: boolean;
  selectedFaceId: string;
  selectedShapeId?: string | null;
  selectedShapeIds?: string[];
  selectedShapeVertexId?: string | null;
  polygonDraft?: PolygonDraftPoint[];
  lineDraft?: PolygonDraftPoint[];
  selectedTarget: "joint" | "face";
  inspectorTab: "selection" | "layers" | "color";
  editBodyProportions: boolean;
  /** Move one selected joint while keeping its direct children in place. */
  moveSelectedIndividually: boolean;
  activeTool: "select" | "color" | "layer-order" | "polygon" | "line" | "circle" | "sphere" | "vertex-add" | "vertex-bind";
  paintColor: string;
  paintPaletteId: string | null;
}
