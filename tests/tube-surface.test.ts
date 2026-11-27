import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { renderSvgEditor } from "../src/editor/svg-editor.ts";
import type { EditorViewState } from "../src/editor/types.ts";
import { getCameraFacingLimbSurface, getJointTubeSurface, getJointViewRadius, getJointWorldTransform, getProjectedCircleConnectionSurface, getProjectedTubeGeometry, PROJECTION_ORIGIN, projectPoint, projectSphereCircle } from "../src/rig/geometry.ts";
import { RigState } from "../src/rig/rig-state.ts";

test("limb tube creates circular eight-sided surfaces from joint x/y/z coordinates", () => {
  const rig = createDefaultRig();
  const shoulder = rig.joints.find((joint) => joint.id === "left-shoulder")!;
  const elbow = rig.joints.find((joint) => joint.id === "left-elbow")!;
  elbow.z = 48;
  const surface = getJointTubeSurface(rig, shoulder.id, elbow.id);

  assert.equal(surface.length, 8);
  for (const quad of surface) {
    for (const point of [quad.points[0], quad.points[1]]) {
      const distance = Math.hypot(point.x - 240, point.y - 224, point.z - shoulder.z);
      assert.ok(Math.abs(distance - shoulder.radius) < 1e-8);
    }
  }
  assert.ok(surface.some((quad) => quad.points.some((point) => point.z !== 0)));
});

test("perspective strength changes projection only and does not rotate the authored limb surface", () => {
  const rig = createDefaultRig();
  rig.viewYRotation = 35;
  rig.worldRotation = { x: 18, y: -27, z: 12 };
  rig.projectionStrength = 0;
  const flatSurface = getCameraFacingLimbSurface(rig, "left-shoulder", "left-elbow")!;
  const flatTube = getJointTubeSurface(rig, "left-shoulder", "left-elbow");

  rig.projectionStrength = 100;
  const perspectiveSurface = getCameraFacingLimbSurface(rig, "left-shoulder", "left-elbow")!;
  const perspectiveTube = getJointTubeSurface(rig, "left-shoulder", "left-elbow");

  assert.deepEqual(perspectiveSurface.points, flatSurface.points);
  assert.deepEqual(
    perspectiveTube.map((quad) => quad.points),
    flatTube.map((quad) => quad.points),
  );
  assert.notDeepEqual(
    perspectiveSurface.points.map((point) => projectPoint(rig, point, point.z)),
    flatSurface.points.map((point) => projectPoint({ ...rig, projectionStrength: 0 }, point, point.z)),
  );
});

test("world Z rotation is applied exactly once to limb centres and surface sections", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  rig.viewYRotation = 0;
  rig.worldRotation = { x: 0, y: 0, z: 0 };
  const unrotated = getCameraFacingLimbSurface(rig, "left-shoulder", "left-elbow")!.points
    .map((point) => projectPoint(rig, point, point.z));

  rig.worldRotation = { x: 0, y: 0, z: 90 };
  const rotated = getCameraFacingLimbSurface(rig, "left-shoulder", "left-elbow")!.points
    .map((point) => projectPoint(rig, point, point.z));
  const expected = unrotated.map((point) => ({
    x: PROJECTION_ORIGIN.x - (point.y - PROJECTION_ORIGIN.y),
    y: PROJECTION_ORIGIN.y + (point.x - PROJECTION_ORIGIN.x),
  }));

  rotated.forEach((point, index) => {
    assert.ok(Math.abs(point.x - expected[index].x) < 1e-8);
    assert.ok(Math.abs(point.y - expected[index].y) < 1e-8);
  });
});

test("X and Y world rotations use the shared sphere projection in actual SVG output", () => {
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  for (const worldRotation of [{ x: 32, y: 0, z: 0 }, { x: 0, y: -57, z: 0 }]) {
    const rig = createDefaultRig();
    rig.worldRotation = worldRotation;
    rig.projectionStrength = 35;
    const host = { innerHTML: "" } as SVGSVGElement;
    renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

    const match = host.innerHTML.match(/<circle class="body-joint" data-body-joint data-joint-id="left-elbow" cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/);
    assert.ok(match, `missing projected elbow at ${JSON.stringify(worldRotation)}`);
    const joint = rig.joints.find((candidate) => candidate.id === "left-elbow")!;
    const world = getJointWorldTransform(rig, joint.id);
    const bodyRadius = (joint.bodyRadius ?? joint.radius) * getJointViewRadius(rig, joint) / joint.radius;
    const expected = projectSphereCircle(rig, world, joint.z, bodyRadius);

    assert.ok(Math.abs(Number(match[1]) - expected.center.x) < 1e-8);
    assert.ok(Math.abs(Number(match[2]) - expected.center.y) < 1e-8);
    assert.ok(Math.abs(Number(match[3]) - expected.radius) < 1e-8);
    assert.match(host.innerHTML, /data-face-id="left-upper-arm"/);
    assert.doesNotMatch(host.innerHTML, /(?:NaN|Infinity)/);
  }
});

