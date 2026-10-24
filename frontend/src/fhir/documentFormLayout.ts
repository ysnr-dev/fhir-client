// 様式テンプレート(文書テンプレート kind=form)のレイアウトの型と純粋関数。
//
// レイアウトは backend の document_templates.layout(jsonb)に持つ(DocumentTemplate の
// layout_shape と同じ形)。座標と大きさはページ画像の px(整数)、文字サイズは pt。
// 画面は pt を px に換算して描き(pxPerPt)、PDF は backend が px を pt に換算して描く。
// 値の表示用の整形(選択肢・チェックの印・日付)はここに置き、画面と PDF で同じ文字列を使う。
import { toWareki } from "../lib/dates";

export const DOCUMENT_FORM_SCHEMA_VERSION = 1;

export const FIELD_TYPES = ["text", "textarea", "select", "checkbox", "date"] as const;
export type DocumentFormFieldType = (typeof FIELD_TYPES)[number];
export const FIELD_TYPE_LABELS: Record<DocumentFormFieldType, string> = {
  text: "テキスト",
  textarea: "複数行",
  select: "選択",
  checkbox: "チェック",
  date: "日付",
};

export const ALIGNS = ["left", "center", "right"] as const;
export type DocumentFormAlign = (typeof ALIGNS)[number];
export const ALIGN_LABELS: Record<DocumentFormAlign, string> = { left: "左", center: "中央", right: "右" };

export const DATE_FORMATS = ["slash", "iso", "wareki"] as const;
export type DocumentFormDateFormat = (typeof DATE_FORMATS)[number];
export const DATE_FORMAT_LABELS: Record<DocumentFormDateFormat, string> = {
  slash: "2026/01/23",
  iso: "2026-01-23",
  wareki: "令和8年1月23日",
};

export const TRANSFER_KINDS = ["prescription", "injection", "order", "condition", "lab"] as const;
export type TransferKind = (typeof TRANSFER_KINDS)[number];
export const TRANSFER_KIND_LABELS: Record<TransferKind, string> = {
  prescription: "処方",
  injection: "注射",
  order: "オーダー",
  condition: "病名",
  lab: "検査結果",
};

/** backend(DocumentTemplate)と同じ上限。 */
export const DOCUMENT_FORM_LIMITS = {
  maxPages: 10,
  pageMaxBytes: 1.5 * 1024 * 1024,
  pagesTotalMaxBytes: 5 * 1024 * 1024,
  maxFields: 200,
  maxOptions: 50,
  fontSize: { min: 6, max: 72 },
} as const;

/** チェックの印。backend の PDF でも同じ文字を描く(IPA フォントにグリフあり)。 */
export const CHECK_MARK = "✓";
/** チェック済みを表す値。 */
export const CHECKED_VALUE = "1";

export interface DocumentFormField {
  /** linkId。保存後は変えない。 */
  id: string;
  type: DocumentFormFieldType;
  label: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** pt。 */
  font_size: number;
  align: DocumentFormAlign;
  required: boolean;
  /** 枠内を白で塗ってから値を書く(雛形の印字を隠す)。 */
  mask?: boolean;
  /** select のみ。 */
  options?: string[];
  /** text / textarea / date。初期値式(変数一覧の式)。 */
  initial_expression?: string;
  /** text / textarea。転記ボタンで出す出どころ。空なら転記ボタン無し。 */
  transfer_kinds?: TransferKind[];
  /** date のみ。 */
  date_format?: DocumentFormDateFormat;
}

export interface DocumentFormLayout {
  schema_version: typeof DOCUMENT_FORM_SCHEMA_VERSION;
  fields: DocumentFormField[];
}

/** ページ画像のメタ(本体は URL で別に取る)。backend の summary.pages と同じ形。 */
export interface DocumentFormPageMeta {
  page_number: number;
  content_type: string;
  byte_size: number;
  width_px: number;
  height_px: number;
  width_pt: number;
  height_pt: number;
}

/** 入力値。すべて文字列で持つ(checkbox は CHECKED_VALUE か空、date は YYYY-MM-DD、select は選択肢の文字)。 */
export type DocumentFormValues = Record<string, string>;

