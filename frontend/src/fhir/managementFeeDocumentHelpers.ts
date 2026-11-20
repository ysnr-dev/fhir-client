import { addMonths, localDay, shortDate } from "../lib/dates";
import { advisoryKey, type Advisory } from "./advisoryHelpers";
import { DOCUMENT_TEMPLATE_SYSTEM } from "./patientFileHelpers";

// 指導・管理料と、算定の要件になる文書の対応(docs/medical-management-order-design.md §6)。
// 項目マスタが「要件の文書」(文書テンプレートの code)と「文書の有効月数」を持ち、
// 算定のフォームは文書の有無を、文書作成は算定の候補を、同じ対応から出す。

/** 項目マスタのうち、文書との対応に使う列。 */
export interface FeeDocumentRule {
  receipt_code: string;
  name: string;
  document_template_codes: string[];
  document_interval_months: number | null;
  documents?: { code: string; name: string | null }[];
}

/** `DocumentReference?type=` の検索値(テンプレートのカンマ OR)。 */
export function documentTemplateTypeSearch(templateCodes: string[]): string {
  return templateCodes.map((code) => `${DOCUMENT_TEMPLATE_SYSTEM}|${code}`).join(",");
}

/** テンプレートの code ごとの、最後に作成した文書の診療日。 */
export function latestDocumentDates(documents: fhir4.DocumentReference[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const doc of documents) {
    const code = doc.type?.coding?.find((c) => c.system === DOCUMENT_TEMPLATE_SYSTEM)?.code;
    const date = localDay(doc.date);
    if (!code || !date) continue;
    if (date > (latest.get(code) ?? "")) latest.set(code, date);
  }
  return latest;
}

export interface RequiredDocumentStatus {
  /** 要件の文書のうち、最後に作成したものの診療日。未作成なら空。 */
  lastDate: string;
  /** 算定日の時点で要件を満たす文書があるか。 */
  satisfied: boolean;
}

/**
 * 文書が足りる最も古い診療日。有効月数が空なら算定日当日、n なら算定月を含めて
 * 過去 n か月の月初(4 なら 11 月の算定に 8/1 以降の文書)。
 */
function documentCutoff(date: string, intervalMonths: number | null): string {
  if (!intervalMonths) return date;
  return addMonths(`${date.slice(0, 7)}-01`, 1 - intervalMonths);
}

/** 要件の文書の有無。文書を要件に持たない項目は null。 */
export function requiredDocumentStatus(
  rule: FeeDocumentRule | undefined,
  latest: Map<string, string>,
  date: string,
): RequiredDocumentStatus | null {
  if (!rule || rule.document_template_codes.length === 0) return null;
  const lastDate = rule.document_template_codes.reduce((max, code) => {
    const found = latest.get(code) ?? "";
    return found > max ? found : max;
  }, "");
  return { lastDate, satisfied: Boolean(date) && lastDate >= documentCutoff(date, rule.document_interval_months) };
}

/** 「文書 9/12」「文書 未作成」。 */
export function requiredDocumentLabel(status: RequiredDocumentStatus): string {
  return status.lastDate ? `文書 ${shortDate(status.lastDate)}` : "文書 未作成";
}

/** 要件の文書の名称(複数は「・」でつなぐ)。無効・削除済みのテンプレートは外す。 */
export function requiredDocumentName(rule: FeeDocumentRule): string {
  const names = (rule.documents ?? []).map((d) => d.name).filter((name): name is string => Boolean(name));
  return names.join("・") || "文書";
}

/** 選んだ項目のうち、要件の文書が足りないもの。登録時に文書作成の督促を作る対象。 */
export interface MissingFeeDocument {
  code: string;
  name: string;
  documentName: string;
  templateCodes: string[];
}

export function missingFeeDocuments(
  lines: { code: string; name: string }[],
  rules: FeeDocumentRule[],
  latest: Map<string, string>,
  date: string,
): MissingFeeDocument[] {
  return lines.flatMap((line) => {
    const rule = rules.find((r) => r.receipt_code === line.code);
    const status = requiredDocumentStatus(rule, latest, date);
    if (!rule || !status || status.satisfied) return [];
    return [
      {
        code: line.code,
        name: line.name,
        documentName: requiredDocumentName(rule),
        templateCodes: rule.document_template_codes,
      },
    ];
  });
}

/** 文書が足りない項目の、表示のみの警告。 */
export function requiredDocumentAdvisories(missing: MissingFeeDocument[]): Advisory[] {
  return missing.map((item) => ({
    key: advisoryKey("management-fee-document", item.code),
    kind: "management-fee-document" as const,
    severity: "info" as const,
    message: `${item.name}は${item.documentName}が作成されていません`,
  }));
}

/** その文書テンプレートを要件に持つ項目。文書作成で算定の候補にする。 */
export function feeItemsForTemplate<T extends FeeDocumentRule>(items: T[], templateCode: string): T[] {
  return items.filter((item) => item.document_template_codes.includes(templateCode));
}
