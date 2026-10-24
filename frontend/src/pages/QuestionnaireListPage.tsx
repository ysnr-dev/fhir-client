import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuestionnaireCategories } from "../api/adminQueries";
import { useAllQuestionnaires, useImportQuestionnaire } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { QuestionnaireCategoryModal } from "../components/QuestionnaireCategoryModal";
import { QuestionnaireTable } from "../components/QuestionnaireTable";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { groupTemplatesByCategory } from "../fhir/questionnaireCategory";
import { MasterBackLink } from "../components/MasterBackLink";

// カテゴリ未設定のテンプレートを表す左の一覧の項目。
const UNCATEGORIZED = "uncategorized";

interface CategoryNavItem {
  key: string;
  label: string;
  questionnaires: fhir4.Questionnaire[];
}

// 左にカテゴリ、右に選んだカテゴリのテンプレートを並べる。テンプレートの無いカテゴリも
// 左に出す。選択は URL に持たせ、編集画面から戻っても同じカテゴリを開く。
export function QuestionnaireListPage() {
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // 左のカテゴリの分だけ表が狭くなるので、ページの幅を広げる。
  useEffect(() => {
    document.body.classList.add("page-wide-md");
    return () => document.body.classList.remove("page-wide-md");
  }, []);

  const { questionnaires, truncated, isLoading, error } = useAllQuestionnaires();
  const { data: categories = [], error: categoriesError } = useQuestionnaireCategories();

  const navItems = useMemo<CategoryNavItem[]>(() => {
    const grouped = groupTemplatesByCategory(questionnaires, categories);
    const byCode = new Map(grouped.groups.map((group) => [group.code, group]));
    const items: CategoryNavItem[] = categories.map((category) => ({
      key: category.code,
      label: category.name,
      questionnaires: byCode.get(category.code)?.questionnaires ?? [],
    }));
    const registered = new Set(categories.map((category) => category.code));
    for (const group of grouped.groups) {
      if (registered.has(group.code)) continue;
      items.push({ key: group.code, label: group.name, questionnaires: group.questionnaires });
    }
    if (grouped.uncategorized.length > 0) {
      items.push({ key: UNCATEGORIZED, label: "未分類", questionnaires: grouped.uncategorized });
    }
    return items;
  }, [questionnaires, categories]);

  const selectedKey = searchParams.get("category");
  const selected = navItems.find((item) => item.key === selectedKey) ?? navItems[0];

  function selectCategory(key: string) {
    setSearchParams({ category: key }, { replace: true });
  }

  const importQuestionnaire = useImportQuestionnaire();

  function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 同じファイルを選び直しても change が発火するよう毎回クリアする。
    event.target.value = "";
    if (file) importQuestionnaire.mutate(file);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>テンプレート一覧</h1>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={handleImportFile}
          />
          <button type="button" className="button" onClick={() => setCategoryModalOpen(true)}>
            カテゴリ管理
          </button>
          <button
            type="button"
            className="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importQuestionnaire.isPending}
          >
            {importQuestionnaire.isPending ? "インポート中..." : "インポート"}
          </button>
          <Link to="/questionnaires/new" className="button">
            新規作成
          </Link>
          <MasterBackLink />
        </div>
      </div>

      {categoryModalOpen && (
        <QuestionnaireCategoryModal onClose={() => setCategoryModalOpen(false)} />
      )}

      <ErrorBanner error={error} />
      <ErrorBanner error={categoriesError} />
      <ErrorBanner error={importQuestionnaire.error} />
      {importQuestionnaire.isSuccess && (
        <p className="questionnaire-import__success" role="status">
          テンプレート「{importQuestionnaire.data.result.data.title ?? ""}」をインポートしました。
          {importQuestionnaire.data.layoutStatus !== "none" && "帳票レイアウトも登録しました。"}
        </p>
      )}
      {importQuestionnaire.isSuccess && importQuestionnaire.data.layoutWarning && (
        <p className="master-import-form__warning" role="status">
          {importQuestionnaire.data.layoutWarning}
        </p>
      )}
      {importQuestionnaire.isSuccess && importQuestionnaire.data.layoutError && (
        <p className="master-import-form__warning" role="status">
          テンプレートは取り込みましたが、帳票レイアウトの登録に失敗しました:
          {importQuestionnaire.data.layoutError}
          。帳票レイアウト画面から手動で登録してください。
        </p>
      )}

      <TruncatedNotice show={truncated} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <div className="facility-settings">
          <nav className="facility-settings__nav" aria-label="カテゴリ">
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`facility-settings__nav-item${item === selected ? " is-active" : ""}`}
                aria-current={item === selected ? "true" : undefined}
                onClick={() => selectCategory(item.key)}
              >
                {item.label}
                <span className="questionnaire-list__count">{item.questionnaires.length}</span>
              </button>
            ))}
          </nav>
          <div className="questionnaire-list__content">
            {selected ? (
              <>
                <h2 className="facility-settings__title">{selected.label}</h2>
                <QuestionnaireTable questionnaires={selected.questionnaires} />
              </>
            ) : (
              <p className="patient-table__empty">登録されているテンプレートがありません。</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
