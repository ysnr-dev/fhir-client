import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FhirError } from "../api/fhirClient";
import { usePractitioner, usePractitionerRole, useUpdatePractitioner } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PractitionerForm } from "../components/PractitionerForm";
import {
  buildPractitionerSaveBundle,
  parsePractitioner,
  type PractitionerFormValues,
} from "../fhir/practitionerHelpers";
import { emptyPractitionerRole, parsePractitionerRole } from "../fhir/practitionerRoleHelpers";

export function PractitionerEditPage() {
  const { id } = useParams<{ id: string }>();
  const { data: result, isLoading, error: loadError } = usePractitioner(id);
  const role = usePractitionerRole(id);

  const header = (
    <div className="page__header">
      <h1>医療従事者編集</h1>
      <Link to="/practitioners" className="button">
        ← 一覧に戻る
      </Link>
    </div>
  );

  if (isLoading || role.isLoading) return <div className="page">読み込み中...</div>;

  if (loadError || role.error || !result) {
    return (
      <div className="page">
        {header}
        <ErrorBanner error={loadError ?? role.error} />
      </div>
    );
  }

  // フォームは初期値をマウント時に確定するため、職種・所属の取得後に描画する。
  return (
    <div className="page">
      {header}
      <EditForm
        practitionerId={id as string}
        practitioner={result.data}
        etag={result.etag}
        roleId={role.role?.id}
        initialValues={{
          ...parsePractitioner(result.data),
          ...(role.role ? parsePractitionerRole(role.role) : emptyPractitionerRole),
        }}
      />
    </div>
  );
}

interface EditFormProps {
  practitionerId: string;
  practitioner: fhir4.Practitioner;
  etag: string | null;
  roleId?: string;
  initialValues: PractitionerFormValues;
}

function EditForm({ practitionerId, etag, roleId, initialValues }: EditFormProps) {
  const navigate = useNavigate();
  const updatePractitioner = useUpdatePractitioner();
  const [conflict, setConflict] = useState(false);

  function handleSubmit(values: PractitionerFormValues) {
    if (!etag) return;
    setConflict(false);
    updatePractitioner.mutate(
      {
        bundle: buildPractitionerSaveBundle({
          values,
          practitionerId,
          etag,
          existingRoleId: roleId,
        }),
        practitionerId,
      },
      {
        onSuccess: () => navigate("/practitioners"),
        onError: (error) => {
          if (error instanceof FhirError && error.status === 412) {
            setConflict(true);
          }
        },
      },
    );
  }

  return (
    <>
      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この医療従事者情報は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}
      <PractitionerForm
        initialValues={initialValues}
        onSubmit={handleSubmit}
        submitting={updatePractitioner.isPending}
        submitError={conflict ? undefined : updatePractitioner.error}
        submitLabel="更新"
      />
    </>
  );
}
