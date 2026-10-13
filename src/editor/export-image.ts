const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const EXPORT_PADDING = 8;
const EXPORT_SCALE = 2;

export async function exportDrawingAsPng(
  source: SVGSVGElement,
  fileName = "pose-mesh.png",
): Promise<void> {
  const { svg, width, height } = createExportSvg(source);
  const serialized = serializeSvg(svg);
  const svgUrl = URL.createObjectURL(
    new Blob([serialized], { type: "image/svg+xml;charset=utf-8" }),
  );

  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * EXPORT_SCALE);
    canvas.height = Math.ceil(height * EXPORT_SCALE);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable");

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await canvasToBlob(canvas);
    downloadBlob(png, fileName);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export function exportDrawingAsSvg(
  source: SVGSVGElement,
  fileName = "pose-mesh.svg",
): void {
  const { svg } = createExportSvg(source);
  const serialized = serializeSvg(svg);
  downloadBlob(
    new Blob([serialized], { type: "image/svg+xml;charset=utf-8" }),
    fileName,
  );
}

function createExportSvg(source: SVGSVGElement): {
  svg: SVGSVGElement;
  width: number;
  height: number;
} {
  const body = source.querySelector<SVGGElement>('[data-layer="body"]');
  if (!body) throw new Error("Body layer was not found");

  const bounds = body.getBBox();
  const x = bounds.x - EXPORT_PADDING;
  const y = bounds.y - EXPORT_PADDING;
  const width = Math.max(1, bounds.width + EXPORT_PADDING * 2);
  const height = Math.max(1, bounds.height + EXPORT_PADDING * 2);

  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("xmlns", SVG_NAMESPACE);
  svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  svg.setAttribute("width", `${width}`);
  svg.setAttribute("height", `${height}`);

  const style = document.createElementNS(SVG_NAMESPACE, "style");
  style.textContent = `
    .body-face { stroke: none; }
    .body-joint { stroke: none; }
    .show-outlines .body-face { stroke: rgba(97, 63, 43, .45); stroke-width: 1.5; }
    .show-outlines .body-joint { stroke: rgba(102, 67, 44, .42); stroke-width: 1.5; }
  `;
  svg.append(style, body.cloneNode(true));
  return { svg, width, height };
}

function serializeSvg(svg: SVGSVGElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Export image could not be rendered"));
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG data could not be created"));
    }, "image/png");
  });
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
