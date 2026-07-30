// 帳票レイアウト(.tlf)で使えるプレースホルダー(アイテム ID)の列挙。
// 変換規約は backend の Reports::ItemIdMapper と同一に保つこと:
//   1. 英数字とアンダースコア以外の文字を 1 文字ずつ "_" に置換
//   2. 先頭が英数字でなければ "x" を前置
import { ITEM_TYPE_LABELS, type EditorItemType } from "./questionnaireHelpers";
import { itemMediaOf } from "./schemaImage";

const UNIT_EXT_URL = "http://hl7.org/fhir/StructureDefinition/questionnaire-unit";

export function convertLinkId(linkId: string): string {
  const converted = linkId.replace(/[^0-9a-zA-Z_]/g, "_");
  return /^[0-9a-zA-Z]/.test(converted) ? converted : `x${converted}`;
}

export interface PlaceholderRow {
  /** レイアウトに設定するアイテム ID */
  tlfId: string;
  /** 元の linkId(テンプレート項目由来の行のみ) */
  linkId?: string;
  /** 項目名・内容の説明 */
  label: string;
  /** 種類の表示(text-block / image-block と項目型) */
  typeLabel: string;
  /** 単位(あれば値の後に付加される) */
  unit?: string;
  /** 繰り返しグループ配下(2回目以降は _2, _3 ... になる) */
  inRepeatingGroup: boolean;
  /** 他の linkId と変換後 ID が衝突している(このままでは PDF 生成が 422 になる) */
  collision: boolean;
}

// 予約プレースホルダー(backend の Reports::ThinreportsRenderer#meta_values と対応)
export const RESERVED_PLACEHOLDERS: { tlfId: string; label: string }[] = [
  { tlfId: "pt_name", label: "患者氏名(漢字)" },
  { tlfId: "pt_kana", label: "患者氏名(カナ)" },
  { tlfId: "pt_id", label: "患者番号" },
  { tlfId: "pt_birthdate", label: "生年月日(YYYY/MM/DD)" },
  { tlfId: "pt_age", label: "年齢(記入日時点)" },
  { tlfId: "pt_gender", label: "性別" },
  { tlfId: "qr_title", label: "テンプレート名" },
  { tlfId: "qr_status", label: "ステータス" },
  { tlfId: "qr_authored", label: "記入日時(JST)" },
  { tlfId: "qr_author", label: "記入者" },
  { tlfId: "qr_institution", label: "保険医療機関番号" },
  { tlfId: "qr_id", label: "回答リソースの ID" },
];

function unitOf(item: fhir4.QuestionnaireItem): string | undefined {
  const coding = item.extension?.find((e) => e.url === UNIT_EXT_URL)?.valueCoding;
  return coding ? (coding.display ?? coding.code) : undefined;
}

// テンプレートの item ツリーから、レイアウトに置けるプレースホルダー行を列挙する。
// 回答値の text-block に加えて、シェーマ画像(itemMedia)を持つ項目は描き込み画像用の
// image-block("<id>_img")も列挙する。
export function questionnairePlaceholders(questionnaire: fhir4.Questionnaire): PlaceholderRow[] {
  const rows: PlaceholderRow[] = [];
  const seen = new Map<string, string>(); // tlfId -> linkId(衝突検出)

  function walk(items: fhir4.QuestionnaireItem[] | undefined, inRepeat: boolean) {
    for (const item of items ?? []) {
      const tlfId = convertLinkId(item.linkId);
      const collision = seen.has(tlfId) && seen.get(tlfId) !== item.linkId;
      if (!collision) seen.set(tlfId, item.linkId);

      const typeLabel =
        ITEM_TYPE_LABELS[item.type as EditorItemType] ?? item.type;
      const label = item.text ?? item.linkId;

      // group は値を持たないので回答値の行は出さない(子項目が対象)。
      // display も通常は値を持たないが、シェーマ画像の台紙になり得る。
      if (item.type !== "group" && item.type !== "display") {
        rows.push({
          tlfId,
          linkId: item.linkId,
          label,
          typeLabel: `text-block(${typeLabel})`,
          unit: unitOf(item),
          inRepeatingGroup: inRepeat,
          collision,
        });
      }

      if (itemMediaOf(item)) {
        rows.push({
          tlfId: `${tlfId}_img`,
          linkId: item.linkId,
          label: `${label} の描き込み画像`,
          typeLabel: "image-block",
          inRepeatingGroup: inRepeat,
          collision,
        });
      }

      walk(item.item, inRepeat || (item.type === "group" && Boolean(item.repeats)));
    }
  }

  walk(questionnaire.item, false);
  return rows;
}
