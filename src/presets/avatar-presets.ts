import type { RigState } from "../rig/rig-state.ts";

export type AvatarPresetId =
  | "large"
  | "male-standard"
  | "male-slim"
  | "female"
  | "female-trapezoid"
  | "neutral-straight"
  | "child-neutral";

/** New documents are constructed directly from this preset. */
export const DEFAULT_AVATAR_PRESET_ID: AvatarPresetId = "neutral-straight";

export interface AvatarProportionPreset {
  id: AvatarPresetId;
  name: string;
  description: string;
  rootY: number;
  shoulderDistance: number;
  shoulderFlatLength: number;
  waistRadius: number;
  hipDistance: number;
  armRadius: number;
  hipRadius: number;
  kneeRadius: number;
  chestDistance: number;
  headDistance: number;
  armSegmentLength: number;
  upperLegLength: number;
  lowerLegLength: number;
  /** Absolute joint depths used to preserve this body type's side silhouette. */
  depthProfile: {
    chest: number;
    waist: number;
    pelvis: number;
    hip: number;
    knee: number;
    ankle: number;
  };
}

const ADULT_LENGTHS = {
  rootY: 320,
  chestDistance: 96,
  headDistance: 84,
  armSegmentLength: 96,
  upperLegLength: 120,
  lowerLegLength: 150,
} as const;

export const AVATAR_PROPORTION_PRESETS: readonly AvatarProportionPreset[] = [
  { id: "large", name: "대형", description: "넓어진 어깨와 큰 체격", ...ADULT_LENGTHS,
    shoulderDistance: 168, shoulderFlatLength: 12, waistRadius: 48, hipDistance: 62.4, armRadius: 24, hipRadius: 30, kneeRadius: 27,
    depthProfile: { chest: 0, waist: 5, pelvis: -7, hip: -12, knee: 3, ankle: -1 } },
  { id: "male-standard", name: "일반 남성체", description: "표준 균형형", ...ADULT_LENGTHS,
    shoulderDistance: 150, shoulderFlatLength: 10.5, waistRadius: 42, hipDistance: 63, armRadius: 21, hipRadius: 28.5, kneeRadius: 25.5,
    depthProfile: { chest: 0, waist: 4, pelvis: -6, hip: -10, knee: 2, ankle: -1 } },
  { id: "male-slim", name: "슬림 남성체", description: "기본 여성체와 같은 인물의 남성형", ...ADULT_LENGTHS,
    shoulderDistance: 150, shoulderFlatLength: 9.75, waistRadius: 39, hipDistance: 66, armRadius: 19.5, hipRadius: 28.5, kneeRadius: 24.5,
    depthProfile: { chest: 0, waist: 5, pelvis: -5, hip: -9, knee: 3, ankle: -1 } },
  { id: "female", name: "기본 여성체", description: "슬림 남성체와 같은 인물의 여성형", ...ADULT_LENGTHS,
    shoulderDistance: 132, shoulderFlatLength: 9.75, waistRadius: 36, hipDistance: 84, armRadius: 19.5, hipRadius: 28.5, kneeRadius: 24,
    depthProfile: { chest: 0, waist: 6, pelvis: -8, hip: -14, knee: 3, ankle: -1 } },
  { id: "female-trapezoid", name: "사다리꼴 여성체", description: "고관절에서 무릎까지 점진 축소", ...ADULT_LENGTHS,
    shoulderDistance: 132, shoulderFlatLength: 10.5, waistRadius: 36, hipDistance: 79.2, armRadius: 21, hipRadius: 38.4, kneeRadius: 27,
    depthProfile: { chest: 0, waist: 6, pelvis: -10, hip: -18, knee: 4, ankle: -1 } },
  { id: "neutral-straight", name: "직선형 기본체", description: "굴곡이 적은 기본 픽토그램형", ...ADULT_LENGTHS,
    shoulderDistance: 120, shoulderFlatLength: 30, waistRadius: 60, hipDistance: 60, armRadius: 30, hipRadius: 30, kneeRadius: 30,
    depthProfile: { chest: 0, waist: 0, pelvis: 0, hip: 0, knee: 0, ankle: 0 } },
  { id: "child-neutral", name: "아동체", description: "성별 구분 없는 4등신", rootY: 422,
    shoulderDistance: 108, shoulderFlatLength: 9, waistRadius: 42, hipDistance: 50.4, armRadius: 18, hipRadius: 24, kneeRadius: 21,
    chestDistance: 84, headDistance: 78, armSegmentLength: 69, upperLegLength: 78, lowerLegLength: 96,
    depthProfile: { chest: 0, waist: 2, pelvis: -3, hip: -5, knee: 1, ankle: 0 } },
];

