export interface EditorSelection {
  jointId: string | null;
  axisId: string | null;
  jointIds: string[];
}

export interface EditorViewState {
  outlinesVisible: boolean;
  hideSameJointEdges: boolean;
  selectedFaceId: string;
  selectedTarget: "joint" | "face";
  inspectorTab: "selection" | "layers" | "color";
  preserveProportions: boolean;
  activeTool: "select" | "color";
  paintColor: string;
  paintPaletteId: string | null;
}
