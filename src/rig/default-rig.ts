import { createNeutralBodyViewProfiles, type Rig } from "./types.ts";
import { DEFAULT_AVATAR_PRESET_ID, getAvatarProportionPreset } from "../presets/avatar-presets.ts";

export function createDefaultRig(): Rig {
  // Build a new document from the straight neutral preset directly. Do not
  // construct a male body and then mutate it through the preset command: that
  // creates an unnecessary history entry and leaves two competing defaults.
  const preset = getAvatarProportionPreset(DEFAULT_AVATAR_PRESET_ID);
  if (!preset) throw new Error(`Missing default avatar preset: ${DEFAULT_AVATAR_PRESET_ID}`);
  const shoulderOffset = preset.shoulderDistance / 2;
  const hipOffset = preset.hipDistance / 2;
  const depth = preset.depthProfile;
  const rig: Rig = {
    defaultColor: "#dca27b",
    elementLayers: { joints: true, axes: true, faces: true, shapes: true },
    perspectiveEnabled: true,
    projectionStrength: 35,
    viewYRotation: 0,
    bodyViewProfiles: { front: { jointRadiusScale: {} }, side: { jointRadiusScale: {} }, back: { jointRadiusScale: {} } },
    surfaceProfiles: [{ id: "rounded-rect", depthScale: 1, outline: [{ x: -1, y: -.55 }, { x: .55, y: -1 }, { x: 1, y: -.55 }, { x: 1, y: .55 }, { x: .55, y: 1 }, { x: -.55, y: 1 }, { x: -1, y: .55 }] }],
    palette: [],
    groups: [
      { id: "head", name: "머리", visible: true, order: 40 },
      { id: "torso", name: "몸통", visible: true, order: 30 },
      { id: "left-arm", name: "왼팔", visible: true, order: 20 },
      { id: "right-arm", name: "오른팔", visible: true, order: 20 },
      { id: "left-leg", name: "왼다리", visible: true, order: 10 },
      { id: "right-leg", name: "오른다리", visible: true, order: 10 },
    ],
    joints: [
      { id: "scene-root", groupId: "torso", x: 300, y: preset.rootY, z: 0, localRotation: 0, isVirtual: true, radius: 8, axes: [], renderOrder: 0, guideVisible: false, bodyVisible: false },
      { id: "pelvis-pivot", groupId: "torso", parentJointId: "scene-root", x: 0, y: 60, z: depth.pelvis, localRotation: 0, isVirtual: true, radius: 8, axes: [], renderOrder: 0, guideVisible: true, bodyVisible: false },
      { id: "waist", groupId: "torso", parentJointId: "pelvis-pivot", x: 0, y: -60, z: depth.waist, localRotation: 0, radius: preset.armRadius, surfaceProfileId: "rounded-rect", surfaceScale: { x: 1, y: 1, z: 1 }, capsuleFlatAxes: ["x"], capsuleFlatLengths: { x: Math.max(0, (preset.waistRadius - preset.armRadius) * 2) }, axes: [{ id: "upper-torso", angle: 0, pointSides: [-1, 1], alignment: "child-perpendicular" }], renderOrder: 10, guideVisible: true, bodyVisible: true },
      { id: "chest", groupId: "torso", parentJointId: "waist", x: 0, y: -preset.chestDistance, z: depth.chest, localRotation: 0, radius: 18, axes: [{ id: "neck", angle: 0, pointSides: [-1, 1], alignment: "child-perpendicular" }], renderOrder: 10, guideVisible: true, bodyVisible: false },
      { id: "head", groupId: "head", parentJointId: "chest", x: 0, y: -preset.headDistance, z: depth.chest, localRotation: 0, radius: 18, axes: [], renderOrder: 30, guideVisible: true, bodyVisible: false },
      { id: "left-shoulder", groupId: "left-arm", parentJointId: "chest", x: -shoulderOffset, y: 0, z: 0, localRotation: 0, radius: preset.armRadius, surfaceProfileId: "rounded-rect", surfaceScale: { x: 1, y: 1, z: 1 }, capsuleFlatAxes: ["x"], capsuleFlatLengths: { x: preset.armRadius }, capsuleFlatAlignment: "peer-outward", axes: [{ id: "upper-arm", angle: 90, pointSides: [-1, 1], alignment: "child-perpendicular" }], renderOrder: 18, guideVisible: true, bodyVisible: true },
      { id: "right-shoulder", groupId: "right-arm", parentJointId: "chest", x: shoulderOffset, y: 0, z: 0, localRotation: 0, radius: preset.armRadius, surfaceProfileId: "rounded-rect", surfaceScale: { x: 1, y: 1, z: 1 }, capsuleFlatAxes: ["x"], capsuleFlatLengths: { x: preset.armRadius }, capsuleFlatAlignment: "peer-outward", axes: [{ id: "upper-arm", angle: -90, pointSides: [-1, 1], alignment: "child-perpendicular" }], renderOrder: 22, guideVisible: true, bodyVisible: true },
      { id: "left-elbow", groupId: "left-arm", parentJointId: "left-shoulder", parentAnchor: { type: "capsule-end", role: "outer" }, x: -preset.armSegmentLength, y: 0, z: 0, localRotation: 0, radius: preset.armRadius, axes: [{ id: "lower-arm", angle: 90, pointSides: [-1, 1], alignment: "child-perpendicular" }], renderOrder: 18, guideVisible: true, bodyVisible: true },
      { id: "right-elbow", groupId: "right-arm", parentJointId: "right-shoulder", parentAnchor: { type: "capsule-end", role: "outer" }, x: preset.armSegmentLength, y: 0, z: 0, localRotation: 0, radius: preset.armRadius, axes: [{ id: "lower-arm", angle: -90, pointSides: [-1, 1], alignment: "child-perpendicular" }], renderOrder: 22, guideVisible: true, bodyVisible: true },
      { id: "left-wrist", groupId: "left-arm", parentJointId: "left-elbow", x: -preset.armSegmentLength, y: 0, z: 0, localRotation: 0, radius: preset.armRadius, axes: [], renderOrder: 18, guideVisible: true, bodyVisible: true },
      { id: "right-wrist", groupId: "right-arm", parentJointId: "right-elbow", x: preset.armSegmentLength, y: 0, z: 0, localRotation: 0, radius: preset.armRadius, axes: [], renderOrder: 22, guideVisible: true, bodyVisible: true },
      { id: "left-hip", groupId: "left-leg", parentJointId: "pelvis-pivot", x: -hipOffset, y: 0, z: 0, localRotation: 0, radius: preset.hipRadius, axes: [{ id: "upper-leg", angle: 0, pointSides: [-1, 1], alignment: "child-perpendicular" }], renderOrder: 14, guideVisible: true, bodyVisible: true },
      { id: "right-hip", groupId: "right-leg", parentJointId: "pelvis-pivot", x: hipOffset, y: 0, z: 0, localRotation: 0, radius: preset.hipRadius, axes: [{ id: "upper-leg", angle: 0, pointSides: [-1, 1], alignment: "child-perpendicular" }], renderOrder: 16, guideVisible: true, bodyVisible: true },
      { id: "left-knee", groupId: "left-leg", parentJointId: "left-hip", x: 0, y: preset.upperLegLength, z: 0, localRotation: 0, radius: preset.kneeRadius, axes: [{ id: "lower-leg", angle: 0, pointSides: [-1, 1], alignment: "child-perpendicular" }], renderOrder: 14, guideVisible: true, bodyVisible: true },
      { id: "right-knee", groupId: "right-leg", parentJointId: "right-hip", x: 0, y: preset.upperLegLength, z: 0, localRotation: 0, radius: preset.kneeRadius, axes: [{ id: "lower-leg", angle: 0, pointSides: [-1, 1], alignment: "child-perpendicular" }], renderOrder: 16, guideVisible: true, bodyVisible: true },
      { id: "left-ankle", groupId: "left-leg", parentJointId: "left-knee", x: 0, y: preset.lowerLegLength, z: 0, localRotation: 0, radius: preset.kneeRadius, axes: [], renderOrder: 14, guideVisible: true, bodyVisible: true },
      { id: "right-ankle", groupId: "right-leg", parentJointId: "right-knee", x: 0, y: preset.lowerLegLength, z: 0, localRotation: 0, radius: preset.kneeRadius, axes: [], renderOrder: 16, guideVisible: true, bodyVisible: true },
    ],
    peerGroups: [
      { id: "shoulder-band", jointIds: ["left-shoulder", "right-shoulder"], virtualCapsule: true },
      { id: "hip-band", jointIds: ["left-hip", "right-hip"], centerJointId: "pelvis-pivot", virtualCapsule: true },
    ],
    artShapes: [{ id: "head-base", kind: "sphere", vertices: [{ id: "center", source: "joint-center", jointId: "head", offsetX: 0, offsetY: 0 }], radius: 60, groupId: "head", layerOrder: 31, compositeMode: "paint", compositeGroupId: "composite-head-base" }],
    faces: [
      {
        id: "neck",
        cameraFacingLimb: { startJointId: "chest", endJointId: "head" },
        rotationTarget: { type: "child", childJointId: "head" },
        groupId: "head",
        layerOrder: 20,
        vertices: [],
        orderOffset: -2,
      },
      {
        id: "shoulder-band",
        proceduralSurface: "peer-capsule",
        rotationTarget: { type: "peer", peerGroupId: "shoulder-band", referenceJointId: "left-shoulder" },
        groupId: "torso",
        layerOrder: 20,
        vertices: [],
        orderOffset: 0,
      },
      {
        id: "torso",
        proceduralSurface: "torso",
        rotationTarget: { type: "child", childJointId: "chest" },
        groupId: "torso",
        layerOrder: 20,
        vertices: [],
        orderOffset: 0,
      },
      {
        id: "waist-hip",
        proceduralSurface: "waist-hip",
        rotationTarget: { type: "peer", peerGroupId: "hip-band", referenceJointId: "left-hip" },
        groupId: "torso",
        layerOrder: 19,
        vertices: [],
        orderOffset: 0,
      },
      ...createArmFaces("left", -1),
      ...createArmFaces("right", 1),
      ...createLegFaces("left", -1),
      ...createLegFaces("right", 1),
    ],
  };
  rig.bodyViewProfiles = createNeutralBodyViewProfiles(rig.joints);
  return rig;
}

