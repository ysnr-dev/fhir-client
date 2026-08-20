import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { usePatientSearch, type PatientSearchParams } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Pagination } from "../components/Pagination";
import { PatientSearchForm } from "../components/PatientSearchForm";
import { PatientTable } from "../components/PatientTable";

export function PatientListPage() {
  const [search, setSearch] = useState<PatientSearchParams>({});
  const [offset, setOffset] = useState(0);

  // 一覧の幅は外来一覧とそろえる(画面を行き来したときに表の左端が動かないように)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const { bundle, total, count, hasPrevious, hasNext, isLoading, error } = usePatientSearch(search, offset);
  const patients = bundle?.entry?.map((e) => e.resource).filter((r): r is fhir4.Patient => Boolean(r)) ?? [];

  function handleSearch(params: PatientSearchParams) {
    setSearch(params);
    setOffset(0);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>患者一覧</h1>
        <Link to="/patients/new" className="button">
          新規登録
        </Link>
      </div>

      <PatientSearchForm onSearch={handleSearch} />

      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <PatientTable patients={patients} />
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
