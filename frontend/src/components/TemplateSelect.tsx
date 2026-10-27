import { useMemo } from "react";
import { useQuestionnaireCategories } from "../api/adminQueries";
import { groupTemplatesByCategory } from "../fhir/questionnaireCategory";
import { CategorizedSelect, type CategorizedSelectCategory } from "./CategorizedSelect";

// テンプレート(Questionnaire)選択のプルダウン。左にテンプレートカテゴリ、右にテンプレートを並べ、
// カテゴリ未設定のテンプレートは左の末尾の「未分類」にまとめる。

// カテゴリ未設定のテンプレートを表す左の列の項目。
const UNCATEGORIZED = "uncategorized";

interface TemplateSelectProps {
  questionnaires: fhir4.Questionnaire[];
  /** 選択中の Questionnaire.id(未選択は空文字)。 */
  value: string;
  onChange: (questionnaireId: string) => void;
  label?: string;
}

function templateOptions(questionnaires: fhir4.Questionnaire[]) {
  return questionnaires.map((questionnaire) => {
    const title = questionnaire.title ?? questionnaire.name ?? "(名称未設定)";
    return {
      id: questionnaire.id ?? "",
      label: questionnaire.version ? `${title} (v${questionnaire.version})` : title,
    };
  });
}

export function TemplateSelect({
  questionnaires,
  value,
  onChange,
  label = "テンプレート",
}: TemplateSelectProps) {
  const { data: categories = [] } = useQuestionnaireCategories();
  const navItems = useMemo<CategorizedSelectCategory[]>(() => {
    const grouped = groupTemplatesByCategory(questionnaires, categories);
    const items: CategorizedSelectCategory[] = grouped.groups.map((group) => ({
      key: group.code,
      label: group.name,
      options: templateOptions(group.questionnaires),
    }));
    if (grouped.uncategorized.length > 0) {
      items.push({ key: UNCATEGORIZED, label: "未分類", options: templateOptions(grouped.uncategorized) });
    }
    return items;
  }, [questionnaires, categories]);

  return <CategorizedSelect categories={navItems} value={value} onChange={onChange} label={label} />;
}