function createArmFaces(
  side: "left" | "right",
  orderOffset: number,
): Rig["faces"] {
  return [
    {
      id: `${side}-upper-arm`,
      cameraFacingLimb: { startJointId: `${side}-shoulder`, endJointId: `${side}-elbow` },
      rotationTarget: { type: "child", childJointId: `${side}-elbow` },
      groupId: `${side}-arm`,
      layerOrder: side === "left" ? 20 : 30,
      vertices: [],
      orderOffset,
    },
    {
      id: `${side}-lower-arm`,
      cameraFacingLimb: { startJointId: `${side}-elbow`, endJointId: `${side}-wrist` },
      rotationTarget: { type: "child", childJointId: `${side}-wrist` },
      groupId: `${side}-arm`,
      layerOrder: side === "left" ? 20 : 30,
      vertices: [],
      orderOffset,
    },
  ];
}

function createLegFaces(
  side: "left" | "right",
  orderOffset: number,
): Rig["faces"] {
  return [
    {
      id: `${side}-upper-leg`,
      cameraFacingLimb: { startJointId: `${side}-hip`, endJointId: `${side}-knee` },
      rotationTarget: { type: "child", childJointId: `${side}-knee` },
      groupId: `${side}-leg`,
      layerOrder: side === "left" ? 20 : 30,
      vertices: [],
      orderOffset,
    },
    {
      id: `${side}-lower-leg`,
      cameraFacingLimb: { startJointId: `${side}-knee`, endJointId: `${side}-ankle` },
      rotationTarget: { type: "child", childJointId: `${side}-ankle` },
      groupId: `${side}-leg`,
      layerOrder: side === "left" ? 20 : 30,
      vertices: [],
      orderOffset,
    },
  ];
}
