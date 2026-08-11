// シェーマ画像(テンプレート添付画像とその描き込み)の共通処理。
// 画像本体は Binary リソースに保存し、Questionnaire / QuestionnaireResponse の
// item からは Extension の valueAttachment(url: "Binary/<id>")で参照する。
//
// 新規画像は本体リソースと同じ transaction Bundle で保存する。Bundle 内では
// まだ ID が採番されていないため、いったん fullUrl のプレースホルダ
// ("urn:uuid:...")を url に入れ、上流が実 ID へ書き換える。これにより
// 「画像だけ保存されて本体が失敗する」孤児が構造的に発生しない。
//
// 画像の差し替え・描き込みのやり直しで参照が外れた旧 Binary は削除しない。
// リソースの旧バージョン(_history / vread)がその画像を参照しており、消すと
// 過去の記録が壊れるため、保持するのが正しい(容量と履歴保全のトレードオフを
// 履歴保全側に倒す)。

// item と一緒に表示するメディアを表す標準拡張(Questionnaire.item 用)。
export const ITEM_MEDIA_EXT_URL = "http://hl7.org/fhir/StructureDefinition/questionnaire-itemMedia";
// 描き込み済み合成画像(QuestionnaireResponse.item 用、アプリローカル拡張)。
export const ANNOTATED_IMAGE_EXT_URL =
  "http://fhir-client.local/StructureDefinition/questionnaire-response-annotated-image";

// アップロード前の縮小上限(長辺 px)。カメラ撮影の多MB画像対策。
const MAX_UPLOAD_DIMENSION = 1600;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function binaryIdFromAttachment(attachment: fhir4.Attachment | undefined): string | null {
  const match = attachment?.url?.match(/^Binary\/(.+)$/);
  return match ? match[1] : null;
}

// Bundle 内のプレースホルダ("urn:uuid:...")はそのまま url に入れる。
// 実 ID への書き換えは上流の transaction 処理が行う。
function attachmentUrl(binaryIdOrPlaceholder: string): string {
  return binaryIdOrPlaceholder.startsWith("urn:uuid:")
    ? binaryIdOrPlaceholder
    : `Binary/${binaryIdOrPlaceholder}`;
}

export function itemMediaOf(item: fhir4.QuestionnaireItem): fhir4.Attachment | undefined {
  return item.extension?.find((ext) => ext.url === ITEM_MEDIA_EXT_URL)?.valueAttachment;
}

export function annotationOf(item: fhir4.QuestionnaireResponseItem): fhir4.Attachment | undefined {
  return item.extension?.find((ext) => ext.url === ANNOTATED_IMAGE_EXT_URL)?.valueAttachment;
}

export function itemMediaExtension(binaryId: string, contentType: string): fhir4.Extension {
  return {
    url: ITEM_MEDIA_EXT_URL,
    valueAttachment: { contentType, url: attachmentUrl(binaryId) },
  };
}

export function annotatedImageExtension(binaryId: string): fhir4.Extension {
  return {
    url: ANNOTATED_IMAGE_EXT_URL,
    valueAttachment: { contentType: "image/png", url: attachmentUrl(binaryId) },
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像を読み込めませんでした。対応していない形式の可能性があります。"));
    img.src = src;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("ファイルの読み込みに失敗しました。"));
    reader.readAsDataURL(file);
  });
}

// 選択されたファイルを検証し、必要なら縮小して dataURL 化する。
// 線画のシェーマ台紙を劣化させないよう PNG は PNG のまま、それ以外は JPEG に再エンコードする。
export async function normalizeImageFile(
  file: File,
): Promise<{ dataUrl: string; contentType: string }> {
  if (!file.type.startsWith("image/")) {
    throw new Error("画像ファイルを選択してください。");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("画像サイズは20MB以下にしてください。");
  }

  const original = await readFileAsDataUrl(file);
  const img = await loadImage(original);
  const scale = MAX_UPLOAD_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight);

  if (scale >= 1 && (file.type === "image/png" || file.type === "image/jpeg")) {
    return { dataUrl: original, contentType: file.type };
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * Math.min(scale, 1));
  canvas.height = Math.round(img.naturalHeight * Math.min(scale, 1));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像の変換に失敗しました。");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const contentType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const dataUrl =
    contentType === "image/png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.85);
  return { dataUrl, contentType };
}

// 一覧・選択グリッド用のサムネイルを作る。台紙はシェーママスタの image(dataURL)を
// 縮小するだけなので、劣化を許容して JPEG に落としサイズを稼ぐ。
export async function makeThumbnailDataUrl(dataUrl: string, maxDim = 160): Promise<string> {
  const img = await loadImage(dataUrl);
  const scale = Math.min(maxDim / Math.max(img.naturalWidth, img.naturalHeight), 1);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像の変換に失敗しました。");
  // 透過PNGを黒背景にしないよう白で塗ってから描く。
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

// dataURL を transaction Bundle の Binary 作成エントリにする。
// placeholder は同じ Bundle 内から参照するための fullUrl。
export function imageBinaryEntry(
  dataUrl: string,
  contentType: string,
): { placeholder: string; entry: fhir4.BundleEntry } {
  const placeholder = `urn:uuid:${crypto.randomUUID()}`;
  const binary: fhir4.Binary = {
    resourceType: "Binary",
    contentType,
    data: dataUrl.slice(dataUrl.indexOf(",") + 1),
  };
  return {
    placeholder,
    entry: {
      fullUrl: placeholder,
      resource: binary,
      request: { method: "POST", url: "Binary" },
    },
  };
}

// 本体リソース + 画像 Binary をまとめて保存する transaction Bundle。
// etag を渡すと PUT(更新)、渡さなければ POST(新規)になる。
export function resourceWithImagesBundle(
  resource: fhir4.Resource & { id?: string },
  imageEntries: fhir4.BundleEntry[],
  etag?: string,
): fhir4.Bundle {
  const request: fhir4.BundleEntryRequest = etag
    ? { method: "PUT", url: `${resource.resourceType}/${resource.id}`, ifMatch: etag }
    : { method: "POST", url: resource.resourceType };

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [...imageEntries, { resource, request }],
  };
}

// transaction-response から本体リソースの entry を取り出す。
// 画像エントリを先に並べているので本体は常に末尾。
export function resourceFromBundleResponse<T extends fhir4.Resource>(
  bundle: fhir4.Bundle,
): { resource: T | undefined; etag: string | null } {
  const entry = bundle.entry?.[bundle.entry.length - 1];
  return {
    resource: entry?.resource as T | undefined,
    etag: entry?.response?.etag ?? null,
  };
}
