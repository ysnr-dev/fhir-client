import { useState } from "react";
import { useQuestionnaireCategories } from "../api/adminQueries";
import { useQuestionnaireOptions } from "../api/queries";
import { groupTemplatesByCategory } from "../fhir/questionnaireCategory";
import { KARTE_KIND_LABELS, type KarteCardFilter, type KarteItemKind } from "../fhir/karteTimeline";

// カルテ左端のペインの「カテゴリ」表示。情報の種別を選ぶとタイムラインがその種別の
// カードだけになる。テンプレートは種別が 1 つしか無く、社会歴のように「そのテンプレート
// だけを時系列で読みたい」ものがあるため、テンプレート名まで展開できるようにする。
//
// テンプレートの一覧は読み込み済みのタイムラインからではなくテンプレート検索から作る
// (タイムラインから拾うと、スクロールで読み進むたびに選択肢が増える不安定な一覧になる)。

interface KarteCategoryListProps {
  filter: KarteCardFilter | null;
  onSelect: (filter: KarteCardFilter | null) => void;
}

// テンプレート以外の種別。並びは KARTE_KIND_LABELS の定義順。
const PLAIN_KINDS: KarteItemKind[] = [
  "note",
  "vital",
  "prescription",
  "injection",
  "lab-order",
  "micro-order",
  "patho-order",
  "rad-order",
  "physio-order",
  "endoscopy-order",
  "treatment-order",
  "surgery-order",
  "meal-order",
  "transfusion-order",
  "rehab-order",
];

export function KarteCategoryList({ filter, onSelect }: KarteCategoryListProps) {
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const { questionnaires } = useQuestionnaireOptions({ status: "active" });
  const { data: categories } = useQuestionnaireCategories();
  const grouped = groupTemplatesByCategory(questionnaires, categories ?? []);

  // 同じ行をもう一度押したら絞り込みを解除する。
  function select(next: KarteCardFilter) {
    const same =
      filter?.kind === next.kind && filter?.questionnaireUrl === next.questionnaireUrl;
    onSelect(same ? null : next);
  }

  function itemClass(selected: boolean): string {
    return `karte-catlist__item${selected ? " karte-catlist__item--selected" : ""}`;
  }

  function renderTemplate(questionnaire: fhir4.Questionnaire) {
    const url = questionnaire.url ?? "";
    if (!url) return null;
    const selected = filter?.kind === "qr" && filter.questionnaireUrl === url;
    const title = questionnaire.title ?? questionnaire.name ?? url;
    return (
      <li key={questionnaire.id ?? url}>
        <button
          type="button"
          className={`${itemClass(selected)} karte-catlist__item--template`}
          aria-pressed={selected}
          // ペインが狭く名前が省略されるので、全体はツールチップで見せる。
          title={title}
          onClick={() => select({ kind: "qr", questionnaireUrl: url })}
        >
          {title}
        </button>
      </li>
    );
  }

  const allTemplates = filter?.kind === "qr" && !filter.questionnaireUrl;

  return (
    <ul className="karte-catlist">
      <li>
        <button
          type="button"
          className={itemClass(!filter)}
          aria-pressed={!filter}
          onClick={() => onSelect(null)}
        >
          全て
        </button>
      </li>
      {PLAIN_KINDS.map((kind) => {
        const selected = filter?.kind === kind;
        return (
          <li key={kind}>
            <button
              type="button"
              className={itemClass(selected)}
              aria-pressed={selected}
              onClick={() => select({ kind })}
            >
              {KARTE_KIND_LABELS[kind]}
            </button>
          </li>
        );
      })}
      <li>
        <div className="karte-catlist__row">
          <button
            type="button"
            className="karte-catlist__toggle"
            aria-expanded={templatesOpen}
            aria-label={`テンプレートの一覧を${templatesOpen ? "閉じる" : "開く"}`}
            onClick={() => setTemplatesOpen((open) => !open)}
          >
            {templatesOpen ? "▾" : "▸"}
          </button>
          <button
            type="button"
            className={itemClass(allTemplates)}
            aria-pressed={allTemplates}
            onClick={() => select({ kind: "qr" })}
          >
            {KARTE_KIND_LABELS.qr}
          </button>
        </div>
        {templatesOpen && (
          <ul className="karte-catlist__templates">
            {grouped.groups.map((group) => (
              <li key={group.code}>
                <span className="karte-catlist__group">{group.name}</span>
                <ul>{group.questionnaires.map(renderTemplate)}</ul>
              </li>
            ))}
            {grouped.uncategorized.length > 0 && (
              <li>
                {grouped.groups.length > 0 && (
                  <span className="karte-catlist__group">未分類</span>
                )}
                <ul>{grouped.uncategorized.map(renderTemplate)}</ul>
              </li>
            )}
            {questionnaires.length === 0 && <li className="karte-daylist__empty">-</li>}
          </ul>
        )}
      </li>
    </ul>
  );
}
