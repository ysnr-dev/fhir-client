import { useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCreateLabResult } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { LabResultForm } from "../components/LabResultForm";
import { PatientHeader } from "../components/PatientHeader";
import {
  buildDoLabResultForm,
  buildLabResultBundle,
  type LabResultFormValues,
} from "../fhir/labResultHelpers";
import { useLabResultInitialValues } from "../hooks/useLabResultInitialValues";

export function LabResultCreatePage() {
  const { patientId } = useParams<{ patientId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const createLabResult = useCreateLabResult();

  // ?from=<DiagnosticReport id> が付いていれば、その検査結果を DO(検査項目のみ流用)する。
  const sourceReportId = searchParams.get("from") ?? undefined;
  const source = useLabResultInitialValues(sourceReportId, patientId);

  const initialValues = useMemo(
    () => (source.initialValues ? buildDoLabResultForm(source.initialValues) : undefined),
    [source.initialValues],
  );

  function handleSubmit(values: LabResultFormValues) {
    if (!patientId) return;
    createLabResult.mutate(buildLabResultBundle(values, patientId), {
      onSuccess: () => navigate(`/patients/${patientId}/lab-results`),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>{sourceReportId ? "検査結果登録(DO)" : "検査結果登録"}</h1>
        <Link to={`/patients/${patientId}/lab-results`} className="button">
          ← 検査結果一覧に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={source.error} />

      {/* DO 元の読み込み完了を待ってからフォームを描画する(初期値は初回描画時のみ反映される)。 */}
      {sourceReportId && !source.ready ? (
        <p>読み込み中...</p>
      ) : (
        <LabResultForm
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createLabResult.isPending}
          submitError={createLabResult.error}
        />
      )}
    </div>
  );
}
