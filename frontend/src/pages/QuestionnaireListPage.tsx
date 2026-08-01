import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useImportQuestionnaire, useQuestionnaireSearch } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Pagination } from "../components/Pagination";
import { QuestionnaireTable } from "../components/QuestionnaireTable";

export function QuestionnaireListPage() {
  const [offset, setOffset] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { bundle, total, count, hasPrevious, hasNext, isLoading, error } =
    useQuestionnaireSearch(offset);
  const questionnaires =
    bundle?.entry?.map((e) => e.resource).filter((r): r is fhir4.Questionnaire => Boolean(r)) ?? [];

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
        </div>
      </div>

      <ErrorBanner error={error} />
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

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <QuestionnaireTable questionnaires={questionnaires} />
          <Pagination
            offset={offset}
            count={count}
            total={total}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
            onPrevious={() => setOffset((o) => Math.max(0, o - count))}
            onNext={() => setOffset((o) => o + count)}
          />
        </>
      )}
    </div>
  );
}