/** 置いたときの既定の大きさ(px、150dpi 相当のページ)。 */
const DEFAULT_SIZES: Record<DocumentFormFieldType, { w: number; h: number }> = {
  text: { w: 320, h: 36 },
  textarea: { w: 640, h: 200 },
  select: { w: 240, h: 36 },
  checkbox: { w: 32, h: 32 },
  date: { w: 240, h: 36 },
};
const DEFAULT_FONT_SIZE = 10.5;
const MIN_SIZE_PX = 10;

export function emptyLayout(): DocumentFormLayout {
  return { schema_version: DOCUMENT_FORM_SCHEMA_VERSION, fields: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
}

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return (list as readonly string[]).includes(value as string);
}

/** backend から読んだ layout を型に合わせて整える。壊れた項目は捨てる。 */
export function normalizeLayout(raw: unknown): DocumentFormLayout {
  if (!isRecord(raw) || !Array.isArray(raw.fields)) return emptyLayout();
  const fields: DocumentFormField[] = [];
  const seen = new Set<string>();
  for (const item of raw.fields) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id || seen.has(item.id)) continue;
    if (!includes(FIELD_TYPES, item.type)) continue;
    seen.add(item.id);
    const field: DocumentFormField = {
      id: item.id,
      type: item.type,
      label: typeof item.label === "string" ? item.label : "",
      page: Math.max(1, toInt(item.page, 1)),
      x: Math.max(0, toInt(item.x, 0)),
      y: Math.max(0, toInt(item.y, 0)),
      w: Math.max(1, toInt(item.w, 1)),
      h: Math.max(1, toInt(item.h, 1)),
      font_size: typeof item.font_size === "number" ? item.font_size : DEFAULT_FONT_SIZE,
      align: includes(ALIGNS, item.align) ? item.align : "left",
      required: item.required === true,
    };
    if (item.mask === true) field.mask = true;
    if (field.type === "select") {
      field.options = Array.isArray(item.options)
        ? item.options.filter((o): o is string => typeof o === "string")
        : [];
    }
    if (field.type === "text" || field.type === "textarea" || field.type === "date") {
      if (typeof item.initial_expression === "string") field.initial_expression = item.initial_expression;
    }
    if (field.type === "text" || field.type === "textarea") {
      field.transfer_kinds = Array.isArray(item.transfer_kinds)
        ? item.transfer_kinds.filter((k): k is TransferKind => includes(TRANSFER_KINDS, k))
        : [];
    }
    if (field.type === "date") {
      field.date_format = includes(DATE_FORMATS, item.date_format) ? item.date_format : "slash";
    }
    fields.push(field);
  }
  return { schema_version: DOCUMENT_FORM_SCHEMA_VERSION, fields };
}

export function newField(type: DocumentFormFieldType, page: number, x: number, y: number): DocumentFormField {
  const size = DEFAULT_SIZES[type];
  const field: DocumentFormField = {
    id: `f_${crypto.randomUUID().slice(0, 8)}`,
    type,
    label: FIELD_TYPE_LABELS[type],
    page,
    x: Math.round(x),
    y: Math.round(y),
    w: size.w,
    h: size.h,
    font_size: DEFAULT_FONT_SIZE,
    align: type === "checkbox" ? "center" : "left",
    required: false,
  };
  return withTypeExtras(field, type);
}

/** 種類に応じた付属項目だけを残す(種類を変えたとき、前の種類の項目が残らないように)。 */
function withTypeExtras(field: DocumentFormField, type: DocumentFormFieldType): DocumentFormField {
  const base: DocumentFormField = {
    id: field.id,
    type,
    label: field.label,
    page: field.page,
    x: field.x,
    y: field.y,
    w: field.w,
    h: field.h,
    font_size: field.font_size,
    align: field.align,
    required: field.required,
  };
  if (field.mask) base.mask = true;
  if (type === "select") base.options = field.options?.length ? field.options : ["選択肢1"];
  if (type === "text" || type === "textarea" || type === "date") {
    base.initial_expression = field.initial_expression ?? "";
  }
  if (type === "text" || type === "textarea") base.transfer_kinds = field.transfer_kinds ?? [];
  if (type === "date") base.date_format = field.date_format ?? "slash";
  return base;
}

export function changeFieldType(field: DocumentFormField, type: DocumentFormFieldType): DocumentFormField {
  if (field.type === type) return field;
  const size = DEFAULT_SIZES[type];
  const resized =
    type === "checkbox" || field.type === "checkbox" || type === "textarea" || field.type === "textarea"
      ? { ...field, w: size.w, h: size.h }
      : field;
  return withTypeExtras(resized, type);
}

