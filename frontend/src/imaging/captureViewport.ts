import { dataUrlByteLength, PATIENT_FILE_MAX_BYTES } from "../fhir/patientFileHelpers";

// 描画領域に見えているものを 1 枚の JPEG にする。画像は cornerstone の canvas、注釈は
// その上の SVG、四隅の文字は React の DOM で、どれも別の層にあるため 1 つの canvas に
// 重ねて描き直す。描画領域のうち画像の外の黒い余白は切り落とす。

export interface CornerTexts {
  topLeft: string[];
  topRight: string[];
  bottomLeft: string[];
  bottomRight: string[];
}

/** 切り出す範囲。描画領域の CSS ピクセルで表す。 */
export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
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

/**
 * `element` は DicomViewport の描画領域(cornerstone に渡した要素)。`crop` を省くと
 * 描画領域全体を写す。
 */
export async function captureViewportJpeg(
  element: HTMLElement,
  corners: CornerTexts,
  crop?: CaptureRect,
): Promise<CapturedImage> {
  const viewportElement = element.querySelector<HTMLElement>(".viewport-element");
  const source = viewportElement?.querySelector<HTMLCanvasElement>("canvas.cornerstone-canvas");
  if (!viewportElement || !source || source.width === 0 || source.height === 0) {
    throw new Error("画像が表示されていません。");
  }
  const cssWidth = viewportElement.clientWidth;
  const cssHeight = viewportElement.clientHeight;
  const scale = source.width / cssWidth;

  const full = document.createElement("canvas");
  full.width = source.width;
  full.height = source.height;
  const fullCtx = full.getContext("2d");
  if (!fullCtx) throw new Error("画像を書き出せませんでした。");

  fullCtx.fillStyle = "#000";
  fullCtx.fillRect(0, 0, full.width, full.height);
  fullCtx.drawImage(source, 0, 0);

  const svg = viewportElement.querySelector<SVGSVGElement>(":scope > .svg-layer");
  if (svg) {
    const layer = await svgToImage(svg, cssWidth, cssHeight);
    fullCtx.drawImage(layer, 0, 0, full.width, full.height);
  }

  const area = clampRect(crop ?? { x: 0, y: 0, width: cssWidth, height: cssHeight }, cssWidth, cssHeight);
  const sx = Math.round(area.x * scale);
  const sy = Math.round(area.y * scale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(area.width * scale));
  canvas.height = Math.max(1, Math.round(area.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を書き出せませんでした。");
  ctx.drawImage(full, sx, sy, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);

  drawCorners(ctx, corners, scale, canvas.width, canvas.height);

  for (const quality of JPEG_QUALITIES) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const size = dataUrlByteLength(dataUrl);
    if (size <= PATIENT_FILE_MAX_BYTES) return { dataUrl, size };
  }
  throw new Error("画像が大きすぎて保存できません。");
}

function clampRect(rect: CaptureRect, width: number, height: number): CaptureRect {
  const x = Math.max(0, Math.min(rect.x, width));
  const y = Math.max(0, Math.min(rect.y, height));
  const right = Math.max(x, Math.min(rect.x + rect.width, width));
  const bottom = Math.max(y, Math.min(rect.y + rect.height, height));
  // 画像が描画領域に無い(範囲が潰れた)ときは全体を写す。
  if (right - x < 1 || bottom - y < 1) return { x: 0, y: 0, width, height };
  return { x, y, width: right - x, height: bottom - y };
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
