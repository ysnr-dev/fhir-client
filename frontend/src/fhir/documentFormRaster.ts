// 様式(PDF / 画像)をページ画像にする。デザイナからだけ使うので、このモジュール自体を
// 動的 import で読み、pdfjs-dist を主チャンクに入れない。
//
// PDF は 150dpi 相当で描く(A4 で 1240×1754px)。ページ寸法(pt)は PDF のものをそのまま持ち、
// 画像は 150dpi のスキャンとして扱う(pt = px × 72 / 150)。backend は px→pt の比で文字を置く。
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { DOCUMENT_FORM_LIMITS, type DocumentFormPageMeta } from "./documentFormLayout";
import { readFileAsDataUrl } from "./schemaImage";

export const RASTER_DPI = 150;
/** 画像の長辺の上限(px)。A4 を 150dpi で読んだ程度に揃える。 */
const IMAGE_MAX_SIDE = 2500;
const JPEG_QUALITY = 0.85;

export interface RasterPage extends DocumentFormPageMeta {
  /** 画面で見せる dataURL。 */
  dataUrl: string;
  /** backend へ送る本体(base64)。 */
  data: string;
}

export function rasterSourceKind(file: File): "pdf" | "image" | null {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (file.type === "image/png" || file.type === "image/jpeg") return "image";
  return null;
}

export async function rasterizeTemplateFile(file: File): Promise<RasterPage[]> {
  const kind = rasterSourceKind(file);
  if (kind === "pdf") return rasterizePdf(file);
  if (kind === "image") return [await rasterizeImage(file)];
  throw new Error("PDF、PNG、JPEG のファイルを選択してください。");
}

function base64Of(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

function byteLengthOf(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** PNG にし、上限を超えるときだけ JPEG に落とす(写真のようなページ)。 */
function encodeCanvas(canvas: HTMLCanvasElement, preferJpeg: boolean): { dataUrl: string; contentType: string } {
  if (!preferJpeg) {
    const png = canvas.toDataURL("image/png");
    if (byteLengthOf(base64Of(png)) <= DOCUMENT_FORM_LIMITS.pageMaxBytes) {
      return { dataUrl: png, contentType: "image/png" };
    }
  }
  return { dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY), contentType: "image/jpeg" };
}

function pageOf(
  pageNumber: number,
  canvas: HTMLCanvasElement,
  widthPt: number,
  heightPt: number,
  preferJpeg: boolean,
): RasterPage {
  const { dataUrl, contentType } = encodeCanvas(canvas, preferJpeg);
  const data = base64Of(dataUrl);
  return {
    page_number: pageNumber,
    content_type: contentType,
    byte_size: byteLengthOf(data),
    width_px: canvas.width,
    height_px: canvas.height,
    width_pt: Math.round(widthPt * 100) / 100,
    height_pt: Math.round(heightPt * 100) / 100,
    dataUrl,
    data,
  };
}

async function rasterizePdf(file: File): Promise<RasterPage[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  if (pdf.numPages > DOCUMENT_FORM_LIMITS.maxPages) {
    throw new Error(`PDF は ${DOCUMENT_FORM_LIMITS.maxPages} ページまでです(${pdf.numPages} ページ)。`);
  }

  const pages: RasterPage[] = [];
  const scale = RASTER_DPI / 72;
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("ページを描画できませんでした。");
    // JPEG に落とすことがあるので透明のまま残さない。
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, canvas, viewport }).promise;
    pages.push(pageOf(number, canvas, viewport.width / scale, viewport.height / scale, false));
    page.cleanup();
  }
  await pdf.loadingTask.destroy();
  return pages;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    img.src = src;
  });
}

async function rasterizeImage(file: File): Promise<RasterPage> {
  const img = await loadImage(await readFileAsDataUrl(file));
  const ratio = Math.min(1, IMAGE_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("画像を描画できませんでした。");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  const ptPerPx = 72 / RASTER_DPI;
  return pageOf(1, canvas, canvas.width * ptPerPx, canvas.height * ptPerPx, file.type === "image/jpeg");
}

/** ページ画像の合計が上限に収まるか。 */
export function pagesSizeError(pages: DocumentFormPageMeta[]): string | null {
  const total = pages.reduce((sum, page) => sum + page.byte_size, 0);
  if (total > DOCUMENT_FORM_LIMITS.pagesTotalMaxBytes) {
    return `ページ画像の合計が ${Math.round(DOCUMENT_FORM_LIMITS.pagesTotalMaxBytes / 1024 / 1024)}MB を超えています。解像度の低い様式にしてください。`;
  }
  const over = pages.find((page) => page.byte_size > DOCUMENT_FORM_LIMITS.pageMaxBytes);
  if (over) return `${over.page_number} ページ目の画像が大きすぎます。`;
  return null;
}
