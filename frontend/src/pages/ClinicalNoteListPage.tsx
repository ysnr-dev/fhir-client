import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useClinicalNoteSearch } from "../api/queries";
import { ClinicalNoteTable } from "../components/ClinicalNoteTable";
import { ErrorBanner } from "../components/ErrorBanner";
import { Pagination } from "../components/Pagination";
import { PatientHeader } from "../components/PatientHeader";

export function ClinicalNoteListPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const [offset, setOffset] = useState(0);

  const { bundle, total, count, hasPrevious, hasNext, isLoading, error } = useClinicalNoteSearch(
    patientId,
    offset,
  );
  const notes =
    bundle?.entry?.map((e) => e.resource).filter((r): r is fhir4.Composition => Boolean(r)) ?? [];

  return (
    <div className="page">
      <div className="page__header">
        <h1>診療記録一覧</h1>
        <div>
          <Link to={`/patients/${patientId}/clinical-notes/new`} className="button">
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
          <ClinicalNoteTable notes={notes} patientId={patientId as string} />
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