test("far body parts do not erase a nearer joint outline", () => {
  const rig = createDefaultRig();
  rig.worldRotation = { x: 0, y: -79, z: 0 };
  rig.projectionStrength = 35;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  const maskFor = (jointId: string) => host.innerHTML.match(new RegExp(
    `<mask[^>]*data-outline-mask-joint-id="${jointId}"[^>]*>([\\s\\S]*?)<\\/mask>`,
  ))?.[1] ?? "";
  const nearMask = maskFor("right-wrist");
  const farMask = maskFor("left-wrist");

  assert.ok(nearMask);
  assert.ok(farMask);
  assert.doesNotMatch(nearMask, /data-mask-joint-id="left-wrist"/);
  assert.doesNotMatch(nearMask, /data-mask-face-id="left-lower-arm"/);
  assert.match(farMask, /data-mask-joint-id="right-wrist"/);
  assert.match(host.innerHTML, /body-joint-outline[^>]*mask="url\(#joint-outline-mask-/);
  assert.doesNotMatch(host.innerHTML, /body-occlusion-mask-/);
});

test("connected tubes always erase their shared interior joint arcs", () => {
  const rig = createDefaultRig();
  const elbow = rig.joints.find((joint) => joint.id === "left-elbow")!;
  const shoulder = rig.joints.find((joint) => joint.id === "left-shoulder")!;
  // Put the joints above their attached surfaces in authored layer order.
  // Connectivity must still remove the interior seam.
  elbow.renderOrder = 1000;
  shoulder.renderOrder = 1000;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  const maskFor = (jointId: string) => host.innerHTML.match(new RegExp(
    `<mask[^>]*data-outline-mask-joint-id="${jointId}"[^>]*>([\\s\\S]*?)<\\/mask>`,
  ))?.[1] ?? "";

  assert.match(maskFor("left-elbow"), /data-mask-face-id="left-upper-arm"/);
  assert.match(maskFor("left-elbow"), /data-mask-face-id="left-lower-arm"/);
  assert.match(maskFor("left-shoulder"), /data-mask-surface-id="peer-capsule:shoulder-band"/);
  assert.match(maskFor("left-shoulder"), /data-mask-surface-id="torso-surface"/);
});

test("projected circle connections follow the two common external tangents", () => {
  const start = { x: 80, y: 120 };
  const end = { x: 230, y: 210 };
  const startRadius = 24;
  const endRadius = 38;
  const points = getProjectedCircleConnectionSurface(start, end, startRadius, endRadius)!;

  for (const [startPoint, endPoint] of [[points[0], points[1]], [points[3], points[2]]] as const) {
    const edge = { x: endPoint.x - startPoint.x, y: endPoint.y - startPoint.y };
    const startNormal = { x: startPoint.x - start.x, y: startPoint.y - start.y };
    const endNormal = { x: endPoint.x - end.x, y: endPoint.y - end.y };
    assert.ok(Math.abs(Math.hypot(startNormal.x, startNormal.y) - startRadius) < 1e-8);
    assert.ok(Math.abs(Math.hypot(endNormal.x, endNormal.y) - endRadius) < 1e-8);
    assert.ok(Math.abs(startNormal.x * edge.x + startNormal.y * edge.y) < 1e-8);
    assert.ok(Math.abs(endNormal.x * edge.x + endNormal.y * edge.y) < 1e-8);
  }
});

test("equal projected radii retain the perpendicular capsule rule", () => {
  assert.deepEqual(
    getProjectedCircleConnectionSurface({ x: 0, y: 0 }, { x: 0, y: 40 }, 10, 10),
    [{ x: -10, y: 0 }, { x: -10, y: 40 }, { x: 10, y: 40 }, { x: 10, y: 0 }],
  );
});

test("tube side silhouettes and terminal caps share the same projected 3D rings", () => {
  const rig = createDefaultRig();
  rig.viewYRotation = 37;
  rig.worldRotation = { x: 24, y: -31, z: 13 };
  rig.projectionStrength = 48;
  const geometry = getProjectedTubeGeometry(
    rig,
    { x: 120, y: 160, z: -18 },
    { x: 245, y: 285, z: 52 },
    18,
    31,
  );

  assert.ok(geometry);
  assert.ok(geometry.startSection.includes(geometry.side[0]));
  assert.ok(geometry.endSection.includes(geometry.side[1]));
  assert.ok(geometry.endSection.includes(geometry.side[2]));
  assert.ok(geometry.startSection.includes(geometry.side[3]));
  assert.notEqual(geometry.side[0], geometry.side[3]);
  assert.notEqual(geometry.side[1], geometry.side[2]);
});

test("bent legs retain camera-exposed inner outlines on every limb segment", () => {
  const rig = createDefaultRig();
  const leftKnee = rig.joints.find((joint) => joint.id === "left-knee")!;
  const rightKnee = rig.joints.find((joint) => joint.id === "right-knee")!;
  const leftAnkle = rig.joints.find((joint) => joint.id === "left-ankle")!;
  const rightAnkle = rig.joints.find((joint) => joint.id === "right-ankle")!;
  leftKnee.x -= 34;
  rightKnee.x += 26;
  leftAnkle.x += 18;
  rightAnkle.x -= 12;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  for (const faceId of ["left-upper-leg", "left-lower-leg", "right-upper-leg", "right-lower-leg"]) {
    assert.match(host.innerHTML, new RegExp(`data-face-id="${faceId}"[\\s\\S]*?data-face-outline-id="${faceId}"`));
  }
  assert.doesNotMatch(host.innerHTML, /data-leg-gap-outline/);
  for (const jointId of ["left-knee", "right-knee"]) {
    const crease = host.innerHTML.match(new RegExp(
      `<path[^>]*data-bend-crease-joint-id="${jointId}"[^>]*d="([^"]+)"`,
    ))?.[1] ?? "";
    assert.ok((crease.match(/L /g) ?? []).length >= 3, `incomplete bend crease for ${jointId}`);
    assert.match(host.innerHTML, new RegExp(`data-bend-mask-joint-id="${jointId}"`));
  }
});

test("leg outlines stay inside their depth-masked surface items", () => {
  const rig = createDefaultRig();
  for (const jointId of ["left-hip", "left-knee", "left-ankle"]) {
    rig.joints.find((joint) => joint.id === jointId)!.z = -30;
  }
  for (const jointId of ["right-hip", "right-knee", "right-ankle"]) {
    rig.joints.find((joint) => joint.id === jointId)!.z = 30;
  }
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.doesNotMatch(host.innerHTML, /data-leg-gap-outline/);
  for (const faceId of ["left-upper-leg", "right-upper-leg"]) {
    assert.match(host.innerHTML, new RegExp(
      `<g class="body-face-item"[^>]*>[\\s\\S]*?data-face-id="${faceId}"[\\s\\S]*?data-face-outline-id="${faceId}"`,
    ));
  }
});

test("camera-facing limb uses the apparent sphere circles instead of authored axis endpoints", () => {
  const rig = createDefaultRig();
  const surface = getCameraFacingLimbSurface(rig, "left-shoulder", "left-elbow")!;
  const shoulder = rig.joints.find((joint) => joint.id === "left-shoulder")!;
  const first = surface.points[0];
  const last = surface.points[3];

  assert.equal(first.x, last.x);
  assert.equal(first.z, last.z);
  assert.equal(Math.abs(first.y - last.y), shoulder.radius * 2);

  rig.viewYRotation = 90;
  const sideSurface = getCameraFacingLimbSurface(rig, "left-shoulder", "left-elbow")!;
  const sideFirst = projectPoint(rig, sideSurface.points[0], sideSurface.points[0].z);
  const sideLast = projectPoint(rig, sideSurface.points[3], sideSurface.points[3].z);
  assert.ok(Math.abs(sideFirst.x - sideLast.x) > 1);
  assert.ok(Math.abs(sideFirst.y - sideLast.y) < 1e-8);
});

test("saved standard rigs migrate their limb faces to camera-facing rendering", () => {
  const rig = createDefaultRig();
  for (const face of rig.faces) delete face.cameraFacingLimb;
  new RigState(rig);
  assert.deepEqual(rig.faces.find((face) => face.id === "left-upper-arm")?.cameraFacingLimb, {
    startJointId: "left-shoulder", endJointId: "left-elbow",
  });
  assert.deepEqual(rig.faces.find((face) => face.id === "neck")?.cameraFacingLimb, {
    startJointId: "chest", endJointId: "head",
  });
});

test("neck uses the same camera-facing cylinder boundary as limbs", () => {
  const rig = createDefaultRig();
  const chest = rig.joints.find((joint) => joint.id === "chest")!;
  const head = rig.joints.find((joint) => joint.id === "head")!;
  chest.radius = 20;
  head.radius = 12;
  head.z = 36;

  const surface = getCameraFacingLimbSurface(rig, "chest", "head")!;

  assert.ok(surface);
  assert.ok(Math.abs(Math.hypot(
    surface.points[0].x - surface.points[3].x,
    surface.points[0].y - surface.points[3].y,
    surface.points[0].z - surface.points[3].z,
  ) - chest.radius * 2) < 1e-8);
  assert.ok(Math.abs(Math.hypot(
    surface.points[1].x - surface.points[2].x,
    surface.points[1].y - surface.points[2].y,
    surface.points[1].z - surface.points[2].z,
  ) - head.radius * 2) < 1e-8);
});

test("head sphere clips only the neck surface that passes behind it", () => {
  const rig = createDefaultRig();
  rig.worldRotation = { x: 18, y: -42, z: -34 };
  rig.projectionStrength = 35;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.match(host.innerHTML, /<mask[^>]*data-surface-occlusion-face-id="neck"/);
  assert.match(host.innerHTML, /data-surface-depth-occluder/);
  assert.match(host.innerHTML, /data-connected-sphere-outline-face-id="neck"/);
  assert.match(host.innerHTML, /body-face-outline[^>]*mask="url\(#connected-sphere-outline-mask-neck\)"/);
  assert.match(host.innerHTML, /<mask[^>]*data-polygon-tube-occlusion-face-id="neck"/);
  assert.match(host.innerHTML, /data-polygon-depth-occluder="(?:peer-capsule:shoulder-band|torso-surface)"/);
  assert.match(host.innerHTML, /<g mask="url\(#polygon-tube-occlusion-mask-neck\)">[\s\S]*?data-face-outline-id="neck"/);
  assert.doesNotMatch(host.innerHTML, /torso-connection-outline-mask-neck/);
  assert.match(host.innerHTML, /<g class="body-face-item" mask="url\(#surface-occlusion-mask-neck\)">[\s\S]*?data-face-id="neck"/);
  const intersection = host.innerHTML.match(/data-surface-intersection-face-id="neck" d="([^"]+)"/)?.[1] ?? "";
  assert.match(intersection, /^M [^Q]+ Q /);
  assert.doesNotMatch(intersection, / L /);
  assert.doesNotMatch(host.innerHTML, /data-tube-section-face-id="neck"/);
  assert.doesNotMatch(host.innerHTML, /data-surface-occlusion-face-id="left-upper-arm"/);
});

