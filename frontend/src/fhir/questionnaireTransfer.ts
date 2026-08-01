// テンプレート(Questionnaire)のエクスポート/インポート。
//
// エクスポートは Questionnaire リソースを単一の JSON ファイルとして書き出す。
// シェーマ画像は Binary 参照("Binary/<id>")のままだと移行先のサーバーで辿れない
// ため、valueAttachment.data(base64)として埋め込み、ファイルだけで完結させる。
// id とサーバー採番のメタ情報は移行先では意味を持たないため取り除く。
// 帳票レイアウト(report_layouts)が登録済みのテンプレートは、.tlf 本文と
// マッピング定義を同梱したラッパー形式で書き出す(移行先での手作業コピペを
// 不要にする)。未登録なら従来どおり素の Questionnaire JSON。
//
// インポートはエクスポートしたファイル(両形式)を読み、新規作成フォームと同じ
// 中間表現(QuestionnaireFormValues)へ変換する。埋め込み画像は「選択直後の
// 未保存画像」(dataUrl のみの EditorItemImage)として復元されるため、保存は
// 新規作成と同じ経路(画像 Binary と本体を 1 つの transaction Bundle で保存)に
// 乗る。エディタが扱わない要素・拡張はエクスポート時には保たれるが、インポート
// 時に失われる(本アプリで作成したテンプレートの移行を前提とする)。
import { fetchBinaryImage } from "../api/fhirClient";
import {
  parseQuestionnaireForm,
  validateQuestionnaireForm,
  type QuestionnaireFormValues,
} from "./questionnaireHelpers";
import { binaryIdFromAttachment, ITEM_MEDIA_EXT_URL, itemMediaOf } from "./schemaImage";
import { extractTlfItemIds } from "./tlfPlaceholders";

// 同梱する帳票レイアウト(report_layouts の name / tlf / mapping)。
// url / version はラッパーに持たず、questionnaire から導出する(ズレを防ぐ)。
export interface TransferReportLayout {
  name: string;
  /** .tlf 本文(JSON テキスト)。テキストなので base64 にせずそのまま埋め込む。 */
  tlf: string;
  /** マッピング定義(JSON 配列のテキスト)。空文字はマッピングなし。 */
  mapping: string;
}

export interface TransferExport {
  formatVersion: 1;
  questionnaire: fhir4.Questionnaire;
  reportLayout: TransferReportLayout;
}

// シェーマ画像を Binary 参照から data 埋め込みへ置き換えた item ツリーを返す。
async function embedItemImages(item: fhir4.QuestionnaireItem): Promise<fhir4.QuestionnaireItem> {
  const attachment = itemMediaOf(item);
  const binaryId = binaryIdFromAttachment(attachment);
  let result = item;

  if (binaryId) {
    const dataUrl = await fetchBinaryImage(binaryId);
    const embedded: fhir4.Attachment = {
      contentType: attachment?.contentType ?? "image/png",
      data: dataUrl.slice(dataUrl.indexOf(",") + 1),
    };
    result = {
      ...item,
      extension: item.extension?.map((ext) =>
        ext.url === ITEM_MEDIA_EXT_URL ? { url: ITEM_MEDIA_EXT_URL, valueAttachment: embedded } : ext,
      ),
    };
  }

  if (item.item?.length) {
    result = { ...result, item: await Promise.all(item.item.map(embedItemImages)) };
  }
  return result;
}

// エクスポート用の Questionnaire を組み立てる。プロファイル宣言(meta.profile)は
// 残し、サーバー固有の id / versionId / lastUpdated は含めない。
export async function buildQuestionnaireExport(
  questionnaire: fhir4.Questionnaire,
): Promise<fhir4.Questionnaire> {
  const exported: fhir4.Questionnaire = { ...questionnaire };
  delete exported.id;
  delete exported.meta;
  if (questionnaire.meta?.profile) exported.meta = { profile: questionnaire.meta.profile };
  if (questionnaire.item?.length) {
    exported.item = await Promise.all(questionnaire.item.map(embedItemImages));
  }
  return exported;
}

