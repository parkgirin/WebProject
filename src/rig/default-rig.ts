import type { Rig } from "./types.ts";

export function createDefaultRig(): Rig {
  return {
    defaultColor: "#dca27b",
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
      { id: "scene-root", groupId: "torso", x: 300, y: 320, localRotation: 0, isVirtual: true, radius: 8, axes: [], renderOrder: 0, guideVisible: false, bodyVisible: false },
      { id: "waist", groupId: "torso", parentJointId: "scene-root", x: 0, y: 0, localRotation: 0, radius: 48, axes: [{ id: "upper-torso", angle: 0, pointSides: [-1, 1] }, { id: "pelvis", angle: 0, pointSides: [-1, 1] }], renderOrder: 10, guideVisible: true, bodyVisible: true },
      { id: "chest", groupId: "torso", parentJointId: "waist", x: 0, y: -96, localRotation: 0, radius: 18, axes: [{ id: "neck", angle: 0, pointSides: [-1, 1] }], renderOrder: 10, guideVisible: true, bodyVisible: false },
      { id: "head", groupId: "head", parentJointId: "chest", x: 0, y: -84, localRotation: 0, radius: 18, bodyRadius: 60, axes: [{ id: "neck", angle: 0, pointSides: [-1, 1] }], renderOrder: 30, guideVisible: true, bodyVisible: true },
      { id: "left-shoulder", groupId: "left-arm", parentJointId: "chest", x: -78, y: 0, localRotation: 0, radius: 24, axes: [{ id: "torso", angle: -90, pointSides: [-1, 1] }, { id: "upper-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 18, guideVisible: true, bodyVisible: true },
      { id: "right-shoulder", groupId: "right-arm", parentJointId: "chest", x: 78, y: 0, localRotation: 0, radius: 24, axes: [{ id: "torso", angle: -90, pointSides: [-1, 1] }, { id: "upper-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 22, guideVisible: true, bodyVisible: true },
      { id: "left-elbow", groupId: "left-arm", parentJointId: "left-shoulder", x: 0, y: 96, localRotation: 0, radius: 24, axes: [{ id: "upper-arm", angle: 0, pointSides: [-1, 1] }, { id: "lower-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 18, guideVisible: true, bodyVisible: true },
      { id: "right-elbow", groupId: "right-arm", parentJointId: "right-shoulder", x: 0, y: 96, localRotation: 0, radius: 24, axes: [{ id: "upper-arm", angle: 0, pointSides: [-1, 1] }, { id: "lower-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 22, guideVisible: true, bodyVisible: true },
      { id: "left-wrist", groupId: "left-arm", parentJointId: "left-elbow", x: 0, y: 96, localRotation: 0, radius: 24, axes: [{ id: "lower-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 18, guideVisible: true, bodyVisible: true },
      { id: "right-wrist", groupId: "right-arm", parentJointId: "right-elbow", x: 0, y: 96, localRotation: 0, radius: 24, axes: [{ id: "lower-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 22, guideVisible: true, bodyVisible: true },
      { id: "left-hip", groupId: "left-leg", parentJointId: "waist", x: -38, y: 60, localRotation: 0, radius: 30, axes: [{ id: "pelvis-horizontal", angle: 0, pointSides: [-1], alignment: "parent-perpendicular" }, { id: "pelvis-vertical", angle: 90, pointSides: [-1, 1], alignment: "parent-parallel" }, { id: "upper-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 14, guideVisible: true, bodyVisible: true },
      { id: "right-hip", groupId: "right-leg", parentJointId: "waist", x: 38, y: 60, localRotation: 0, radius: 30, axes: [{ id: "pelvis-horizontal", angle: 0, pointSides: [1], alignment: "parent-perpendicular" }, { id: "pelvis-vertical", angle: 90, pointSides: [-1, 1], alignment: "parent-parallel" }, { id: "upper-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 16, guideVisible: true, bodyVisible: true },
      { id: "left-knee", groupId: "left-leg", parentJointId: "left-hip", x: 0, y: 120, localRotation: 0, radius: 30, axes: [{ id: "upper-leg", angle: 0, pointSides: [-1, 1] }, { id: "lower-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 14, guideVisible: true, bodyVisible: true },
      { id: "right-knee", groupId: "right-leg", parentJointId: "right-hip", x: 0, y: 120, localRotation: 0, radius: 30, axes: [{ id: "upper-leg", angle: 0, pointSides: [-1, 1] }, { id: "lower-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 16, guideVisible: true, bodyVisible: true },
      { id: "left-ankle", groupId: "left-leg", parentJointId: "left-knee", x: 0, y: 150, localRotation: 0, radius: 30, axes: [{ id: "lower-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 14, guideVisible: true, bodyVisible: true },
      { id: "right-ankle", groupId: "right-leg", parentJointId: "right-knee", x: 0, y: 150, localRotation: 0, radius: 30, axes: [{ id: "lower-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 16, guideVisible: true, bodyVisible: true },
    ],
    peerGroups: [
      { id: "shoulder-band", jointIds: ["left-shoulder", "right-shoulder"] },
      { id: "hip-band", jointIds: ["left-hip", "right-hip"] },
    ],
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
}

function createArmFaces(
  side: "left" | "right",
  orderOffset: number,
): Rig["faces"] {
  return [
    {
      id: `${side}-upper-arm`,
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