test("polygon-to-tube occlusion is driven by surface references instead of the neck face id", () => {
  const rig = createDefaultRig();
  rig.faces.find((face) => face.id === "neck")!.id = "cervical-tube";
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.match(host.innerHTML, /data-polygon-tube-occlusion-face-id="cervical-tube"/);
  assert.match(host.innerHTML, /mask="url\(#polygon-tube-occlusion-mask-cervical-tube\)"/);
  assert.doesNotMatch(host.innerHTML, /torso-connection-outline-mask-neck/);
});

test("a torso polygon behind the neck does not erase the nearer tube", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  for (const jointId of ["left-shoulder", "right-shoulder", "waist"]) {
    rig.joints.find((joint) => joint.id === jointId)!.z = -200;
  }
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  const neckMask = host.innerHTML.match(
    /<mask[^>]*data-polygon-tube-occlusion-face-id="neck"[^>]*>([\s\S]*?)<\/mask>/,
  )?.[1] ?? "";
  assert.doesNotMatch(neckMask, /data-polygon-depth-occluder="(?:peer-capsule:shoulder-band|torso-surface)"/);
});

test("head sphere and an unrelated arm use the shared surface-depth rule", () => {
  const render = (armDepth: number) => {
    const rig = createDefaultRig();
    const head = rig.joints.find((joint) => joint.id === "head")!;
    const shoulder = rig.joints.find((joint) => joint.id === "left-shoulder")!;
    const elbow = rig.joints.find((joint) => joint.id === "left-elbow")!;
    shoulder.x = -90;
    shoulder.y = head.y;
    shoulder.z = armDepth;
    elbow.x = 180;
    elbow.y = 0;
    elbow.z = armDepth;
    const host = { innerHTML: "" } as SVGSVGElement;
    const viewState: EditorViewState = {
      outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
      inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
      paintPaletteId: null,
    };
    renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
    return host.innerHTML;
  };

  const armBehind = render(-45);
  const armMask = armBehind.match(/<mask[^>]*data-tube-occlusion-face-id="left-upper-arm"[^>]*>([\s\S]*?)<\/mask>/)?.[1] ?? "";
  assert.match(armMask, /data-tube-depth-occluder="shape:head-base"/);

  const armInFront = render(45);
  const headMask = armInFront.match(/<mask[^>]*data-sphere-surface-occlusion-id="shape:head-base"[^>]*>([\s\S]*?)<\/mask>/)?.[1] ?? "";
  assert.match(headMask, /data-sphere-tube-occluder="left-upper-arm"/);
});

