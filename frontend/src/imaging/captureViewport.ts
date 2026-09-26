import { dataUrlByteLength, PATIENT_FILE_MAX_BYTES } from "../fhir/patientFileHelpers";

// 描画領域に見えているものを 1 枚の JPEG にする。画像は cornerstone の canvas、注釈は
// その上の SVG、四隅の文字は React の DOM で、どれも別の層にあるため 1 つの canvas に
// 重ねて描き直す。

export interface CornerTexts {
  topLeft: string[];
  topRight: string[];
  bottomLeft: string[];
  bottomRight: string[];
}

export interface CapturedImage {
  dataUrl: string;
  size: number;
}

const JPEG_QUALITIES = [0.92, 0.85, 0.75, 0.6];
const CORNER_FONT_PX = 12;
const CORNER_LINE_PX = 16;
const CORNER_PADDING_X = 10;
const CORNER_PADDING_Y = 8;
const CORNER_COLOR = "#e6e6a0";

/** `element` は DicomViewport の描画領域(cornerstone に渡した要素)。 */
export async function captureViewportJpeg(
  element: HTMLElement,
  corners: CornerTexts,
): Promise<CapturedImage> {
  const viewportElement = element.querySelector<HTMLElement>(".viewport-element");
  const source = viewportElement?.querySelector<HTMLCanvasElement>("canvas.cornerstone-canvas");
  if (!viewportElement || !source || source.width === 0 || source.height === 0) {
    throw new Error("画像が表示されていません。");
  }
  const cssWidth = viewportElement.clientWidth;
  const cssHeight = viewportElement.clientHeight;
  const scale = source.width / cssWidth;

  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を書き出せませんでした。");

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);

  const svg = viewportElement.querySelector<SVGSVGElement>(":scope > .svg-layer");
  if (svg) {
    const layer = await svgToImage(svg, cssWidth, cssHeight);
    ctx.drawImage(layer, 0, 0, canvas.width, canvas.height);
  }

  drawCorners(ctx, corners, scale, canvas.width, canvas.height);

  for (const quality of JPEG_QUALITIES) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const size = dataUrlByteLength(dataUrl);
    if (size <= PATIENT_FILE_MAX_BYTES) return { dataUrl, size };
  }
  throw new Error("画像が大きすぎて保存できません。");
}

function svgToImage(svg: SVGSVGElement, width: number, height: number): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const markup = new XMLSerializer().serializeToString(clone);
  const image = new Image();
  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("注釈を書き出せませんでした。"));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}

function drawCorners(
  ctx: CanvasRenderingContext2D,
  corners: CornerTexts,
  scale: number,
  width: number,
  height: number,
) {
  const line = CORNER_LINE_PX * scale;
  const padX = CORNER_PADDING_X * scale;
  const padY = CORNER_PADDING_Y * scale;
  ctx.font = `${CORNER_FONT_PX * scale}px sans-serif`;
  ctx.fillStyle = CORNER_COLOR;
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 2 * scale;

  const draw = (lines: string[], align: CanvasTextAlign, top: boolean) => {
    const texts = lines.filter(Boolean);
    const x = align === "left" ? padX : width - padX;
    ctx.textAlign = align;
    ctx.textBaseline = top ? "top" : "bottom";
    texts.forEach((text, i) => {
      const y = top ? padY + i * line : height - padY - (texts.length - 1 - i) * line;
      ctx.fillText(text, x, y);
    });
  };
  draw(corners.topLeft, "left", true);
  draw(corners.topRight, "right", true);
  draw(corners.bottomLeft, "left", false);
  draw(corners.bottomRight, "right", false);
}
