import { getPosePlaybackFrames, getPosePlaybackSettings, samplePosePlayback, type PoseClip } from "../rig/pose-interpolation.ts";
import {
  createDrawingPngBlob,
  createDrawingSvgBlob,
  downloadBlob,
  DRAWING_EXPORT_SCALE,
  getDrawingContentBounds,
  type DrawingExportBounds,
} from "./export-image.ts";
import { renderSvgEditor } from "./svg-editor.ts";
import type { EditorViewState } from "./types.ts";
import { createStoredZip, type ZipEntry } from "./zip.ts";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export async function exportPoseAnimationFrames(
  clip: PoseClip,
  source: SVGSVGElement,
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
      renderSvgEditor(host, samplePosePlayback(clip, frame).rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
      animationBounds = mergeBounds(animationBounds, getDrawingContentBounds(host));
    }
    if (!animationBounds) throw new Error("애니메이션의 출력 영역을 계산할 수 없습니다.");
    for (let index = 0; index < frames.length; index += 1) {
      renderSvgEditor(host, samplePosePlayback(clip, frames[index]).rig, { jointId: null, axisId: null, jointIds: [] }, viewState);
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

function safeFileName(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-") || "pose-animation";
}

function mergeBounds(current: DrawingExportBounds | null, next: DrawingExportBounds): DrawingExportBounds {
  if (!current) return next;
  const x = Math.min(current.x, next.x);
  const y = Math.min(current.y, next.y);
  const right = Math.max(current.x + current.width, next.x + next.width);
  const bottom = Math.max(current.y + current.height, next.y + next.height);
  return { x, y, width: right - x, height: bottom - y };
}