test("terminal tube sections render a projected cap or a stable edge line", () => {
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };
  const edgeOnRig = createDefaultRig();
  const edgeOnHost = { innerHTML: "" } as SVGSVGElement;
  renderSvgEditor(edgeOnHost, edgeOnRig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.doesNotMatch(edgeOnHost.innerHTML, /data-tube-section-face-id="left-lower-arm"/);

  edgeOnRig.joints.find((joint) => joint.id === "left-wrist")!.bodyVisible = false;
  renderSvgEditor(edgeOnHost, edgeOnRig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.match(edgeOnHost.innerHTML, /data-tube-section-face-id="left-lower-arm" data-tube-end-curvature/);
  assert.match(edgeOnHost.innerHTML, /data-tube-side-end/);
  assert.match(edgeOnHost.innerHTML, /tube-end-curvature-outline/);
  assert.doesNotMatch(edgeOnHost.innerHTML, /data-bridge-joint-id="left-wrist"/);

  const facingRig = createDefaultRig();
  const facingWrist = facingRig.joints.find((joint) => joint.id === "left-wrist")!;
  facingWrist.z = 45;
  facingWrist.bodyVisible = false;
  const facingHost = { innerHTML: "" } as SVGSVGElement;
  renderSvgEditor(facingHost, facingRig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.match(facingHost.innerHTML, /data-tube-section-face-id="left-lower-arm"[\s\S]*?data-tube-section-cap/);
  assert.match(facingHost.innerHTML, /tube-section-outline/);

  const shallowFacingRig = createDefaultRig();
  const shallowFacingWrist = shallowFacingRig.joints.find((joint) => joint.id === "left-wrist")!;
  shallowFacingWrist.z = 2;
  shallowFacingWrist.bodyVisible = false;
  const shallowFacingHost = { innerHTML: "" } as SVGSVGElement;
  renderSvgEditor(shallowFacingHost, shallowFacingRig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  const shallowFacingSection = shallowFacingHost.innerHTML.match(
    /<g class="([^"]*)" data-tube-section-face-id="left-lower-arm"[^>]*>([\s\S]*?)<\/g>/,
  );
  assert.ok(shallowFacingSection);
  assert.doesNotMatch(shallowFacingSection[1], /body-tube-side-end/);
  assert.match(shallowFacingSection[2], /data-tube-section-cap/);

  const awayRig = createDefaultRig();
  const awayWrist = awayRig.joints.find((joint) => joint.id === "left-wrist")!;
  awayWrist.z = -45;
  awayWrist.bodyVisible = false;
  const awayHost = { innerHTML: "" } as SVGSVGElement;
  renderSvgEditor(awayHost, awayRig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.match(awayHost.innerHTML, /data-tube-end-curvature/);
  assert.match(awayHost.innerHTML, /data-tube-side-end/);
  assert.doesNotMatch(awayHost.innerHTML, /data-tube-section-cap/);
});

test("terminal tube caps receive local depth masks outside the side surface", () => {
  const rig = createDefaultRig();
  const wrist = rig.joints.find((joint) => joint.id === "left-wrist")!;
  wrist.z = 45;
  wrist.bodyVisible = false;
  const wristWorld = getJointWorldTransform(rig, wrist.id);
  const chestWorld = getJointWorldTransform(rig, "chest");
  const head = rig.joints.find((joint) => joint.id === "head")!;
  head.x = wristWorld.x - chestWorld.x;
  head.y = wristWorld.y - chestWorld.y;
  head.z = 120;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  const mask = host.innerHTML.match(/<mask[^>]*data-tube-occlusion-face-id="left-lower-arm"[^>]*>([\s\S]*?)<\/mask>/)?.[1] ?? "";
  assert.match(mask, /data-tube-depth-occluder="shape:head-base" data-tube-end-cap-occluder/);
});

test("overlapping legs resolve visibility from local tube surface depth", () => {
  const rig = createDefaultRig();
  const leftHip = rig.joints.find((joint) => joint.id === "left-hip")!;
  const rightHip = rig.joints.find((joint) => joint.id === "right-hip")!;
  rightHip.x = leftHip.x;
  for (const jointId of ["right-hip", "right-knee", "right-ankle"]) {
    rig.joints.find((joint) => joint.id === jointId)!.z = 40;
  }
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  const leftMask = host.innerHTML.match(/<mask[^>]*data-tube-occlusion-face-id="left-upper-leg"[^>]*>([\s\S]*?)<\/mask>/)?.[1] ?? "";
  assert.match(leftMask, /data-tube-depth-occluder="right-upper-leg"/);
  assert.match(host.innerHTML, /data-face-id="left-upper-leg"[\s\S]*?mask="url\(#tube-surface-occlusion-mask-left-upper-leg\)"|mask="url\(#tube-surface-occlusion-mask-left-upper-leg\)"[\s\S]*?data-face-id="left-upper-leg"/);
});

test("crossing leg tubes switch the visible surface inside the overlap", () => {
  const rig = createDefaultRig();
  const set = (jointId: string, x: number, z: number) => {
    const joint = rig.joints.find((candidate) => candidate.id === jointId)!;
    joint.x = x;
    joint.z = z;
  };
  set("left-hip", -20, -35);
  set("left-knee", 40, 35);
  set("right-hip", 20, 35);
  set("right-knee", -40, -35);
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  const leftMask = host.innerHTML.match(/<mask[^>]*data-tube-occlusion-face-id="left-upper-leg"[^>]*>([\s\S]*?)<\/mask>/)?.[1] ?? "";
  const rightMask = host.innerHTML.match(/<mask[^>]*data-tube-occlusion-face-id="right-upper-leg"[^>]*>([\s\S]*?)<\/mask>/)?.[1] ?? "";
  assert.match(leftMask, /data-tube-depth-occluder="right-upper-leg"/);
  assert.match(rightMask, /data-tube-depth-occluder="left-upper-leg"/);
});

test("leg tubes and unrelated leg joints occlude each other by surface depth", () => {
  const render = (jointDepth: number) => {
    const rig = createDefaultRig();
    const leftHip = getJointWorldTransform(rig, "left-hip");
    const leftKnee = getJointWorldTransform(rig, "left-knee");
    const rightKnee = rig.joints.find((joint) => joint.id === "right-knee")!;
    const rightHip = rig.joints.find((joint) => joint.id === "right-hip")!;
    rightKnee.x = (leftHip.x + leftKnee.x) / 2 - getJointWorldTransform(rig, "right-hip").x;
    rightKnee.y = (leftHip.y + leftKnee.y) / 2 - getJointWorldTransform(rig, "right-hip").y;
    rightHip.z = jointDepth;
    rightKnee.z = jointDepth;
    const host = { innerHTML: "" } as SVGSVGElement;
    const viewState: EditorViewState = {
      outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
      inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
      paintPaletteId: null,
    };
    renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
    return host.innerHTML;
  };

  const jointInFront = render(50);
  const tubeMask = jointInFront.match(/<mask[^>]*data-tube-occlusion-face-id="left-upper-leg"[^>]*>([\s\S]*?)<\/mask>/)?.[1] ?? "";
  assert.match(tubeMask, /data-tube-depth-occluder="joint:right-knee"/);

  const jointBehind = render(-50);
  const jointMask = jointBehind.match(/<mask[^>]*data-sphere-surface-occlusion-id="joint:right-knee"[^>]*>([\s\S]*?)<\/mask>/)?.[1] ?? "";
  assert.match(jointMask, /data-sphere-tube-occluder="left-upper-leg"/);
});

test("virtual peer capsule replaces the authored shoulder band with a camera-facing bridge", () => {
  const rig = createDefaultRig();
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: "shoulder-band", selectedTarget: "face",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.equal(host.innerHTML.match(/<polygon[^>]*data-peer-capsule(?:\s|>)/g)?.length, 2);
  assert.match(host.innerHTML, /data-peer-group-id="shoulder-band" data-face-id="shoulder-band"/);
  assert.match(host.innerHTML, /data-peer-group-id="hip-band"/);
  assert.equal(host.innerHTML.match(/data-face-id="shoulder-band"/g)?.length, 1);
});

test("hip capsule exposes only the lower boundary left between separated legs", () => {
  const render = (spread: number) => {
    const rig = createDefaultRig();
    rig.joints.find((joint) => joint.id === "left-hip")!.x -= spread;
    rig.joints.find((joint) => joint.id === "right-hip")!.x += spread;
    const host = { innerHTML: "" } as SVGSVGElement;
    const viewState: EditorViewState = {
      outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
      inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
      paintPaletteId: null,
    };
    renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
    return host.innerHTML;
  };

  const touchingPath = render(0).match(/data-peer-capsule-outline="hip-band" d="([^"]+)"/)?.[1] ?? "";
  assert.equal((touchingPath.match(/M /g) ?? []).length, 1);
  const separatedPath = render(18).match(/data-peer-capsule-outline="hip-band" d="([^"]+)"/)?.[1] ?? "";
  assert.equal((separatedPath.match(/M /g) ?? []).length, 2);
  assert.doesNotMatch(separatedPath, /(?:NaN|Infinity)/);
});

