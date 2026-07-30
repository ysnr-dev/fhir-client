// テンプレート(Questionnaire)のエクスポート/インポート。
//
// エクスポートは Questionnaire リソースを単一の JSON ファイルとして書き出す。
// シェーマ画像は Binary 参照("Binary/<id>")のままだと移行先のサーバーで辿れない
// ため、valueAttachment.data(base64)として埋め込み、ファイルだけで完結させる。
// id とサーバー採番のメタ情報は移行先では意味を持たないため取り除く。
//
// インポートはエクスポートしたファイルを読み、新規作成フォームと同じ中間表現
// (QuestionnaireFormValues)へ変換する。埋め込み画像は「選択直後の未保存画像」
// (dataUrl のみの EditorItemImage)として復元されるため、保存は新規作成と同じ
// 経路(画像 Binary と本体を 1 つの transaction Bundle で保存)に乗る。
// エディタが扱わない要素・拡張はエクスポート時には保たれるが、インポート時に
// 失われる(本アプリで作成したテンプレートの移行を前提とする)。
import { fetchBinaryImage } from "../api/fhirClient";
import {
  parseQuestionnaireForm,
  validateQuestionnaireForm,
  type QuestionnaireFormValues,
} from "./questionnaireHelpers";
import { binaryIdFromAttachment, ITEM_MEDIA_EXT_URL, itemMediaOf } from "./schemaImage";

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

export function downloadQuestionnaireExport(questionnaire: fhir4.Questionnaire): void {
  const blob = new Blob([JSON.stringify(questionnaire, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = questionnaireExportFileName(questionnaire);
  link.click();
  URL.revokeObjectURL(link.href);
}

// インポートファイルを検証し、新規作成フォームの中間表現へ変換する。
// 形式不備・JASPEHR 制約違反はユーザー向けメッセージの Error として投げる。
export function parseQuestionnaireImport(text: string): QuestionnaireFormValues {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      "JSON として読み込めませんでした。エクスポートしたテンプレートファイルを選択してください。",
    );
  }

  const questionnaire = parsed as fhir4.Questionnaire;
  if (questionnaire?.resourceType !== "Questionnaire") {
    throw new Error(
      "Questionnaire リソースのファイルではありません。エクスポートしたテンプレートファイルを選択してください。",
    );
  }

  const values = parseQuestionnaireForm(questionnaire);
  const error = validateQuestionnaireForm(values);
  if (error) throw new Error(`テンプレートの内容に不備があります。${error}`);
  return values;
}
