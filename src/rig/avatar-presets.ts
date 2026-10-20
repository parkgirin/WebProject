import type { RigState } from "./rig-state.ts";

export type AvatarPresetId =
  | "large"
  | "male-standard"
  | "male-slim"
  | "female"
  | "female-trapezoid"
  | "neutral-straight"
  | "child-neutral";

export interface AvatarProportionPreset {
  id: AvatarPresetId;
  name: string;
  description: string;
  rootY: number;
  shoulderDistance: number;
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
    shoulderDistance: 168, waistRadius: 48, hipDistance: 62.4, armRadius: 24, hipRadius: 30, kneeRadius: 30 },
  { id: "male-standard", name: "일반 남성체", description: "표준 균형형", ...ADULT_LENGTHS,
    shoulderDistance: 150, waistRadius: 42, hipDistance: 63, armRadius: 21, hipRadius: 28.5, kneeRadius: 28.5 },
  { id: "male-slim", name: "슬림 남성체", description: "기본 여성체와 같은 인물의 남성형", ...ADULT_LENGTHS,
    shoulderDistance: 150, waistRadius: 39, hipDistance: 66, armRadius: 19.5, hipRadius: 28.5, kneeRadius: 28.5 },
  { id: "female", name: "기본 여성체", description: "슬림 남성체와 같은 인물의 여성형", ...ADULT_LENGTHS,
    shoulderDistance: 132, waistRadius: 36, hipDistance: 84, armRadius: 19.5, hipRadius: 28.5, kneeRadius: 28.5 },
  { id: "female-trapezoid", name: "사다리꼴 여성체", description: "고관절에서 무릎까지 점진 축소", ...ADULT_LENGTHS,
    shoulderDistance: 132, waistRadius: 36, hipDistance: 79.2, armRadius: 21, hipRadius: 38.4, kneeRadius: 27 },
  { id: "neutral-straight", name: "직선형 기본체", description: "굴곡이 적은 기본 픽토그램형", ...ADULT_LENGTHS,
    shoulderDistance: 120, waistRadius: 60, hipDistance: 62.4, armRadius: 21, hipRadius: 30, kneeRadius: 30 },
  { id: "child-neutral", name: "아동체", description: "성별 구분 없는 4등신", rootY: 422,
    shoulderDistance: 108, waistRadius: 42, hipDistance: 50.4, armRadius: 18, hipRadius: 24, kneeRadius: 24,
    chestDistance: 84, headDistance: 78, armSegmentLength: 69, upperLegLength: 78, lowerLegLength: 96 },
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
    state.moveJoint("scene-root", 300, preset.rootY);
    setDistance(state, "pelvis-pivot", "scene-root", 60);
    setDistance(state, "waist", "pelvis-pivot", 60);
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
    state.setJointRadius("waist", preset.waistRadius);
    for (const side of ["left", "right"] as const) {
      for (const part of ["shoulder", "elbow", "wrist"] as const) {
        state.setJointRadius(`${side}-${part}`, preset.armRadius);
      }
      state.setJointRadius(`${side}-hip`, preset.hipRadius);
      state.setJointRadius(`${side}-knee`, preset.kneeRadius);
      state.setJointRadius(`${side}-ankle`, preset.kneeRadius);
    }
    const head = state.getJoint("head");
    state.applyJointProportions("head", { x: head.x, y: head.y, radius: 18, bodyRadius: 60 });
  } finally {
    state.endHistoryTransaction();
  }
}

function setDistance(state: RigState, movingId: string, anchorId: string, distance: number): void {
  state.setJointDistance(movingId, anchorId, distance);
}