test("capsule guides show actual joints and faint virtual peer capsules together", () => {
  const rig = createDefaultRig();
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  for (const jointId of ["waist", "left-shoulder", "right-shoulder"]) {
    assert.match(host.innerHTML, new RegExp(`data-joint-capsule-guide\\s+data-joint-id="${jointId}"`));
  }
  for (const groupId of ["shoulder-band", "hip-band"]) {
    assert.match(host.innerHTML,
      new RegExp(`data-virtual-capsule-guide[^>]*data-peer-group-id="${groupId}"`));
  }
  assert.match(host.innerHTML, /data-guide-joint-id="left-hip"/);
  assert.match(host.innerHTML, /data-guide-joint-id="right-hip"/);
});

test("capsule internals appear only for the selected actual or virtual capsule", () => {
  const rig = createDefaultRig();
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.doesNotMatch(host.innerHTML, /data-capsule-internal-joint/);
  assert.doesNotMatch(host.innerHTML, /class="peer-center"/);
  assert.doesNotMatch(host.innerHTML, /virtual-joint-(?:hit|outline)/);
  assert.doesNotMatch(host.innerHTML, /data-guide-joint-id="pelvis-pivot"/);

  renderSvgEditor(host, rig, { jointId: "waist", axisId: null, jointIds: ["waist"] }, viewState);
  assert.equal(host.innerHTML.match(/data-capsule-id="waist"/g)?.length, 2);

  renderSvgEditor(host, rig, {
    jointId: "left-shoulder", axisId: null, jointIds: ["left-shoulder", "right-shoulder"],
  }, viewState);
  assert.equal(host.innerHTML.match(/data-capsule-id="shoulder-band"/g)?.length, 2);
  assert.doesNotMatch(host.innerHTML, /data-capsule-id="left-shoulder"/);

  renderSvgEditor(host, rig, {
    jointId: "left-hip", axisId: null, jointIds: ["left-hip", "right-hip"],
  }, viewState);
  assert.equal(host.innerHTML.match(/data-capsule-id="hip-band"/g)?.length, 2);
});

