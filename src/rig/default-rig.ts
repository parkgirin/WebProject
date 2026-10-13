import type { Rig } from "./types";

export function createDefaultRig(): Rig {
  return {
    defaultColor: "#dca27b",
    joints: [
      { id: "head", x: 300, y: 140, radius: 18, bodyRadius: 60, axes: [{ id: "neck", angle: 0, pointSides: [-1, 1] }], renderOrder: 30, guideVisible: true, bodyVisible: true },
      { id: "chest", x: 300, y: 224, radius: 18, axes: [{ id: "neck", angle: 0, pointSides: [-1, 1] }], renderOrder: 10, guideVisible: true, bodyVisible: false },
      { id: "waist", x: 300, y: 320, radius: 48, axes: [{ id: "upper-torso", angle: 0, pointSides: [-1, 1] }, { id: "pelvis", angle: 0, pointSides: [-1, 1] }], renderOrder: 10, guideVisible: true, bodyVisible: false },
      { id: "left-shoulder", x: 222, y: 224, radius: 24, axes: [{ id: "torso", angle: -90, pointSides: [-1, 1] }, { id: "upper-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 18, guideVisible: true, bodyVisible: true },
      { id: "right-shoulder", x: 378, y: 224, radius: 24, axes: [{ id: "torso", angle: -90, pointSides: [-1, 1] }, { id: "upper-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 22, guideVisible: true, bodyVisible: true },
      { id: "left-elbow", x: 222, y: 320, radius: 24, axes: [{ id: "upper-arm", angle: 0, pointSides: [-1, 1] }, { id: "lower-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 18, guideVisible: true, bodyVisible: true },
      { id: "right-elbow", x: 378, y: 320, radius: 24, axes: [{ id: "upper-arm", angle: 0, pointSides: [-1, 1] }, { id: "lower-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 22, guideVisible: true, bodyVisible: true },
      { id: "left-wrist", x: 222, y: 416, radius: 24, axes: [{ id: "lower-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 18, guideVisible: true, bodyVisible: true },
      { id: "right-wrist", x: 378, y: 416, radius: 24, axes: [{ id: "lower-arm", angle: 0, pointSides: [-1, 1] }], renderOrder: 22, guideVisible: true, bodyVisible: true },
      { id: "left-hip", x: 270, y: 380, radius: 30, axes: [{ id: "pelvis", angle: 0, pointSides: [-1, 1] }, { id: "upper-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 14, guideVisible: true, bodyVisible: true },
      { id: "right-hip", x: 330, y: 380, radius: 30, axes: [{ id: "pelvis", angle: 0, pointSides: [-1, 1] }, { id: "upper-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 16, guideVisible: true, bodyVisible: true },
      { id: "left-knee", x: 270, y: 500, radius: 30, axes: [{ id: "upper-leg", angle: 0, pointSides: [-1, 1] }, { id: "lower-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 14, guideVisible: true, bodyVisible: true },
      { id: "right-knee", x: 330, y: 500, radius: 30, axes: [{ id: "upper-leg", angle: 0, pointSides: [-1, 1] }, { id: "lower-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 16, guideVisible: true, bodyVisible: true },
      { id: "left-ankle", x: 270, y: 650, radius: 30, axes: [{ id: "lower-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 14, guideVisible: true, bodyVisible: true },
      { id: "right-ankle", x: 330, y: 650, radius: 30, axes: [{ id: "lower-leg", angle: 0, pointSides: [-1, 1] }], renderOrder: 16, guideVisible: true, bodyVisible: true },
    ],
    faces: [
      {
        id: "neck",
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
        vertices: [
          { jointId: "waist", axisId: "pelvis", side: -1 },
          { jointId: "waist", axisId: "pelvis", side: 1 },
          { jointId: "right-hip", axisId: "pelvis", side: 1 },
          { jointId: "right-hip", axisId: "pelvis", side: -1 },
          { jointId: "left-hip", axisId: "pelvis", side: 1 },
          { jointId: "left-hip", axisId: "pelvis", side: -1 },
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