export function pageOf(pages: DocumentFormPageMeta[], pageNumber: number): DocumentFormPageMeta | undefined {
  return pages.find((page) => page.page_number === pageNumber);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** ページの中に収める。ページより大きい箱はページいっぱいに縮める。 */
export function clampField(field: DocumentFormField, page: DocumentFormPageMeta | undefined): DocumentFormField {
  if (!page) return field;
  const w = clampInt(field.w, 1, page.width_px);
  const h = clampInt(field.h, 1, page.height_px);
  const x = clampInt(field.x, 0, page.width_px - w);
  const y = clampInt(field.y, 0, page.height_px - h);
  if (x === field.x && y === field.y && w === field.w && h === field.h) return field;
  return { ...field, x, y, w, h };
}

export function updateField(
  layout: DocumentFormLayout,
  id: string,
  patch: Partial<DocumentFormField>,
  pages: DocumentFormPageMeta[],
): DocumentFormLayout {
  return {
    ...layout,
    fields: layout.fields.map((field) =>
      field.id === id ? clampField({ ...field, ...patch }, pageOf(pages, patch.page ?? field.page)) : field,
    ),
  };
}

export function addField(layout: DocumentFormLayout, field: DocumentFormField, pages: DocumentFormPageMeta[]): DocumentFormLayout {
  return { ...layout, fields: [...layout.fields, clampField(field, pageOf(pages, field.page))] };
}

export function removeFields(layout: DocumentFormLayout, ids: Iterable<string>): DocumentFormLayout {
  const set = new Set(ids);
  return { ...layout, fields: layout.fields.filter((field) => !set.has(field.id)) };
}

export function moveFields(
  layout: DocumentFormLayout,
  ids: Iterable<string>,
  dx: number,
  dy: number,
  pages: DocumentFormPageMeta[],
): DocumentFormLayout {
  const set = new Set(ids);
  if (set.size === 0 || (dx === 0 && dy === 0)) return layout;
  return {
    ...layout,
    fields: layout.fields.map((field) =>
      set.has(field.id) ? clampField({ ...field, x: field.x + dx, y: field.y + dy }, pageOf(pages, field.page)) : field,
    ),
  };
}

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export function resizeField(
  layout: DocumentFormLayout,
  id: string,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  pages: DocumentFormPageMeta[],
): DocumentFormLayout {
  const field = layout.fields.find((f) => f.id === id);
  if (!field) return layout;
  const page = pageOf(pages, field.page);
  const maxW = page?.width_px ?? Number.MAX_SAFE_INTEGER;
  const maxH = page?.height_px ?? Number.MAX_SAFE_INTEGER;

  let left = field.x;
  let top = field.y;
  let right = field.x + field.w;
  let bottom = field.y + field.h;
  if (edge.includes("e")) right += dx;
  if (edge.includes("s")) bottom += dy;
  if (edge.includes("w")) left += dx;
  if (edge.includes("n")) top += dy;

  right = clampInt(Math.max(right, left + MIN_SIZE_PX), MIN_SIZE_PX, maxW);
  bottom = clampInt(Math.max(bottom, top + MIN_SIZE_PX), MIN_SIZE_PX, maxH);
  left = clampInt(left, 0, right - MIN_SIZE_PX);
  top = clampInt(top, 0, bottom - MIN_SIZE_PX);

  const next = { ...field, x: left, y: top, w: right - left, h: bottom - top };
  if (next.x === field.x && next.y === field.y && next.w === field.w && next.h === field.h) return layout;
  return { ...layout, fields: layout.fields.map((f) => (f.id === id ? next : f)) };
}

export function fieldsOnPage(layout: DocumentFormLayout, pageNumber: number): DocumentFormField[] {
  return layout.fields.filter((field) => field.page === pageNumber);
}

/** 内側(scale の掛かる)要素の矩形から、ポインタ位置をページの px に直す。 */
export function clientToPage(
  rect: DOMRect,
  zoom: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
}

export function fieldStyle(field: DocumentFormField): { left: number; top: number; width: number; height: number } {
  return { left: field.x, top: field.y, width: field.w, height: field.h };
}

/** 1pt を画面(ページ画像の px 座標系)で何 px にするか。 */
export function pxPerPt(page: DocumentFormPageMeta): number {
  return page.width_pt > 0 ? page.width_px / page.width_pt : 150 / 72;
}

// ---- 版の判定 ----

/**
 * 回答の意味が変わる差があるか(項目の増減・種類・ラベル・選択肢・初期値式・必須)。
 * 位置や大きさだけの変更では Questionnaire の版を上げない。
 */
export function fieldSetChanged(before: DocumentFormLayout, after: DocumentFormLayout): boolean {
  const key = (field: DocumentFormField) =>
    JSON.stringify([
      field.id,
      field.type,
      field.label,
      field.options ?? [],
      field.initial_expression ?? "",
      field.required,
    ]);
  const a = before.fields.map(key).sort();
  const b = after.fields.map(key).sort();
  return a.length !== b.length || a.some((value, index) => value !== b[index]);
}

// ---- 値の表示 ----

export function formatDateValue(value: string, format: DocumentFormDateFormat | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  if (format === "wareki") return toWareki(match[0]);
  if (format === "iso") return match[0];
  return `${match[1]}/${match[2]}/${match[3]}`;
}

/** 画面の確定表示と PDF に出す文字列。空なら何も描かない。 */
export function displayTextOf(field: DocumentFormField, value: string | undefined): string {
  const raw = value ?? "";
  if (field.type === "checkbox") return raw === CHECKED_VALUE ? CHECK_MARK : "";
  if (field.type === "date") return formatDateValue(raw, field.date_format);
  return raw;
}

export interface PdfFieldPayload {
  link_id: string;
  text: string;
}

export function pdfFieldPayload(layout: DocumentFormLayout, values: DocumentFormValues): PdfFieldPayload[] {
  return layout.fields
    .map((field) => ({ link_id: field.id, text: displayTextOf(field, values[field.id]) }))
    .filter((item) => item.text !== "");
}

/** 必須で空の項目のラベル。 */
export function missingRequiredLabels(layout: DocumentFormLayout, values: DocumentFormValues): string[] {
  return layout.fields.filter((field) => field.required && !(values[field.id] ?? "")).map((field) => field.label || field.id);
}

/** 保存前の検査。問題が無ければ null。 */
export function validateLayout(layout: DocumentFormLayout, pages: DocumentFormPageMeta[]): string | null {
  if (pages.length === 0) return "様式のファイルを選択してください。";
  if (layout.fields.length > DOCUMENT_FORM_LIMITS.maxFields) {
    return `項目は ${DOCUMENT_FORM_LIMITS.maxFields} 件までです。`;
  }
  for (const field of layout.fields) {
    const name = field.label || field.id;
    if (!field.label.trim()) return "ラベルが空の項目があります。";
    if (!pageOf(pages, field.page)) return `${name}: ページが存在しません。`;
    if (field.type === "select") {
      const options = (field.options ?? []).map((o) => o.trim()).filter(Boolean);
      if (options.length === 0) return `${name}: 選択肢を 1 件以上入力してください。`;
      if (options.length > DOCUMENT_FORM_LIMITS.maxOptions) {
        return `${name}: 選択肢は ${DOCUMENT_FORM_LIMITS.maxOptions} 件までです。`;
      }
      if (new Set(options).size !== options.length) return `${name}: 選択肢が重複しています。`;
    }
    if (field.font_size < DOCUMENT_FORM_LIMITS.fontSize.min || field.font_size > DOCUMENT_FORM_LIMITS.fontSize.max) {
      return `${name}: 文字サイズは ${DOCUMENT_FORM_LIMITS.fontSize.min}〜${DOCUMENT_FORM_LIMITS.fontSize.max} にしてください。`;
    }
  }
  return null;
}

/** 保存用に整える(選択肢の空行を除く、ラベルの前後の空白を落とす)。 */
export function prepareLayoutForSave(layout: DocumentFormLayout): DocumentFormLayout {
  return {
    schema_version: DOCUMENT_FORM_SCHEMA_VERSION,
    fields: layout.fields.map((field) => {
      const next: DocumentFormField = { ...field, label: field.label.trim() };
      if (next.options) next.options = next.options.map((o) => o.trim()).filter(Boolean);
      if (next.initial_expression !== undefined) next.initial_expression = next.initial_expression.trim();
      return next;
    }),
  };
}