export function getAvatarProportionPreset(id: string): AvatarProportionPreset | null {
  return AVATAR_PROPORTION_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** Apply dimensions while preserving the current connection directions, rotations, pivot offsets, and colors. */
export function applyAvatarProportionPreset(state: RigState, presetId: AvatarPresetId): void {
  const preset = getAvatarProportionPreset(presetId);
  if (!preset) return;
  state.beginHistoryTransaction();
  try {
    setDistance(state, "pelvis-pivot", "scene-root", 60);
    setDistance(state, "waist", "pelvis-pivot", 60);
    state.moveJoint("scene-root", 300, preset.rootY);
    setDistance(state, "chest", "waist", preset.chestDistance);
    setDistance(state, "head", "chest", preset.headDistance);
    state.setPeerGroupDistance("shoulder-band", preset.shoulderDistance);
    state.setPeerGroupDistance("hip-band", preset.hipDistance);

    for (const side of ["left", "right"] as const) {
      setDistance(state, `${side}-elbow`, `${side}-shoulder`, preset.armSegmentLength);
      setDistance(state, `${side}-wrist`, `${side}-elbow`, preset.armSegmentLength);
      setDistance(state, `${side}-knee`, `${side}-hip`, preset.upperLegLength);
      setDistance(state, `${side}-ankle`, `${side}-knee`, preset.lowerLegLength);
    }

    state.setJointRadius("head", 18);
    state.setJointRadius("chest", 18);
    // The waist joint radius is the capsule's side-visible thickness. Preserve
    // the authored front half-width by assigning the remaining span to X.
    state.setJointRadius("waist", preset.armRadius);
    for (const axis of ["x", "y", "z"] as const) state.setJointSurfaceScale("waist", axis, 1);
    state.setJointCapsuleFlatAxis("waist", "x", true);
    state.setJointCapsuleFlatLength("waist", "x", Math.max(0, (preset.waistRadius - preset.armRadius) * 2));
    for (const side of ["left", "right"] as const) {
      for (const part of ["shoulder", "elbow", "wrist"] as const) {
        state.setJointRadius(`${side}-${part}`, preset.armRadius);
      }
      state.setJointCapsuleFlatAxis(`${side}-shoulder`, "x", true);
      state.setJointCapsuleFlatLength(`${side}-shoulder`, "x", preset.shoulderFlatLength);
      state.setJointRadius(`${side}-hip`, preset.hipRadius);
      state.setJointRadius(`${side}-knee`, preset.kneeRadius);
      state.setJointRadius(`${side}-ankle`, preset.kneeRadius);
    }
    applyDepthProfile(state, preset);
    const head = state.getJoint("head");
    state.applyJointProportions("head", { x: head.x, y: head.y, radius: 18 });
  } finally {
    state.endHistoryTransaction();
  }
}

function applyDepthProfile(state: RigState, preset: AvatarProportionPreset): void {
  const depth = preset.depthProfile;
  const assignments: Array<[string, number]> = [
    ["scene-root", 0],
    ["pelvis-pivot", depth.pelvis],
    ["waist", depth.waist],
    ["chest", depth.chest],
    ["head", depth.chest],
    ["left-shoulder", depth.chest], ["right-shoulder", depth.chest],
    ["left-elbow", depth.chest], ["right-elbow", depth.chest],
    ["left-wrist", depth.chest], ["right-wrist", depth.chest],
    ["left-hip", depth.hip], ["right-hip", depth.hip],
    ["left-knee", depth.knee], ["right-knee", depth.knee],
    ["left-ankle", depth.ankle], ["right-ankle", depth.ankle],
  ];
  for (const [jointId, z] of assignments) state.setJointZ(jointId, z);
}

function setDistance(state: RigState, movingId: string, anchorId: string, distance: number): void {
  state.setJointBaseDistance(movingId, distance);
}
