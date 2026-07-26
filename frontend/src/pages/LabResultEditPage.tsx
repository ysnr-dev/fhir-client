import { Link, useNavigate, useParams } from "react-router-dom";
import { useUpdateLabResult } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { LabResultForm } from "../components/LabResultForm";
import { PatientHeader } from "../components/PatientHeader";
import {
  buildLabResultUpdateBundle,
  specimenRefsFrom,
  type LabResultFormValues,
} from "../fhir/labResultHelpers";
import { useLabResultInitialValues } from "../hooks/useLabResultInitialValues";

export function LabResultEditPage() {
  const { patientId, reportId } = useParams<{ patientId: string; reportId: string }>();
  const navigate = useNavigate();
  const updateLabResult = useUpdateLabResult();

  const { report, observations, specimens, initialValues, ready, error } =
    useLabResultInitialValues(reportId);

  function handleSubmit(values: LabResultFormValues) {
    if (!patientId || !reportId || !report) return;
    const originalIds = observations.map((o) => o.id).filter((id): id is string => Boolean(id));
    updateLabResult.mutate(
      buildLabResultUpdateBundle(
        values,
        patientId,
        reportId,
        originalIds,
        specimenRefsFrom(specimens),
      ),
      { onSuccess: () => navigate(`/patients/${patientId}/lab-results/${reportId}`) },
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>検査結果編集</h1>
        <Link to={`/patients/${patientId}/lab-results/${reportId}`} className="button">
          ← 検査結果詳細に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={error} />

      {!ready ? (
        <p>読み込み中...</p>
      ) : (
        report &&
        initialValues && (
          <LabResultForm
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updateLabResult.isPending}
            submitError={updateLabResult.error}
            submitLabel="更新"
          />
        )
      )}
    </div>
  );
}
