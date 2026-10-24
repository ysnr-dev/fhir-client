// 様式テンプレート(文書テンプレート kind=form)のエクスポートファイルの型と読み込み。
//
// ファイルは backend の GET /admin/document_templates/:id/export が返す JSON をそのまま保存したもの。
// ページ画像を base64 で埋め込んだ自己完結のファイルで、code と Questionnaire の canonical は含まない
// (取り込み先で採番し直す)。ファイルカテゴリは code、無ければ名称で取り込み先のものに引き当てる。
import type { DocumentTemplatePagePayload } from "../api/adminClient";
import { normalizeLayout, type DocumentFormLayout } from "./documentFormLayout";

export const DOCUMENT_FORM_EXPORT_FORMAT = "document-form-template";
export const DOCUMENT_FORM_EXPORT_FORMAT_VERSION = 1;

export interface DocumentFormTemplateExport {
  format: typeof DOCUMENT_FORM_EXPORT_FORMAT;
  format_version: number;
  template: {
    name: string;
    file_name: string;
    content_type: string;
    file_category: { code: string; name: string } | null;
    layout: DocumentFormLayout;
  };
  pages: Omit<DocumentTemplatePagePayload, "byte_size">[];
}

export interface DocumentFormTemplateImport {
  name: string;
  fileName: string;
  contentType: string;
  fileCategory: { code: string; name: string } | null;
  layout: DocumentFormLayout;
  pages: DocumentTemplatePagePayload[];
}

export function documentFormExportFileName(name: string): string {
  return `${name.replace(/[\\/:*?"<>|\s]+/g, "-") || "document-form"}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64ByteLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

const INVALID_FILE = "様式テンプレートのエクスポートファイルではありません。";

// 形の不備はユーザー向けメッセージの Error として投げる。ページ数・大きさ・配置の検証は登録時に backend が行う。
export function parseDocumentFormImport(text: string): DocumentFormTemplateImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`JSON として読み込めませんでした。${INVALID_FILE}`);
  }
  if (!isRecord(parsed) || parsed.format !== DOCUMENT_FORM_EXPORT_FORMAT || !isRecord(parsed.template)) {
    throw new Error(INVALID_FILE);
  }
  if (parsed.format_version !== DOCUMENT_FORM_EXPORT_FORMAT_VERSION) {
    throw new Error(`対応していない形式の版です(${String(parsed.format_version)})。`);
  }
  const { template } = parsed;
  if (
    typeof template.name !== "string" ||
    !template.name.trim() ||
    typeof template.file_name !== "string" ||
    typeof template.content_type !== "string" ||
    !isRecord(template.layout) ||
    !Array.isArray(parsed.pages)
  ) {
    throw new Error(INVALID_FILE);
  }

  const pages = parsed.pages.map((page): DocumentTemplatePagePayload => {
    if (
      !isRecord(page) ||
      typeof page.data !== "string" ||
      typeof page.content_type !== "string" ||
      !["page_number", "width_px", "height_px", "width_pt", "height_pt"].every((key) => typeof page[key] === "number")
    ) {
      throw new Error(`${INVALID_FILE}(ページ画像が読めません)`);
    }
    return {
      page_number: page.page_number as number,
      content_type: page.content_type,
      byte_size: base64ByteLength(page.data),
      width_px: page.width_px as number,
      height_px: page.height_px as number,
      width_pt: page.width_pt as number,
      height_pt: page.height_pt as number,
      data: page.data,
    };
  });

  const category = template.file_category;
  return {
    name: template.name.trim(),
    fileName: template.file_name,
    contentType: template.content_type,
    fileCategory:
      isRecord(category) && typeof category.code === "string" && typeof category.name === "string"
        ? { code: category.code, name: category.name }
        : null,
    layout: normalizeLayout(template.layout),
    pages,
  };
}
