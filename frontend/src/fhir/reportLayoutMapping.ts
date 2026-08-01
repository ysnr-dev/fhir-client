// マッピング定義(report_layouts.mapping、JSON 配列テキスト)のフロント側の取り扱い。
//
// ルールの仕様と保存時の構造検証の正は backend の Reports::LayoutMapping
// (layout_mapping.rb)。ここでは行エディタのための parse/serialize と、
// 保存をブロックしない参照整合性チェック(linkId・tlfId が実在するか)を担う。
// 参照が壊れていても PDF 生成はエラーにならず黙って空欄になるため
// (ThinreportsRenderer は実在 ID との積集合で黙殺する)、登録時に警告する。
import { RESERVED_PLACEHOLDERS } from "./reportPlaceholders";
import { itemMediaOf } from "./schemaImage";
import type { TlfItemIds } from "./tlfPlaceholders";

// ルール4形式(layout_mapping.rb のコメントと対応):
//   value:        { linkId, tlfId }            回答値を text/image-block へ出力
//   showCode:     { linkId, code, show }       answerCoding.code 一致でアイテム表示
//   showAnswered: { linkId, answered, show }   回答が 1 つでもあれば表示
//   meta:         { meta, tlfId }              予約プレースホルダー値を別 ID へ出力
export type MappingRule =
  | { kind: "value"; linkId: string; tlfId: string }
  | { kind: "showCode"; linkId: string; code: string; show: string[] }
  | { kind: "showAnswered"; linkId: string; show: string[] }
  | { kind: "meta"; meta: string; tlfId: string };

export type MappingParseResult = { rules: MappingRule[] } | { error: string };

const RULE_KEYS = new Set(["linkId", "meta", "tlfId", "show", "code", "answered"]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// 1 ルールを判別 union へ変換する。構造検証(空文字チェック等)は backend に
// 任せ、ここでは行エディタで扱える形かどうかだけを判定する。
function toRule(raw: unknown): MappingRule | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const rule = raw as Record<string, unknown>;
  if (Object.keys(rule).some((key) => !RULE_KEYS.has(key))) return null;

  const { linkId, meta, tlfId, show, code, answered } = rule;
  if (typeof meta === "string" && typeof tlfId === "string" && linkId === undefined) {
    if (show !== undefined || code !== undefined || answered !== undefined) return null;
    return { kind: "meta", meta, tlfId };
  }
  if (typeof linkId !== "string" || meta !== undefined) return null;

  if (typeof tlfId === "string") {
    if (show !== undefined || code !== undefined || answered !== undefined) return null;
    return { kind: "value", linkId, tlfId };
  }
  if (!isStringArray(show) || tlfId !== undefined) return null;
  if (typeof code === "string") {
    if (answered !== undefined) return null;
    return { kind: "showCode", linkId, code, show };
  }
  // { linkId, show } は answered 省略時と同義(layout_mapping.rb のコメント参照)。
  if (answered === true || answered === undefined) return { kind: "showAnswered", linkId, show };
  return null;
}

// マッピング本文をルール配列へ変換する。行エディタで扱えない内容
// (不正な JSON・未知の構造)は error を返し、生 JSON 編集へフォールバックさせる。
export function parseMappingRules(text: string): MappingParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { rules: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { error: "JSON として読み込めません" };
  }
  if (!Array.isArray(parsed)) return { error: "ルールの配列(JSON Array)ではありません" };

  const rules: MappingRule[] = [];
  for (const [index, raw] of parsed.entries()) {
    const rule = toRule(raw);
    if (!rule) return { error: `ルール${index + 1}が既知の形式ではありません` };
    rules.push(rule);
  }
  return { rules };
}

// ルール配列をマッピング本文へ戻す。キー順は layout_mapping.rb のコメント例と
// 同順(linkId/meta → 条件 → 出力先)。ルールなしは空文字(マッピングなし)。
export function serializeMappingRules(rules: MappingRule[]): string {
  if (rules.length === 0) return "";

  const plain = rules.map((rule) => {
    switch (rule.kind) {
      case "value":
        return { linkId: rule.linkId, tlfId: rule.tlfId };
      case "showCode":
        return { linkId: rule.linkId, code: rule.code, show: rule.show };
      case "showAnswered":
        return { linkId: rule.linkId, answered: true, show: rule.show };
      case "meta":
        return { meta: rule.meta, tlfId: rule.tlfId };
    }
  });
  return JSON.stringify(plain, null, 2);
}

