import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FhirError } from "../api/fhirClient";
import { useCondition, useUpdateCondition } from "../api/queries";
import { ConditionForm } from "../components/ConditionForm";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientHeader } from "../components/PatientHeader";
import { buildCondition, parseConditionForm, type ConditionFormValues } from "../fhir/conditionHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { useProblemNumbering } from "../hooks/useProblemNumbering";

export function ConditionEditPage() {
  const { patientId, conditionId } = useParams<{ patientId: string; conditionId: string }>();
  const navigate = useNavigate();
  const { data: result, isLoading, error: loadError } = useCondition(conditionId);
  const updateCondition = useUpdateCondition();
  const problemNumberFor = useProblemNumbering(patientId);
  const [conflict, setConflict] = useState(false);

  const condition = result?.data;
  // 別患者の病名を更新すると subject が URL の患者に書き換わり、病名が付け替わってしまう。
  const patientMismatch = isPatientMismatch(patientId, condition?.subject);
  const error =
    loadError ?? (patientMismatch ? new Error("指定された病名は別の患者のものです。") : undefined);

  function handleSubmit(values: ConditionFormValues) {
    if (!patientId || !conditionId || !result?.etag || patientMismatch || !condition) return;
    setConflict(false);
    updateCondition.mutate(
      {
        condition: buildCondition(
          values,
          patientId,
          conditionId,
          problemNumberFor(values, condition),
        ),
        etag: result.etag,
      },
      {
        onSuccess: () => navigate(`/patients/${patientId}/conditions/${conditionId}`),
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
        <h1>病名編集</h1>
        <Link to={`/patients/${patientId}/conditions/${conditionId}`} className="button">
          ← 病名詳細に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={error} />

      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この病名は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        condition &&
        !patientMismatch && (
          <ConditionForm
            initialValues={parseConditionForm(condition)}
            onSubmit={handleSubmit}
            submitting={updateCondition.isPending}
            submitError={conflict ? undefined : updateCondition.error}
            submitLabel="更新"
          />
        )
      )}
    </div>
  );
}