test("torso surface connects the actual shoulder band to the rotated waist section", () => {
  const rig = createDefaultRig();
  const left = rig.joints.find((joint) => joint.id === "left-shoulder")!;
  const right = rig.joints.find((joint) => joint.id === "right-shoulder")!;
  const waist = rig.joints.find((joint) => joint.id === "waist")!;
  left.y -= 12;
  left.z = -18;
  right.y += 12;
  right.z = 18;
  waist.localRotation = 20;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: "torso", selectedTarget: "face",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.equal(host.innerHTML.match(/data-face-id="torso" data-torso-surface/g)?.length, 1);
  assert.equal(host.innerHTML.match(/class="body-face is-selected"/g)?.length, 1);
  assert.doesNotMatch(host.innerHTML, /data-face-id="torso-strip"/);
});

test("waist-to-hip surface follows its referenced sections instead of anatomical group ids", () => {
  const rig = createDefaultRig();
  const hipGroup = rig.peerGroups.find((group) => group.id === "hip-band")!;
  hipGroup.id = "pelvis-section";
  const waistHipFace = rig.faces.find((face) => face.id === "waist-hip")!;
  waistHipFace.proceduralConnection = {
    start: { type: "joint", jointId: "waist" },
    end: { type: "peer-group", peerGroupId: hipGroup.id },
  };
  waistHipFace.rotationTarget = {
    type: "peer", peerGroupId: hipGroup.id, referenceJointId: hipGroup.jointIds[0],
  };
  const waist = rig.joints.find((joint) => joint.id === "waist")!;
  const leftHip = rig.joints.find((joint) => joint.id === "left-hip")!;
  const rightHip = rig.joints.find((joint) => joint.id === "right-hip")!;
  waist.localRotation = 12;
  waist.localRotationY = 28;
  leftHip.z = -18;
  rightHip.z = 18;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: "waist-hip", selectedTarget: "face",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.equal(host.innerHTML.match(/data-face-id="waist-hip" data-waist-hip-surface/g)?.length, 1);
  assert.equal(host.innerHTML.match(/class="body-face is-selected" data-face-id="waist-hip"/g)?.length, 3);
  assert.equal(host.innerHTML.match(/data-waist-hip-tube=/g)?.length, 2);
  const waistHipOutline = host.innerHTML.match(/<path class="body-face-outline"[^>]*data-waist-hip-outline[^>]*>/)?.[0] ?? "";
  assert.equal((waistHipOutline.match(/M /g) ?? []).length, 2);
  assert.doesNotMatch(host.innerHTML, /(?:NaN|Infinity)/);
});

