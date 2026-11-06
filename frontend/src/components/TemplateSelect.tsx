import { useMemo } from "react";
import type { DocumentTemplateSummary } from "../api/adminClient";
import { useQuestionnaireCategories } from "../api/adminQueries";
import { isDocumentFormQuestionnaire } from "../fhir/documentFormQuestionnaire";
import { groupTemplatesByCategory } from "../fhir/questionnaireCategory";
import { CategorizedSelect, type CategorizedOption, type CategorizedSelectCategory } from "./CategorizedSelect";

// テンプレート(Questionnaire)選択のプルダウン。左にテンプレートカテゴリ、右にテンプレートを並べ、
// カテゴリ未設定のテンプレートは左の末尾の「未分類」にまとめる。
// 様式テンプレートが自動生成した Questionnaire は、左の「様式」の見出しの下に様式テンプレートのファイルカテゴリごとに並べ、
// 様式テンプレートを削除して Questionnaire だけが残っているものは末尾の「削除済」にまとめる。

// カテゴリ未設定のテンプレートを表す左の列の項目。
const UNCATEGORIZED = "uncategorized";
const DOCUMENT_FORM_SECTION = "様式";
const DOCUMENT_FORM_KEY = "document-form";

interface TemplateSelectProps {
  questionnaires: fhir4.Questionnaire[];
  /** 選択中の Questionnaire.id(未選択は空文字)。 */
  value: string;
  onChange: (questionnaireId: string) => void;
  label?: string;
  /** 様式の Questionnaire をファイルカテゴリで分けるための様式テンプレート(無効なものも含める)。未取得なら「様式」1 つにまとめる。 */
  documentTemplates?: DocumentTemplateSummary[];
}

function optionOf(questionnaire: fhir4.Questionnaire, title?: string): CategorizedOption {
  const name = title ?? questionnaire.title ?? questionnaire.name ?? "(名称未設定)";
  return {
    id: questionnaire.id ?? "",
    label: questionnaire.version ? `${name} (v${questionnaire.version})` : name,
  };
}

function templateOptions(questionnaires: fhir4.Questionnaire[]) {
  return questionnaires.map((questionnaire) => optionOf(questionnaire));
}

/** 様式の Questionnaire を、様式テンプレートの並び順でファイルカテゴリごとに分ける。 */
function documentFormCategories(
  forms: fhir4.Questionnaire[],
  documentTemplates: DocumentTemplateSummary[] | undefined,
): CategorizedSelectCategory[] {
  if (forms.length === 0) return [];
  if (!documentTemplates) {
    return [{ key: DOCUMENT_FORM_KEY, label: DOCUMENT_FORM_SECTION, options: templateOptions(forms) }];
  }
  const byKey = new Map<string, CategorizedSelectCategory>();
  const claimed = new Set<fhir4.Questionnaire>();
  for (const template of documentTemplates) {
    const matched = forms.filter((q) => template.questionnaire_url && q.url === template.questionnaire_url);
    if (matched.length === 0) continue;
    const key = `${DOCUMENT_FORM_KEY}:${template.file_category_code ?? UNCATEGORIZED}`;
    let category = byKey.get(key);
    if (!category) {
      category = { key, label: template.file_category_name ?? "未分類", options: [], section: DOCUMENT_FORM_SECTION };
      byKey.set(key, category);
    }
    for (const questionnaire of matched) {
      category.options.push(optionOf(questionnaire, template.name));
      claimed.add(questionnaire);
    }
  }
  const uncategorizedKey = `${DOCUMENT_FORM_KEY}:${UNCATEGORIZED}`;
  const uncategorized = byKey.get(uncategorizedKey);
  byKey.delete(uncategorizedKey);
  const categories = uncategorized ? [...byKey.values(), uncategorized] : [...byKey.values()];
  const deleted = forms.filter((q) => !claimed.has(q));
  if (deleted.length > 0) {
    categories.push({
      key: `${DOCUMENT_FORM_KEY}:deleted`,
      label: "削除済",
      options: templateOptions(deleted),
      section: DOCUMENT_FORM_SECTION,
    });
  }
  return categories;
}

export function TemplateSelect({
  questionnaires,
  value,
  onChange,
  label = "テンプレート",
  documentTemplates,
}: TemplateSelectProps) {
  const { data: categories = [] } = useQuestionnaireCategories();
  const navItems = useMemo<CategorizedSelectCategory[]>(() => {
    const forms = questionnaires.filter(isDocumentFormQuestionnaire);
    const grouped = groupTemplatesByCategory(
      questionnaires.filter((q) => !isDocumentFormQuestionnaire(q)),
      categories,
    );
    const items: CategorizedSelectCategory[] = grouped.groups.map((group) => ({
      key: group.code,
      label: group.name,
      options: templateOptions(group.questionnaires),
    }));
    if (grouped.uncategorized.length > 0) {
      items.push({ key: UNCATEGORIZED, label: "未分類", options: templateOptions(grouped.uncategorized) });
    }
    return [...items, ...documentFormCategories(forms, documentTemplates)];
  }, [questionnaires, categories, documentTemplates]);

  return <CategorizedSelect categories={navItems} value={value} onChange={onChange} label={label} />;
}
