import { readFileAsDataUrl, imageBinaryEntry, normalizeImageFile, resourceWithImagesBundle } from "./schemaImage";
import { toFhirDateTime } from "../lib/dates";

// カルテに取り込んだファイル(docs/patient-file-design.md)。
//
// 1 ファイルにつき Binary(本体)と DocumentReference(診療日・カテゴリ・表示名)を
// 1 本の transaction Bundle で保存する。Bundle 内の参照は urn:uuid のプレースホルダで、
// 上流が実 ID に書き換えるため、参照されない Binary は構造的に生まれない。
//
// 複数ファイルはファイルごとに Bundle を分けて順に送る。ファイル同士に整合性の
// 要求は無く、1 件が大きすぎて弾かれたときに他のファイルまで落ちる方が困るため。

/** カテゴリのコード体系。code は backend の file_categories が採番した UUID。 */
export const PATIENT_FILE_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/file-category";

/**
 * 1 ファイルの上限。上流はリクエスト本文が 10MB を超えると 413 で拒否し
 * (fhir-server の RequestSizeLimiter)、base64 にすると約 4/3 倍になるため、
 * DocumentReference のぶんの余白を残してこの値にしている。
 */
export const PATIENT_FILE_MAX_BYTES = 7 * 1024 * 1024;

/** 取込フォームが持つ 1 ファイルぶんの状態(保存前)。 */
export interface PatientFileDraft {
  /** 行の識別子(並びと除去のためだけのもの)。 */
  key: string;
  /** 表示名。既定は元のファイル名。 */
  title: string;
  contentType: string;
  /** 元のバイト数(画像は縮小後)。 */
  size: number;
  dataUrl: string;
}

/** 一覧・詳細で使う、保存済みファイルの読み取り結果。 */
export interface PatientFile {
  id: string;
  title: string;
  contentType: string;
  /** 元のバイト数。上流に size が無ければ null。 */
  size: number | null;
  /** 診療日 "YYYY-MM-DD"。 */
  date: string;
  categoryCode: string;
  categoryName: string;
  binaryId: string | null;
  authorReference: string;
  authorName: string;
  lastUpdated: string;
}

export interface PatientFileCategory {
  code: string;
  name: string;
}

export interface PatientFileValues {
  title: string;
  /** 診療日 "YYYY-MM-DD"。 */
  date: string;
  /** 未選択は空文字。 */
  categoryCode: string;
}

/**
 * 選んだファイルを取込フォームの行にする。画像は長辺 1600px に縮小し(PNG は PNG のまま)、
 * それ以外は無加工で dataURL にする。上限を超えるものは Error を投げる。
 */
export async function readPatientFileDraft(file: File): Promise<PatientFileDraft> {
  const key = crypto.randomUUID();
  const title = file.name || "無題";

  if (file.type.startsWith("image/")) {
    const { dataUrl, contentType } = await normalizeImageFile(file, { format: "keep" });
    const size = dataUrlByteLength(dataUrl);
    if (size > PATIENT_FILE_MAX_BYTES) throw new Error(tooLargeMessage(title));
    return { key, title, contentType, size, dataUrl };
  }

  if (file.size > PATIENT_FILE_MAX_BYTES) throw new Error(tooLargeMessage(title));
  const dataUrl = await readFileAsDataUrl(file);
  return {
    key,
    title,
    // 拡張子から種類を判定できないファイルはブラウザが空文字を返す。
    contentType: file.type || "application/octet-stream",
    size: file.size,
    dataUrl,
  };
}

function tooLargeMessage(title: string): string {
  return `${title}: ${formatFileSize(PATIENT_FILE_MAX_BYTES)}を超えるファイルは取り込めません。`;
}

