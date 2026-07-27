import { useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCreatePrescription } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientHeader } from "../components/PatientHeader";
import { PrescriptionForm } from "../components/PrescriptionForm";
import {
  buildDoPrescriptionForm,
  buildPrescriptionBundle,
  type PrescriptionFormValues,
} from "../fhir/prescriptionHelpers";
import { usePrescriptionInitialValues } from "../hooks/usePrescriptionInitialValues";

export function PrescriptionCreatePage() {
  const { patientId } = useParams<{ patientId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const createPrescription = useCreatePrescription();

  // ?from=<ServiceRequest id> が付いていれば、その処方を DO(投与量などの値も流用)する。
  const sourceSrId = searchParams.get("from") ?? undefined;
  const source = usePrescriptionInitialValues(sourceSrId);

  const initialValues = useMemo(
    () => (source.initialValues ? buildDoPrescriptionForm(source.initialValues) : undefined),
    [source.initialValues],
  );

  function handleSubmit(values: PrescriptionFormValues) {
    if (!patientId) return;
    createPrescription.mutate(buildPrescriptionBundle(values, patientId), {
      onSuccess: () => navigate(`/patients/${patientId}/prescriptions`),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>{sourceSrId ? "処方登録(DO)" : "処方登録"}</h1>
        <Link to={`/patients/${patientId}/prescriptions`} className="button">
          ← 処方一覧に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={source.error} />

      {/* DO 元の読み込み完了を待ってからフォームを描画する(初期値は初回描画時のみ反映される)。 */}
      {sourceSrId && !source.ready ? (
        <p>読み込み中...</p>
      ) : (
        <PrescriptionForm
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createPrescription.isPending}
          submitError={createPrescription.error}
        />
      )}
    </div>
  );
}