// name(jsp-5 により半角英数字)とバージョンからファイル名を作る。
export function questionnaireExportFileName(questionnaire: fhir4.Questionnaire): string {
  const base =
    [questionnaire.name, questionnaire.version].filter(Boolean).join("_") || "questionnaire";
  return `${base.replace(/[\\/:*?"<>|\s]+/g, "-")}.json`;
}

// エクスポートファイルの内容を組み立てる。帳票レイアウトがあればラッパー形式、
// なければ素の Questionnaire(従来形式のまま)。
export function buildTransferExport(
  questionnaire: fhir4.Questionnaire,
  reportLayout?: TransferReportLayout,
): fhir4.Questionnaire | TransferExport {
  if (!reportLayout) return questionnaire;
  return { formatVersion: 1, questionnaire, reportLayout };
}

export function downloadQuestionnaireExport(payload: fhir4.Questionnaire | TransferExport): void {
  const questionnaire = "questionnaire" in payload ? payload.questionnaire : payload;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = questionnaireExportFileName(questionnaire);
  link.click();
  URL.revokeObjectURL(link.href);
}

export interface TransferImportResult {
  values: QuestionnaireFormValues;
  reportLayout?: TransferReportLayout;
  /** 同梱レイアウトを取り込めなかったときの警告(テンプレート本体は取り込む)。 */
  layoutWarning?: string;
}

// インポートファイルを検証し、新規作成フォームの中間表現へ変換する。
// 素の Questionnaire(従来形式)と帳票レイアウト同梱のラッパー形式の両方を
// 受け付ける。形式不備・JASPEHR 制約違反はユーザー向けメッセージの Error として
// 投げるが、同梱レイアウト側の不備はテンプレート本体の取り込みを優先して
// layoutWarning に落とす。
export function parseTransferImport(text: string): TransferImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      "JSON として読み込めませんでした。エクスポートしたテンプレートファイルを選択してください。",
    );
  }

  const wrapper = parsed as {
    questionnaire?: fhir4.Questionnaire;
    reportLayout?: unknown;
  };
  if (wrapper?.questionnaire?.resourceType === "Questionnaire") {
    return {
      values: toFormValues(wrapper.questionnaire),
      ...parseTransferReportLayout(wrapper.reportLayout),
    };
  }

  const questionnaire = parsed as fhir4.Questionnaire;
  if (questionnaire?.resourceType !== "Questionnaire") {
    throw new Error(
      "Questionnaire リソースのファイルではありません。エクスポートしたテンプレートファイルを選択してください。",
    );
  }
  return { values: toFormValues(questionnaire) };
}

function toFormValues(questionnaire: fhir4.Questionnaire): QuestionnaireFormValues {
  const values = parseQuestionnaireForm(questionnaire);
  const error = validateQuestionnaireForm(values);
  if (error) throw new Error(`テンプレートの内容に不備があります。${error}`);
  return values;
}

function parseTransferReportLayout(raw: unknown): {
  reportLayout?: TransferReportLayout;
  layoutWarning?: string;
} {
  if (typeof raw !== "object" || raw === null) {
    return {
      layoutWarning:
        "同梱された帳票レイアウトの形式が不正なため、レイアウトの登録をスキップしました。",
    };
  }
  const { name, tlf, mapping } = raw as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim() || typeof tlf !== "string") {
    return {
      layoutWarning:
        "同梱された帳票レイアウトの形式が不正なため、レイアウトの登録をスキップしました。",
    };
  }
  if (!extractTlfItemIds(tlf)) {
    return {
      layoutWarning:
        "同梱された帳票レイアウトが ThinReports のレイアウトファイル(.tlf)ではないため、レイアウトの登録をスキップしました。",
    };
  }
  return {
    reportLayout: { name, tlf, mapping: typeof mapping === "string" ? mapping : "" },
  };
}
