import { normalizeAngle } from "./geometry.ts";
import type { Rig } from "./types.ts";

export interface PoseKey {
  id: string;
  name: string;
  frame: number;
  rig: Rig;
}

export interface PoseClip {
  id: string;
  name: string;
  fps: number;
  keys: PoseKey[];
  playback?: PosePlaybackSettings;
}

export interface PosePlaybackSettings {
  mode: "ping-pong" | "loop";
  closingFrames: number;
}

export interface PosePlaybackPosition {
  frame: number;
  direction: 1 | -1;
}

export interface PoseSample {
  rig: Rig;
  leftKey: PoseKey;
  rightKey: PoseKey;
  amount: number;
}

/** Interpolate the shortest path between two degree values. */
export function interpolateAngle(from: number, to: number, amount: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return normalizeAngle(from + delta * amount);
}

/** Build a temporary 2D pose between compatible rig snapshots. */
export function interpolatePoseRig(start: Rig, end: Rig, amount: number): Rig {
  const t = Math.min(1, Math.max(0, amount));
  const result = structuredClone(start);
  const endById = new Map(end.joints.map((joint) => [joint.id, joint]));

  for (const joint of result.joints) {
    const startJoint = start.joints.find((candidate) => candidate.id === joint.id)!;
    const endJoint = endById.get(joint.id);
    if (!endJoint || startJoint.axes.length !== endJoint.axes.length) {
      throw new Error("보간할 두 포즈의 관절 구조가 일치하지 않습니다.");
    }
    if (startJoint.parentJointId && startJoint.parentJointId === endJoint.parentJointId) {
      const offset = interpolateJointOffset(startJoint.x, startJoint.y, endJoint.x, endJoint.y, t);
      joint.x = offset.x;
      joint.y = offset.y;
    } else {
      joint.x = lerp(startJoint.x, endJoint.x, t);
      joint.y = lerp(startJoint.y, endJoint.y, t);
    }
    joint.localRotation = interpolateAngle(startJoint.localRotation, endJoint.localRotation, t);
    joint.radius = lerp(startJoint.radius, endJoint.radius, t);
    if (startJoint.bodyRadius !== undefined && endJoint.bodyRadius !== undefined) {
      joint.bodyRadius = lerp(startJoint.bodyRadius, endJoint.bodyRadius, t);
    }
    if (startJoint.sideRadius !== undefined && endJoint.sideRadius !== undefined) {
      joint.sideRadius = lerp(startJoint.sideRadius, endJoint.sideRadius, t);
    }
    joint.bodyVisible = t < 1 ? startJoint.bodyVisible : endJoint.bodyVisible;
    joint.color = interpolateColor(resolveJointColor(start, startJoint.id), resolveJointColor(end, endJoint.id), t);
    delete joint.paletteId;

    for (const axis of joint.axes) {
      const startAxis = startJoint.axes.find((candidate) => candidate.id === axis.id);
      const endAxis = endJoint.axes.find((candidate) => candidate.id === axis.id);
      if (!startAxis || !endAxis) throw new Error("보간할 두 포즈의 축선 구조가 일치하지 않습니다.");
      axis.angle = interpolateAngle(startAxis.angle, endAxis.angle, t);
    }
  }

  result.defaultColor = interpolateColor(start.defaultColor, end.defaultColor, t);
  const endFaces = new Map(end.faces.map((face) => [face.id, face]));
  for (const face of result.faces) {
    const endFace = endFaces.get(face.id);
    if (!endFace) throw new Error("보간할 두 포즈의 면 구조가 일치하지 않습니다.");
    face.color = interpolateColor(resolveFaceColor(start, face.id), resolveFaceColor(end, face.id), t);
    delete face.paletteId;
  }
  return result;
}

export function createPoseKey(id: string, name: string, frame: number, rig: Rig): PoseKey {
  if (!id.trim() || !name.trim()) throw new Error("키프레임 ID와 이름이 필요합니다.");
  if (!Number.isInteger(frame) || frame < 0) throw new Error("키프레임 위치는 0 이상의 정수여야 합니다.");
  return { id, name, frame, rig: structuredClone(rig) };
}

export function addPoseKey(clip: PoseClip, key: PoseKey): PoseClip {
  if (clip.keys.some((candidate) => candidate.id === key.id)) throw new Error("같은 키프레임 ID가 이미 있습니다.");
  if (clip.keys.some((candidate) => candidate.frame === key.frame)) throw new Error("같은 프레임에 키프레임이 이미 있습니다.");
  if (clip.keys[0]) assertCompatibleRig(clip.keys[0].rig, key.rig);
  return { ...clip, keys: [...clip.keys, structuredClone(key)].sort((a, b) => a.frame - b.frame) };
}

export function samplePoseClip(clip: PoseClip, frame: number): PoseSample {
  if (clip.keys.length === 0) throw new Error("샘플링할 키프레임이 없습니다.");
  const keys = [...clip.keys].sort((a, b) => a.frame - b.frame);
  const currentFrame = Number.isFinite(frame) ? frame : keys[0].frame;
  if (currentFrame <= keys[0].frame) {
    return { rig: structuredClone(keys[0].rig), leftKey: keys[0], rightKey: keys[0], amount: 0 };
  }
  const last = keys[keys.length - 1];
  if (currentFrame >= last.frame) {
    return { rig: structuredClone(last.rig), leftKey: last, rightKey: last, amount: 0 };
  }
  const rightIndex = keys.findIndex((key) => key.frame >= currentFrame);
  const rightKey = keys[rightIndex];
  const leftKey = keys[rightIndex - 1];
  if (rightKey.frame === currentFrame) {
    return { rig: structuredClone(rightKey.rig), leftKey: rightKey, rightKey, amount: 0 };
  }
  const amount = (currentFrame - leftKey.frame) / (rightKey.frame - leftKey.frame);
  return { rig: interpolatePoseRig(leftKey.rig, rightKey.rig, amount), leftKey, rightKey, amount };
}

