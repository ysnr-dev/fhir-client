import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FhirError } from "../api/fhirClient";
import { useAllergy, useUpdateAllergy } from "../api/queries";
import { AllergyForm } from "../components/AllergyForm";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientHeader } from "../components/PatientHeader";
import { buildAllergy, parseAllergyForm, type AllergyFormValues } from "../fhir/allergyHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";

export function AllergyEditPage() {
  const { patientId, allergyId } = useParams<{ patientId: string; allergyId: string }>();
  const navigate = useNavigate();
  const { data: result, isLoading, error: loadError } = useAllergy(allergyId);
  const updateAllergy = useUpdateAllergy();
  const [conflict, setConflict] = useState(false);

  const allergy = result?.data;
  // 別患者のアレルギーを更新すると patient が URL の患者に書き換わり、付け替わってしまう。
  const patientMismatch = isPatientMismatch(patientId, allergy?.patient);
  const error =
    loadError ??
    (patientMismatch ? new Error("指定されたアレルギーは別の患者のものです。") : undefined);

  function handleSubmit(values: AllergyFormValues) {
    if (!patientId || !allergyId || !result?.etag || patientMismatch) return;
    setConflict(false);
    updateAllergy.mutate(
      { allergy: buildAllergy(values, patientId, allergyId), etag: result.etag },
      {
        onSuccess: () => navigate(`/patients/${patientId}/allergies/${allergyId}`),
        onError: (err) => {
          if (err instanceof FhirError && err.status === 412) {
            setConflict(true);
          }
        },
      },
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>アレルギー編集</h1>
        <Link to={`/patients/${patientId}/allergies/${allergyId}`} className="button">
          ← アレルギー詳細に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={error} />

      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            このアレルギーは他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        allergy &&
        !patientMismatch && (
          <AllergyForm
            initialValues={parseAllergyForm(allergy)}
            onSubmit={handleSubmit}
            submitting={updateAllergy.isPending}
            submitError={conflict ? undefined : updateAllergy.error}
            submitLabel="更新"
          />
        )
      )}
    </div>
  );
}
