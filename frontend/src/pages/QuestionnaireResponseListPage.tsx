import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuestionnaireResponseSearch } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Pagination } from "../components/Pagination";
import { PatientHeader } from "../components/PatientHeader";
import { QuestionnaireResponseTable } from "../components/QuestionnaireResponseTable";
import { questionnaireCanonical } from "../fhir/questionnaireResponseHelpers";

export function QuestionnaireResponseListPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const [offset, setOffset] = useState(0);

  const { responses, questionnaires, total, count, hasPrevious, hasNext, isLoading, error } =
    useQuestionnaireResponseSearch(patientId, offset);

  // canonical からテンプレートタイトルを引くための対応表(_include で同時取得した分)。
  const titleByCanonical = new Map(
    questionnaires.map((q) => [questionnaireCanonical(q), q.title ?? q.name ?? ""]),
  );

  return (
    <div className="page">
      <div className="page__header">
        <h1>テンプレート一覧</h1>
        <div>
          <Link to={`/patients/${patientId}/questionnaire-responses/new`} className="button">
            新規登録
          </Link>
          <Link to="/patients" className="button">
            ← 患者一覧に戻る
          </Link>
        </div>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <QuestionnaireResponseTable
            responses={responses}
            patientId={patientId as string}
            titleByCanonical={titleByCanonical}
          />
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
