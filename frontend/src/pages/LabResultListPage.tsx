import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useLabResultSearch } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { LabResultTable } from "../components/LabResultTable";
import { Pagination } from "../components/Pagination";
import { PatientHeader } from "../components/PatientHeader";

export function LabResultListPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const [offset, setOffset] = useState(0);

  const { bundle, total, count, hasPrevious, hasNext, isLoading, error } = useLabResultSearch(
    patientId,
    offset,
  );
  const reports =
    bundle?.entry?.map((e) => e.resource).filter((r): r is fhir4.DiagnosticReport => Boolean(r)) ??
    [];

  return (
    <div className="page">
      <div className="page__header">
        <h1>検査結果一覧</h1>
        <div>
          <Link to={`/patients/${patientId}/lab-results/timeline`} className="button">
            時系列表示
          </Link>
          <Link to={`/patients/${patientId}/lab-results/new`} className="button">
            新規検査結果
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
          <LabResultTable reports={reports} patientId={patientId as string} />
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
