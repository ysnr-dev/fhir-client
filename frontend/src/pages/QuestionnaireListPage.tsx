import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuestionnaireSearch } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Pagination } from "../components/Pagination";
import { QuestionnaireTable } from "../components/QuestionnaireTable";

export function QuestionnaireListPage() {
  const [offset, setOffset] = useState(0);

  const { bundle, total, count, hasPrevious, hasNext, isLoading, error } =
    useQuestionnaireSearch(offset);
  const questionnaires =
    bundle?.entry?.map((e) => e.resource).filter((r): r is fhir4.Questionnaire => Boolean(r)) ?? [];

  return (
    <div className="page">
      <div className="page__header">
        <h1>テンプレート一覧</h1>
        <div>
          <Link to="/questionnaires/new" className="button">
            新規作成
          </Link>
        </div>
      </div>

      <ErrorBanner error={error} />

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