export function getPosePlaybackSettings(clip: PoseClip): PosePlaybackSettings {
  return clip.playback ?? { mode: "ping-pong", closingFrames: 6 };
}

/** Sample the ordinary timeline or the optional closing segment from the last key back to the first. */
export function samplePosePlayback(clip: PoseClip, frame: number): PoseSample {
  const keys = [...clip.keys].sort((a, b) => a.frame - b.frame);
  if (keys.length === 0) throw new Error("샘플링할 키프레임이 없습니다.");
  const settings = getPosePlaybackSettings(clip);
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (settings.mode !== "loop" || frame <= last.frame || keys.length < 2) return samplePoseClip(clip, frame);
  const amount = Math.min(1, Math.max(0, (frame - last.frame) / settings.closingFrames));
  return {
    rig: interpolatePoseRig(last.rig, first.rig, amount),
    leftKey: last,
    rightKey: first,
    amount,
  };
}

/** Advance a discrete playhead, wrapping through a closing segment or reflecting for ping-pong playback. */
export function advancePosePlayback(
  clip: PoseClip,
  frame: number,
  direction: 1 | -1,
  elapsedFrames: number,
): PosePlaybackPosition {
  const keys = [...clip.keys].sort((a, b) => a.frame - b.frame);
  if (keys.length < 2) return { frame: keys[0]?.frame ?? 0, direction: 1 };
  const firstFrame = keys[0].frame;
  const lastFrame = keys[keys.length - 1].frame;
  const span = lastFrame - firstFrame;
  const steps = Math.max(0, elapsedFrames);
  const settings = getPosePlaybackSettings(clip);

  if (settings.mode === "loop") {
    const cycleLength = span + settings.closingFrames;
    return { frame: firstFrame + positiveModulo(frame - firstFrame + steps, cycleLength), direction: 1 };
  }

  const cycleLength = span * 2;
  const pathPosition = direction === 1 ? frame - firstFrame : span + lastFrame - frame;
  const next = positiveModulo(pathPosition + steps, cycleLength);
  if (next === 0) return { frame: firstFrame, direction: 1 };
  if (next < span) return { frame: firstFrame + next, direction: 1 };
  return { frame: lastFrame - (next - span), direction: -1 };
}

export function interpolateColor(from: string, to: string, amount: number): string {
  const start = parseHexColor(from);
  const end = parseHexColor(to);
  const t = Math.min(1, Math.max(0, amount));
  const channels = start.map((value, index) => {
    const linear = lerp(srgbToLinear(value), srgbToLinear(end[index]), t);
    return Math.round(linearToSrgb(linear));
  });
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function assertCompatibleRig(start: Rig, end: Rig): void {
  if (start.joints.length !== end.joints.length || start.faces.length !== end.faces.length) {
    throw new Error("키프레임의 리그 구조가 일치하지 않습니다.");
  }
  const endJoints = new Map(end.joints.map((joint) => [joint.id, joint]));
  for (const joint of start.joints) {
    const other = endJoints.get(joint.id);
    if (!other || joint.parentJointId !== other.parentJointId || joint.axes.length !== other.axes.length
      || joint.axes.some((axis) => !other.axes.some((candidate) => candidate.id === axis.id))) {
      throw new Error("키프레임의 관절·축 구조가 일치하지 않습니다.");
    }
  }
  const endFaceIds = new Set(end.faces.map((face) => face.id));
  if (start.faces.some((face) => !endFaceIds.has(face.id))) throw new Error("키프레임의 면 구조가 일치하지 않습니다.");
}

function resolveJointColor(rig: Rig, jointId: string): string {
  const joint = rig.joints.find((candidate) => candidate.id === jointId)!;
  return resolveColor(rig, joint.color, joint.paletteId);
}

function resolveFaceColor(rig: Rig, faceId: string): string {
  const face = rig.faces.find((candidate) => candidate.id === faceId)!;
  return resolveColor(rig, face.color, face.paletteId);
}

function resolveColor(rig: Rig, color?: string, paletteId?: string): string {
  return color ?? rig.palette.find((entry) => entry.id === paletteId)?.color ?? rig.defaultColor;
}

function parseHexColor(value: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) throw new Error(`보간할 수 없는 색상입니다: ${value}`);
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16)) as [number, number, number];
}

function srgbToLinear(value: number): number {
  const channel = value / 255;
  return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const channel = value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
  return Math.min(255, Math.max(0, channel * 255));
}

function interpolateJointOffset(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  amount: number,
): { x: number; y: number } {
  const startDistance = Math.hypot(startX, startY);
  const endDistance = Math.hypot(endX, endY);
  const distanceTolerance = Math.max(1, startDistance, endDistance) * 1e-9;
  if (Math.abs(startDistance - endDistance) > distanceTolerance || startDistance <= distanceTolerance) {
    return { x: lerp(startX, endX, amount), y: lerp(startY, endY, amount) };
  }

  const startAngle = Math.atan2(startY, startX) * 180 / Math.PI;
  const endAngle = Math.atan2(endY, endX) * 180 / Math.PI;
  const angle = interpolateAngle(startAngle, endAngle, amount) * Math.PI / 180;
  const distance = lerp(startDistance, endDistance, amount);
  return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
