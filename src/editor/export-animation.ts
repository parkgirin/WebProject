import {
  applyFixedOutputView,
  getPosePlaybackFrames,
  getPosePlaybackSettings,
  samplePosePlayback,
  type PoseClip,
} from "../rig/pose-interpolation.ts";
import type { Rig } from "../rig/types.ts";
import { getJointWorldTransform, projectPoint } from "../rig/geometry.ts";
import {
  canvasToPngBlob,
  createDrawingPngBlob,
  createDrawingSvgBlob,
  downloadBlob,
  DRAWING_EXPORT_SCALE,
  getDrawingContentBounds,
  type DrawingExportBounds,
} from "./export-image.ts";
import {
  createCenteredFrameBounds,
  createSpriteSheetLayout,
  getRigRootTranslation,
  placeRigRootAt,
} from "./sprite-sheet.ts";
import { renderSvgEditor } from "./svg-editor.ts";
import type { EditorViewState } from "./types.ts";
import { createStoredZip, type ZipEntry } from "./zip.ts";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export async function exportPoseAnimationFrames(
  clip: PoseClip,
  source: SVGSVGElement,
  outputView: Rig,
  viewState: EditorViewState,
  format: "png" | "svg",
): Promise<void> {
  const frames = getPosePlaybackFrames(clip);
  if (frames.length < 2) throw new Error("애니메이션 내보내기에는 키프레임이 두 개 이상 필요합니다.");
  const host = document.createElementNS(SVG_NAMESPACE, "svg");
  host.setAttribute("viewBox", source.getAttribute("viewBox") ?? "0 0 600 780");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:600px;height:780px;visibility:hidden";
  document.body.append(host);

  try {
    const digits = Math.max(4, String(frames.length - 1).length);
    const entries: ZipEntry[] = [];
    let animationBounds: DrawingExportBounds | null = null;
    for (const frame of frames) {
      const rig = applyFixedOutputView(samplePosePlayback(clip, frame).rig, outputView);
      renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
      animationBounds = mergeBounds(animationBounds, getDrawingContentBounds(host));
    }
    if (!animationBounds) throw new Error("애니메이션의 출력 영역을 계산할 수 없습니다.");
    for (let index = 0; index < frames.length; index += 1) {
      const rig = applyFixedOutputView(samplePosePlayback(clip, frames[index]).rig, outputView);
      renderSvgEditor(host, rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
      const name = `frames/frame_${String(index).padStart(digits, "0")}.${format}`;
      entries.push({
        name,
        data: format === "png" ? await createDrawingPngBlob(host, animationBounds) : createDrawingSvgBlob(host, animationBounds),
      });
    }
    entries.push({
      name: "animation.json",
      data: JSON.stringify({
        format: "pose-mesh-frame-sequence",
        version: 1,
        imageFormat: format,
        fps: clip.fps,
        frameCount: frames.length,
        width: Math.ceil(animationBounds.width * (format === "png" ? DRAWING_EXPORT_SCALE : 1)),
        height: Math.ceil(animationBounds.height * (format === "png" ? DRAWING_EXPORT_SCALE : 1)),
        bounds: animationBounds,
        playback: getPosePlaybackSettings(clip),
        files: frames.map((_, index) => `frames/frame_${String(index).padStart(digits, "0")}.${format}`),
      }, null, 2),
    });
    downloadBlob(await createStoredZip(entries), `${safeFileName(clip.name)}-${format}-frames.zip`);
  } finally {
    host.remove();
  }
}

export async function exportPoseAnimationSpriteSheet(
  clip: PoseClip,
  source: SVGSVGElement,
  outputView: Rig,
  viewState: EditorViewState,
): Promise<void> {
  const frames = getPosePlaybackFrames(clip);
  if (frames.length < 2) throw new Error("애니메이션 내보내기에는 키프레임이 두 개 이상 필요합니다.");
  const host = createAnimationRenderHost(source);
  try {
    const samples = frames.map((frame) => applyFixedOutputView(samplePosePlayback(clip, frame).rig, outputView));
    const referenceRoot = getRigRootTranslation(samples[0]);
    const manualPivot = outputView.outputPivot?.mode === "manual" ? outputView.outputPivot : null;
    const inspected = samples.map((rig, index) => {
      const root = getRigRootTranslation(rig);
      const inPlaceRig = placeRigRootAt(rig, referenceRoot);
      renderSvgEditor(host, inPlaceRig, { jointId: null, axisId: null, jointIds: [] }, viewState);
      return {
        frame: frames[index],
        rig: inPlaceRig,
        bounds: getDrawingContentBounds(host),
        chestX: getOutputJointPivot(inPlaceRig, "chest")?.x,
        groundY: getRenderedJointBottom(host, ["left-ankle", "right-ankle"]),
        boundPivot: manualPivot?.jointId ? getOutputJointPivot(inPlaceRig, manualPivot.jointId) : null,
        rootMotion: { x: root.x - referenceRoot.x, y: root.y - referenceRoot.y, z: root.z - referenceRoot.z },
      };
    });
    const mergedBounds = inspected.reduce<DrawingExportBounds | null>(
      (bounds, frame) => mergeBounds(bounds, frame.bounds), null,
    );
    if (!mergedBounds) throw new Error("애니메이션의 출력 영역을 계산할 수 없습니다.");
    const groundY = inspected.reduce((lowest, frame) => Math.max(
      lowest,
      frame.groundY ?? frame.bounds.y + frame.bounds.height,
    ), Number.NEGATIVE_INFINITY);
    const automaticPivot = {
      x: inspected[0].chestX ?? mergedBounds.x + mergedBounds.width / 2,
      y: groundY,
    };
    const pivotPoints = inspected.map((frame) => manualPivot
      ? frame.boundPivot ?? { x: manualPivot.x, y: manualPivot.y }
      : automaticPivot);
    const centeredBounds = createCenteredFrameBounds(inspected.map((frame, index) => ({
      bounds: frame.bounds,
      pivot: pivotPoints[index],
    })));
    const cellWidth = Math.ceil(centeredBounds.width * DRAWING_EXPORT_SCALE);
    const cellHeight = Math.ceil(centeredBounds.height * DRAWING_EXPORT_SCALE);
    const layout = createSpriteSheetLayout(frames.length, cellWidth, cellHeight);
    const maxDimension = 16384;
    if (layout.width > maxDimension || layout.height > maxDimension) {
      throw new Error(`스프라이트 시트가 ${maxDimension}px 한계를 넘습니다. 프레임 수나 출력 크기를 줄여주세요.`);
    }

    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable");
    for (let index = 0; index < inspected.length; index += 1) {
      const frame = inspected[index];
      renderSvgEditor(host, frame.rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
      const blob = await createDrawingPngBlob(host, centeredBounds.frames[index]);
      const image = await loadBlobImage(blob);
      const cell = layout.cells[index];
      context.drawImage(image, cell.x, cell.y, cell.width, cell.height);
    }
    const imageName = `${safeFileName(clip.name)}-sprite-sheet.png`;
    const metadataName = `${safeFileName(clip.name)}-sprite-sheet.json`;
    const durationMs = 1000 / clip.fps;
    const pivot = {
      x: cellWidth / 2,
      y: cellHeight / 2,
      xSource: manualPivot?.jointId ? "manual-joint" : manualPivot ? "manual" : inspected[0].chestX === undefined ? "bounds-center" : "reference-chest",
      ySource: manualPivot?.jointId ? "manual-joint" : manualPivot ? "manual" : inspected.some((frame) => frame.groundY !== undefined) ? "lowest-ankle" : "bounds-bottom",
      ...(manualPivot?.jointId ? { jointId: manualPivot.jointId } : {}),
    };
    const metadata = {
      format: "pose-mesh-sprite-sheet",
      version: 1,
      image: imageName,
      fps: clip.fps,
      playback: getPosePlaybackSettings(clip),
      frameCount: frames.length,
      durationMs,
      sheet: { width: layout.width, height: layout.height, columns: layout.columns, rows: layout.rows },
      cell: {
        width: cellWidth,
        height: cellHeight,
        bounds: {
          x: -centeredBounds.halfWidth,
          y: -centeredBounds.halfHeight,
          width: centeredBounds.width,
          height: centeredBounds.height,
          space: "pivot-relative",
        },
      },
      pivot,
      rootMotion: { space: "model", bakedIntoImage: false },
      outputView: {
        viewYRotation: outputView.viewYRotation,
        perspectiveEnabled: outputView.perspectiveEnabled !== false,
        projectionStrength: outputView.projectionStrength,
      },
      worldRotationApplied: samples.some((rig) => {
        const rotation = rig.worldRotation;
        return Boolean(rotation && (rotation.x !== 0 || rotation.y !== 0 || rotation.z !== 0));
      }),
      frames: layout.cells.map((cell, index) => ({
        index,
        timelineFrame: inspected[index].frame,
        x: cell.x,
        y: cell.y,
        width: cell.width,
        height: cell.height,
        durationMs,
        rootMotion: inspected[index].rootMotion,
        sourcePivot: pivotPoints[index],
      })),
    };
    const entries: ZipEntry[] = [
      { name: imageName, data: await canvasToPngBlob(canvas) },
      { name: metadataName, data: JSON.stringify(metadata, null, 2) },
    ];
    downloadBlob(await createStoredZip(entries), `${safeFileName(clip.name)}-sprite-sheet.zip`);
  } finally {
    host.remove();
  }
}

function safeFileName(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-") || "pose-animation";
}

function createAnimationRenderHost(source: SVGSVGElement): SVGSVGElement {
  const host = document.createElementNS(SVG_NAMESPACE, "svg");
  host.setAttribute("viewBox", source.getAttribute("viewBox") ?? "0 0 600 780");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:600px;height:780px;visibility:hidden";
  document.body.append(host);
  return host;
}

/** Resolve the projected joint reference even when its body geometry is hidden or replaced by art. */
export function getOutputJointPivot(rig: Rig, jointId: string): { x: number; y: number } | null {
  const joint = rig.joints.find((candidate) => candidate.id === jointId);
  if (!joint) return null;
  return projectPoint(rig, getJointWorldTransform(rig, joint.id), joint.z);
}

function getRenderedJointBottom(host: SVGSVGElement, jointIds: string[]): number | undefined {
  const bounds = getRenderedJointBounds(host, jointIds);
  return bounds ? bounds.y + bounds.height : undefined;
}

function getRenderedJointBounds(host: SVGSVGElement, jointIds: string[]): DrawingExportBounds | null {
  const ids = new Set(jointIds);
  return [...host.querySelectorAll<SVGGraphicsElement>("[data-body-joint][data-joint-id]")]
    .filter((element) => ids.has(element.getAttribute("data-joint-id") ?? ""))
    .reduce<DrawingExportBounds | null>((bounds, element) => {
      const box = element.getBBox();
      return mergeBounds(bounds, { x: box.x, y: box.y, width: box.width, height: box.height });
    }, null);
}

function loadBlobImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("스프라이트 프레임을 읽을 수 없습니다.")); };
    image.src = url;
  });
}

function mergeBounds(current: DrawingExportBounds | null, next: DrawingExportBounds): DrawingExportBounds {
  if (!current) return next;
  const x = Math.min(current.x, next.x);
  const y = Math.min(current.y, next.y);
  const right = Math.max(current.x + current.width, next.x + next.width);
  const bottom = Math.max(current.y + current.height, next.y + next.height);
  return { x, y, width: right - x, height: bottom - y };
}