test("profile capsules and torso exteriors render outlines", () => {
  const rig = createDefaultRig();
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.match(host.innerHTML, /data-joint-outline data-joint-id="waist"/);
  assert.match(host.innerHTML, /data-joint-outline data-joint-id="left-shoulder"/);
  assert.match(host.innerHTML, /data-face-outline data-face-id="torso"[^>]*mask="url\(#torso-connection-outline-mask-torso\)"/);
  assert.match(host.innerHTML, /data-face-outline data-face-id="waist-hip"[^>]*mask="url\(#torso-connection-outline-mask-waist-hip\)"/);
  assert.match(host.innerHTML, /data-face-outline data-peer-group-id="shoulder-band"[^>]*mask="url\(#torso-connection-outline-mask-shoulder-band\)"/);
});

test("torso outlines mask only sibling group surfaces", () => {
  const rig = createDefaultRig();
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.match(host.innerHTML, /data-face-id="torso" data-torso-surface/);
  assert.match(host.innerHTML, /id="torso-connection-outline-mask-torso"/);
  assert.match(host.innerHTML, /id="torso-connection-outline-mask-waist-hip"/);
});

test("group order resolves per-item layer order at equal camera distance", () => {
  const rig = createDefaultRig();
  rig.groups.find((group) => group.id === "torso")!.order = -100;
  rig.groups.find((group) => group.id === "left-arm")!.order = 100;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.ok(host.innerHTML.indexOf('data-face-id="torso"') < host.innerHTML.indexOf('data-face-id="left-upper-arm"'));
});