/** base64 の dataURL から元のバイト数を求める。 */
function dataUrlByteLength(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/** 1 ファイルぶんの transaction Bundle(Binary の作成 + DocumentReference の作成)。 */
export function buildPatientFileBundle(
  draft: PatientFileDraft,
  options: {
    patientId: string;
    date: string;
    category: PatientFileCategory | null;
    practitionerId?: string;
    practitionerName?: string;
  },
): fhir4.Bundle {
  const { placeholder, entry } = imageBinaryEntry(draft.dataUrl, draft.contentType);
  const doc = buildDocumentReference({ ...options, draft, attachmentUrl: placeholder });
  return resourceWithImagesBundle(doc, [entry]);
}

/** 表示名・診療日・カテゴリだけを差し替えた DocumentReference(本体は差し替えない)。 */
export function buildPatientFileUpdate(
  doc: fhir4.DocumentReference,
  values: PatientFileValues,
  category: PatientFileCategory | null,
): fhir4.DocumentReference {
  const attachment = doc.content?.[0]?.attachment ?? {};
  return {
    ...doc,
    date: documentDate(values.date),
    category: categoryConcepts(category),
    content: [
      {
        ...doc.content?.[0],
        attachment: { ...attachment, title: values.title.trim() || attachment.title },
      },
      ...(doc.content?.slice(1) ?? []),
    ],
  };
}

function buildDocumentReference(args: {
  patientId: string;
  attachmentUrl: string;
  draft: PatientFileDraft;
  date: string;
  category: PatientFileCategory | null;
  practitionerId?: string;
  practitionerName?: string;
}): fhir4.DocumentReference {
  const doc: fhir4.DocumentReference = {
    resourceType: "DocumentReference",
    status: "current",
    subject: { reference: `Patient/${args.patientId}` },
    date: documentDate(args.date),
    content: [
      {
        attachment: {
          contentType: args.draft.contentType,
          url: args.attachmentUrl,
          title: args.draft.title.trim() || "無題",
          size: args.draft.size,
        },
      },
    ],
  };
  const category = categoryConcepts(args.category);
  if (category) doc.category = category;
  if (args.practitionerId) {
    doc.author = [
      { reference: `Practitioner/${args.practitionerId}`, display: args.practitionerName || undefined },
    ];
  }
  return doc;
}

/**
 * 診療日を DocumentReference.date にする値。R4 の date は instant なので、日付だけの
 * 値ではなくその日の 0 時をローカルのオフセット付きで入れる。上流が索引している日付は
 * date だけで、一覧の並び(_sort=-date)と期間検索をこれで診療日のまま行える。
 */
function documentDate(date: string): string | undefined {
  return date ? toFhirDateTime(`${date}T00:00`) : undefined;
}

function categoryConcepts(category: PatientFileCategory | null): fhir4.CodeableConcept[] | undefined {
  if (!category) return undefined;
  // display にカテゴリ名も焼き込む。カテゴリを消してもファイルの表示名は変わらない。
  return [
    {
      coding: [{ system: PATIENT_FILE_CATEGORY_SYSTEM, code: category.code, display: category.name }],
      text: category.name,
    },
  ];
}

export function parsePatientFile(doc: fhir4.DocumentReference): PatientFile {
  const attachment = doc.content?.[0]?.attachment ?? {};
  const coding = doc.category
    ?.flatMap((concept) => concept.coding ?? [])
    .find((c) => c.system === PATIENT_FILE_CATEGORY_SYSTEM);
  const author = doc.author?.[0];

  return {
    id: doc.id ?? "",
    title: attachment.title || "無題",
    contentType: attachment.contentType || "application/octet-stream",
    size: typeof attachment.size === "number" ? attachment.size : null,
    date: doc.date?.slice(0, 10) ?? "",
    categoryCode: coding?.code ?? "",
    categoryName: coding?.display ?? doc.category?.[0]?.text ?? "",
    binaryId: binaryIdFromUrl(attachment.url),
    authorReference: author?.reference ?? "",
    authorName: author?.display ?? "",
    lastUpdated: doc.meta?.lastUpdated ?? "",
  };
}

export function parsePatientFileValues(file: PatientFile): PatientFileValues {
  return { title: file.title, date: file.date, categoryCode: file.categoryCode };
}

function binaryIdFromUrl(url: string | undefined): string | null {
  const match = url?.match(/^Binary\/(.+)$/);
  return match ? match[1] : null;
}

/** バイト数を "1.2 MB" のような表記にする。 */
export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 一覧の「種類」列に出す短い名前。MIME をそのまま出すと読みにくいものだけ言い換える。 */
const CONTENT_TYPE_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/gif": "GIF",
  "text/plain": "テキスト",
  "text/csv": "CSV",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.ms-excel": "Excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.ms-powerpoint": "PowerPoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
  "application/zip": "ZIP",
  "application/octet-stream": "その他",
};