// item ツリーを全走査して linkId -> item の対応を作る(存在判定用に
// group / display も含む。questionnairePlaceholders は値の行しか返さない)。
export function collectLinkIds(
  questionnaire: fhir4.Questionnaire,
): Map<string, fhir4.QuestionnaireItem> {
  const map = new Map<string, fhir4.QuestionnaireItem>();
  function walk(items: fhir4.QuestionnaireItem[] | undefined) {
    for (const item of items ?? []) {
      map.set(item.linkId, item);
      walk(item.item);
    }
  }
  walk(questionnaire.item);
  return map;
}

export interface MappingWarning {
  /** 対象ルールの位置(0 始まり。メッセージ中の「ルールN」は 1 始まり) */
  ruleIndex: number;
  message: string;
}

const RESERVED_META_IDS = new Set(RESERVED_PLACEHOLDERS.map((p) => p.tlfId));

// 参照整合性チェック。questionnaire / tlfItems が無い側の確認はスキップする
// (テンプレート未選択・レイアウト先行作成のワークフローを壊さない)。
// 空文字は入力途中なので対象外(保存時に backend の構造検証が 422 で弾く)。
// 警告のみで保存はブロックしない。
export function validateMappingReferences(
  rules: MappingRule[],
  opts: { questionnaire?: fhir4.Questionnaire; tlfItems?: TlfItemIds | null },
): MappingWarning[] {
  const linkIds = opts.questionnaire ? collectLinkIds(opts.questionnaire) : null;
  const tlfItems = opts.tlfItems ?? null;
  const warnings: MappingWarning[] = [];

  rules.forEach((rule, index) => {
    const prefix = `ルール${index + 1}`;
    const add = (message: string) => warnings.push({ ruleIndex: index, message });

    if (rule.kind !== "meta" && linkIds && rule.linkId) {
      const item = linkIds.get(rule.linkId);
      if (!item) {
        add(`${prefix}の linkId "${rule.linkId}" は選択中のテンプレートにありません`);
      } else if ((item.type === "group" || item.type === "display") && !itemMediaOf(item)) {
        // シェーマ画像(itemMedia)があれば描き込み画像の出力元になれるため対象外。
        add(`${prefix}の linkId "${rule.linkId}" は回答を持たない項目(グループ/表示のみ)です`);
      } else if (rule.kind === "showCode" && rule.code && item.answerOption?.length) {
        const codes = item.answerOption.map((option) => option.valueCoding?.code);
        if (!codes.includes(rule.code)) {
          add(`${prefix}の code "${rule.code}" は項目 "${rule.linkId}" の選択肢にありません`);
        }
      }
    }
    if (rule.kind === "meta" && rule.meta && !RESERVED_META_IDS.has(rule.meta)) {
      add(`${prefix}の meta "${rule.meta}" は予約プレースホルダーではありません`);
    }

    if (!tlfItems) return;
    if (rule.kind === "value" || rule.kind === "meta") {
      if (!rule.tlfId) return;
      // meta の出力先は text-block のみ(renderer は text_ids としか照合しない)。
      const valid = rule.kind === "meta"
        ? tlfItems.textIds
        : new Set([...tlfItems.textIds, ...tlfItems.imageIds]);
      if (!tlfItems.allIds.has(rule.tlfId)) {
        add(`${prefix}の tlfId "${rule.tlfId}" はレイアウト(.tlf)にありません`);
      } else if (!valid.has(rule.tlfId)) {
        const expected = rule.kind === "meta" ? "text-block" : "text-block / image-block";
        add(`${prefix}の tlfId "${rule.tlfId}" は ${expected} ではないため値を出力できません`);
      }
    } else {
      for (const id of rule.show) {
        if (id && !tlfItems.allIds.has(id)) {
          add(`${prefix}の show の ID "${id}" はレイアウト(.tlf)にありません`);
        }
      }
    }
  });
  return warnings;
}