test("camera distance orders overlapping items inside one group before layer order", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  rig.joints.find((joint) => joint.id === "left-shoulder")!.z = -90;
  rig.joints.find((joint) => joint.id === "left-elbow")!.z = -60;
  rig.joints.find((joint) => joint.id === "left-wrist")!.z = 120;
  rig.faces.find((face) => face.id === "left-upper-arm")!.layerOrder = 100;
  rig.faces.find((face) => face.id === "left-lower-arm")!.layerOrder = 0;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.ok(host.innerHTML.indexOf('data-face-id="left-upper-arm"') < host.innerHTML.indexOf('data-face-id="left-lower-arm"'));
});

test("camera distance takes precedence over group order", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  rig.groups.find((group) => group.id === "left-arm")!.order = -100;
  rig.groups.find((group) => group.id === "right-arm")!.order = 100;
  rig.joints.find((joint) => joint.id === "left-shoulder")!.z = 120;
  rig.joints.find((joint) => joint.id === "left-elbow")!.z = 120;
  rig.joints.find((joint) => joint.id === "right-shoulder")!.z = -120;
  rig.joints.find((joint) => joint.id === "right-elbow")!.z = -120;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  assert.ok(host.innerHTML.indexOf('data-face-id="right-upper-arm"') < host.innerHTML.indexOf('data-face-id="left-upper-arm"'));
});

test("straight body connects equal waist and hip capsules without tapering", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.match(host.innerHTML,
    /data-waist-hip-center points="270,320 330,320 330,380 270,380"/);
  assert.match(host.innerHTML,
    /data-waist-hip-tube="0" points="240,320 240,380 300,380 300,320"/);
  assert.match(host.innerHTML,
    /data-waist-hip-tube="1" points="300,320 300,380 360,380 360,320"/);
});

test("straight torso keeps equal section widths through a Y-axis turn", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  rig.worldRotation = { x: 0, y: 45, z: 0 };
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
  const torsoPoints = host.innerHTML.match(/data-face-id="torso" data-torso-surface points="([^"]+)/)?.[1]
    .split(" ").map((point) => Number(point.split(",")[0]));
  assert.ok(torsoPoints);
  assert.ok(Math.abs((torsoPoints[0] - torsoPoints[1]) - (torsoPoints[3] - torsoPoints[2])) < 1e-8);
});

test("shoulder capsules use inner spheres for a straight torso and outer spheres for arm pivots", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.match(host.innerHTML, /data-joint-capsule data-joint-id="left-shoulder"/);
  assert.match(host.innerHTML, /data-joint-capsule data-joint-id="right-shoulder"/);
  assert.match(host.innerHTML, /data-body-joint data-joint-capsule data-joint-id="waist"/);
  assert.match(host.innerHTML,
    /data-face-id="torso" data-torso-surface points="360,224 240,224 240,320 360,320"/);
});

test("side-view torso exposes shoulder depth instead of collapsing its top edge", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  rig.viewYRotation = 90;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.match(host.innerHTML,
    /data-face-id="torso" data-torso-surface points="330,224 270,224 270,320 330,320"/);
});

test("shoulder hierarchy guides start at the rendered outer arm pivot", () => {
  const rig = createDefaultRig();
  rig.perspectiveEnabled = false;
  const host = { innerHTML: "" } as SVGSVGElement;
  const viewState: EditorViewState = {
    outlinesVisible: true, hideSameJointEdges: true, selectedFaceId: null, selectedTarget: "joint",
    inspectorTab: "selection", editBodyProportions: false, activeTool: "select", paintColor: "#dca27b",
    paintPaletteId: null,
  };

  renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);

  assert.match(host.innerHTML,
    /class="hierarchy-line" x1="390" y1="224" x2="486" y2="224"\s+data-child-rotation data-joint-id="right-elbow"/);
});