export function contentTypeLabel(contentType: string): string {
  return CONTENT_TYPE_LABELS[contentType] ?? contentType;
}

/** 詳細のプレビューの出し分け。ここに無いものはダウンロードだけにする。 */
export type PatientFilePreviewKind = "image" | "pdf" | "text" | "none";

export function previewKindOf(contentType: string): PatientFilePreviewKind {
  if (contentType.startsWith("image/")) return "image";
  if (contentType === "application/pdf") return "pdf";
  if (contentType.startsWith("text/") || contentType === "application/json") return "text";
  return "none";
}

/**
 * サムネイルに出すアイコンの種類。中身を読めないファイルを MIME で見分けるためのもので、
 * 同じ見た目でよいもの(Word と OpenDocument など)は 1 つにまとめる。
 */
export type PatientFileIconKind =
  | "image"
  | "pdf"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "text"
  | "archive"
  | "audio"
  | "video"
  | "other";

const ICON_KIND_BY_TYPE: Record<string, PatientFileIconKind> = {
  "application/pdf": "pdf",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.oasis.opendocument.text": "document",
  "application/rtf": "document",
  "application/vnd.ms-excel": "spreadsheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "spreadsheet",
  "application/vnd.oasis.opendocument.spreadsheet": "spreadsheet",
  "text/csv": "spreadsheet",
  "text/tab-separated-values": "spreadsheet",
  "application/vnd.ms-powerpoint": "presentation",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "presentation",
  "application/vnd.oasis.opendocument.presentation": "presentation",
  "application/zip": "archive",
  "application/x-zip-compressed": "archive",
  "application/gzip": "archive",
  "application/x-tar": "archive",
  "application/json": "text",
  "application/xml": "text",
};

export function fileIconKindOf(contentType: string): PatientFileIconKind {
  const known = ICON_KIND_BY_TYPE[contentType];
  if (known) return known;
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("text/")) return "text";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.startsWith("video/")) return "video";
  return "other";
}

export interface PatientFileDayGroup {
  /** 診療日 "YYYY-MM-DD"。日付を持たないファイルは空文字。 */
  date: string;
  files: PatientFile[];
}

/**
 * 診療日ごとにまとめる。並びは上流が `_sort=-date` で返した順のままなので、
 * 同じ日が続く区間を折るだけでよい(ページの途中で日が切れても、そのページの
 * 中では正しくまとまる)。
 *
 * 日付を持たないファイルだけは末尾に回す。上流の降順は NULL が先に来るが、
 * カルテでは「日付なし」を最下部に置く決まりのため。
 */
export function groupPatientFilesByDate(files: readonly PatientFile[]): PatientFileDayGroup[] {
  const groups: PatientFileDayGroup[] = [];
  for (const file of files) {
    const last = groups[groups.length - 1];
    if (last && last.date === file.date) last.files.push(file);
    else groups.push({ date: file.date, files: [file] });
  }
  const undated = groups.filter((group) => group.date === "");
  return undated.length === 0 ? groups : [...groups.filter((g) => g.date !== ""), ...undated];
}
