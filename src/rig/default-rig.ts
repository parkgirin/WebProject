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
  const rig: Rig = {
    defaultColor: "#dca27b",
    elementLayers: { joints: true, axes: true, faces: true, shapes: true },
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
      { id: "pelvis-pivot", groupId: "torso", parentJointId: "scene-root", x: 0, y: 60, z: 0, localRotation: 0, isVirtual: true, radius: 8, axes: [], renderOrder: 0, guideVisible: true, bodyVisible: false },
      { id: "waist", groupId: "torso", parentJointId: "pelvis-pivot", x: 0, y: -60, z: 0, localRotation: 0, radius: preset.waistRadius, surfaceProfileId: "rounded-rect", surfaceScale: { x: 1, y: 1, z: preset.armRadius / preset.waistRadius }, capsuleFlatAxes: ["x"], capsuleFlatLengths: { x: preset.waistRadius }, axes: [{ id: "upper-torso", angle: 0, pointSides: [-1, 1] }, { id: "pelvis", angle: 0, pointSides: [-1, 1] }], renderOrder: 10, guideVisible: true, bodyVisible: true },
      { id: "chest", groupId: "torso", parentJointId: "waist", x: 0, y: -preset.chestDistance, z: 0, localRotation: 0, radius: 18, axes: [{ id: "neck", angle: 0, pointSides: [-1, 1] }], renderOrder: 10, guideVisible: true, bodyVisible: false },
      { id: "head", groupId: "head", parentJointId: "chest", x: 0, y: -preset.headDistance, z: 0, localRotation: 0, radius: 18, axes: [{ id: "neck", angle: 0, pointSides: [-1, 1] }], renderOrder: 30, guideVisible: true, bodyVisible: false },
      { id: "left-shoulder", groupId: "left-arm", parentJointId: "chest", x: -shoulderOffset, y: 0, z: 0, localRotation: 0, radius: preset.armRadius, axes: [{ id: "torso", angle: -90, pointSides: [-1, 1] }, { id: "upper-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 18, guideVisible: true, bodyVisible: true },
      { id: "right-shoulder", groupId: "right-arm", parentJointId: "chest", x: shoulderOffset, y: 0, z: 0, localRotation: 0, radius: preset.armRadius, axes: [{ id: "torso", angle: -90, pointSides: [-1, 1] }, { id: "upper-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 22, guideVisible: true, bodyVisible: true },
      { id: "left-elbow", groupId: "left-arm", parentJointId: "left-shoulder", x: -preset.armSegmentLength, y: 0, z: 0, localRotation: 0, radius: preset.armRadius, axes: [{ id: "upper-arm", angle: 0, pointSides: [-1, 1] }, { id: "lower-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 18, guideVisible: true, bodyVisible: true },
      { id: "right-elbow", groupId: "right-arm", parentJointId: "right-shoulder", x: preset.armSegmentLength, y: 0, z: 0, localRotation: 0, radius: preset.armRadius, axes: [{ id: "upper-arm", angle: 0, pointSides: [-1, 1] }, { id: "lower-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 22, guideVisible: true, bodyVisible: true },
      { id: "left-wrist", groupId: "left-arm", parentJointId: "left-elbow", x: -preset.armSegmentLength, y: 0, z: 0, localRotation: 0, radius: preset.armRadius, axes: [{ id: "lower-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 18, guideVisible: true, bodyVisible: true },
      { id: "right-wrist", groupId: "right-arm", parentJointId: "right-elbow", x: preset.armSegmentLength, y: 0, z: 0, localRotation: 0, radius: preset.armRadius, axes: [{ id: "lower-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 22, guideVisible: true, bodyVisible: true },
      { id: "left-hip", groupId: "left-leg", parentJointId: "pelvis-pivot", axisReferenceJointId: "waist", x: -hipOffset, y: 0, z: 0, localRotation: 0, radius: preset.hipRadius, axes: [{ id: "pelvis-horizontal", angle: 0, pointSides: [-1], alignment: "reference-axis-outer-tangent", referenceAxisId: "pelvis", referenceAxisSide: -1, alignedPointSide: -1 }, { id: "pelvis-vertical", angle: 90, pointSides: [-1, 1] }, { id: "upper-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 14, guideVisible: true, bodyVisible: true },
      { id: "right-hip", groupId: "right-leg", parentJointId: "pelvis-pivot", axisReferenceJointId: "waist", x: hipOffset, y: 0, z: 0, localRotation: 0, radius: preset.hipRadius, axes: [{ id: "pelvis-horizontal", angle: 0, pointSides: [1], alignment: "reference-axis-outer-tangent", referenceAxisId: "pelvis", referenceAxisSide: 1, alignedPointSide: 1 }, { id: "pelvis-vertical", angle: 90, pointSides: [-1, 1] }, { id: "upper-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 16, guideVisible: true, bodyVisible: true },
      { id: "left-knee", groupId: "left-leg", parentJointId: "left-hip", x: 0, y: preset.upperLegLength, z: 0, localRotation: 0, radius: preset.kneeRadius, axes: [{ id: "upper-leg", angle: 0, pointSides: [-1, 1] }, { id: "lower-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 14, guideVisible: true, bodyVisible: true },
      { id: "right-knee", groupId: "right-leg", parentJointId: "right-hip", x: 0, y: preset.upperLegLength, z: 0, localRotation: 0, radius: preset.kneeRadius, axes: [{ id: "upper-leg", angle: 0, pointSides: [-1, 1] }, { id: "lower-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 16, guideVisible: true, bodyVisible: true },
      { id: "left-ankle", groupId: "left-leg", parentJointId: "left-knee", x: 0, y: preset.lowerLegLength, z: 0, localRotation: 0, radius: preset.kneeRadius, axes: [{ id: "lower-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 14, guideVisible: true, bodyVisible: true },
      { id: "right-ankle", groupId: "right-leg", parentJointId: "right-knee", x: 0, y: preset.lowerLegLength, z: 0, localRotation: 0, radius: preset.kneeRadius, axes: [{ id: "lower-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 16, guideVisible: true, bodyVisible: true },
    ],
    peerGroups: [
      { id: "shoulder-band", jointIds: ["left-shoulder", "right-shoulder"] },
      { id: "hip-band", jointIds: ["left-hip", "right-hip"], centerJointId: "pelvis-pivot" },
    ],
    artShapes: [{ id: "head-base", kind: "circle", vertices: [{ id: "center", source: "joint-center", jointId: "head", offsetX: 0, offsetY: 0 }], radiusX: 60, radiusY: 60, groupId: "head", layerOrder: 31, compositeMode: "paint", compositeGroupId: "composite-head-base" }],
    faces: [
      {
        id: "neck",
        rotationTarget: { type: "child", childJointId: "head" },
        groupId: "head",
        layerOrder: 20,
        vertices: [
          { jointId: "head", axisId: "neck", side: -1 },
          { jointId: "chest", axisId: "neck", side: -1 },
          { jointId: "chest", axisId: "neck", side: 1 },
          { jointId: "head", axisId: "neck", side: 1 },
        ],
        orderOffset: -2,
      },
      {
        id: "shoulder-band",
        rotationTarget: { type: "peer", peerGroupId: "shoulder-band", referenceJointId: "left-shoulder" },
        groupId: "torso",
        layerOrder: 20,
        vertices: [
          { jointId: "left-shoulder", axisId: "torso", side: 1 },
          { jointId: "right-shoulder", axisId: "torso", side: 1 },
          { jointId: "right-shoulder", axisId: "torso", side: -1 },
          { jointId: "left-shoulder", axisId: "torso", side: -1 },
        ],
        orderOffset: 0,
      },
      {
        id: "torso",
        rotationTarget: { type: "child", childJointId: "chest" },
        groupId: "torso",
        layerOrder: 20,
        vertices: [
          { jointId: "left-shoulder", axisId: "torso", side: -1 },
          { jointId: "right-shoulder", axisId: "torso", side: -1 },
          { jointId: "waist", axisId: "upper-torso", side: 1 },
          { jointId: "waist", axisId: "upper-torso", side: -1 },
        ],
        orderOffset: 0,
      },
      {
        id: "pelvis",
        rotationTarget: { type: "peer", peerGroupId: "hip-band", referenceJointId: "left-hip" },
        groupId: "torso",
        layerOrder: 20,
        vertices: [
          { jointId: "waist", axisId: "pelvis", side: -1 },
          { jointId: "waist", axisId: "pelvis", side: 1 },
          { jointId: "right-hip", axisId: "pelvis-vertical", side: 1 },
          { jointId: "left-hip", axisId: "pelvis-vertical", side: 1 },
        ],
        orderOffset: 0,
      },
      {
        id: "right-pelvis-triangle",
        rotationTarget: { type: "peer", peerGroupId: "hip-band", referenceJointId: "left-hip" },
        groupId: "torso",
        layerOrder: 20,
        vertices: [
          { jointId: "waist", axisId: "pelvis", side: 1 },
          { jointId: "right-hip", axisId: "pelvis-horizontal", side: 1 },
          { jointId: "right-hip", axisId: "pelvis-vertical", side: 1 },
        ],
        orderOffset: 0,
      },
      {
        id: "left-pelvis-triangle",
        rotationTarget: { type: "peer", peerGroupId: "hip-band", referenceJointId: "left-hip" },
        groupId: "torso",
        layerOrder: 20,
        vertices: [
          { jointId: "waist", axisId: "pelvis", side: -1 },
          { jointId: "left-hip", axisId: "pelvis-vertical", side: 1 },
          { jointId: "left-hip", axisId: "pelvis-horizontal", side: -1 },
        ],
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
      vertices: [
        { jointId: `${side}-shoulder`, axisId: "upper-arm", side: 1 },
        { jointId: `${side}-elbow`, axisId: "upper-arm", side: 1 },
        { jointId: `${side}-elbow`, axisId: "upper-arm", side: -1 },
        { jointId: `${side}-shoulder`, axisId: "upper-arm", side: -1 },
      ],
      orderOffset,
    },
    {
      id: `${side}-lower-arm`,
      cameraFacingLimb: { startJointId: `${side}-elbow`, endJointId: `${side}-wrist` },
      rotationTarget: { type: "child", childJointId: `${side}-wrist` },
      groupId: `${side}-arm`,
      layerOrder: side === "left" ? 20 : 30,
      vertices: [
        { jointId: `${side}-elbow`, axisId: "lower-arm", side: 1 },
        { jointId: `${side}-wrist`, axisId: "lower-arm", side: 1 },
        { jointId: `${side}-wrist`, axisId: "lower-arm", side: -1 },
        { jointId: `${side}-elbow`, axisId: "lower-arm", side: -1 },
      ],
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
      vertices: [
        { jointId: `${side}-hip`, axisId: "upper-leg", side: 1 },
        { jointId: `${side}-knee`, axisId: "upper-leg", side: 1 },
        { jointId: `${side}-knee`, axisId: "upper-leg", side: -1 },
        { jointId: `${side}-hip`, axisId: "upper-leg", side: -1 },
      ],
      orderOffset,
    },
    {
      id: `${side}-lower-leg`,
      cameraFacingLimb: { startJointId: `${side}-knee`, endJointId: `${side}-ankle` },
      rotationTarget: { type: "child", childJointId: `${side}-ankle` },
      groupId: `${side}-leg`,
      layerOrder: side === "left" ? 20 : 30,
      vertices: [
        { jointId: `${side}-knee`, axisId: "lower-leg", side: 1 },
        { jointId: `${side}-ankle`, axisId: "lower-leg", side: 1 },
        { jointId: `${side}-ankle`, axisId: "lower-leg", side: -1 },
        { jointId: `${side}-knee`, axisId: "lower-leg", side: -1 },
      ],
      orderOffset,
    },
  ];
}
