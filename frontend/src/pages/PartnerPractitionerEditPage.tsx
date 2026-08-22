import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FhirError } from "../api/fhirClient";
import { usePractitioner, usePractitionerRoles, useUpdatePractitioner } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PractitionerForm } from "../components/PractitionerForm";
import {
  buildPractitionerSaveBundle,
  parsePractitioner,
  type PractitionerFormValues,
} from "../fhir/practitionerHelpers";
import { emptyPractitionerRole, parsePractitionerRole } from "../fhir/practitionerRoleHelpers";

// 連携先医師の編集。自院スタッフの編集(PractitionerEditPage)と違い、
// ログイン設定と所属診療科は扱わない。
export function PartnerPractitionerEditPage() {
  const { id } = useParams<{ id: string }>();
  const { data: result, isLoading, error: loadError } = usePractitioner(id);
  const role = usePractitionerRoles(id);

  const header = (
    <div className="page__header">
      <h1>連携先医師編集</h1>
      <Link to="/partner-practitioners" className="button">
        ← 一覧に戻る
      </Link>
    </div>
  );

  if (isLoading || role.isLoading) {
    return <div className="page">読み込み中...</div>;
  }

  if (loadError || role.error || !result) {
    return (
      <div className="page">
        {header}
        <ErrorBanner error={loadError ?? role.error} />
      </div>
    );
  }

  // フォームは初期値をマウント時に確定するため、所属の取得後に描画する。
  return (
    <div className="page">
      {header}
      <EditForm
        practitionerId={id as string}
        etag={result.etag}
        existingRoles={role.roles}
        initialValues={{
          ...parsePractitioner(result.data),
          ...(role.role ? parsePractitionerRole(role.role) : emptyPractitionerRole),
          departments: [],
        }}
      />
    </div>
  );
}

interface EditFormProps {
  practitionerId: string;
  etag: string | null;
  existingRoles: fhir4.PractitionerRole[];
  initialValues: PractitionerFormValues;
}

function EditForm({ practitionerId, etag, existingRoles, initialValues }: EditFormProps) {
  const navigate = useNavigate();
  const updatePractitioner = useUpdatePractitioner();
  const [conflict, setConflict] = useState(false);

  async function handleSubmit(values: PractitionerFormValues) {
    if (!etag) return;
    setConflict(false);

    try {
      await updatePractitioner.mutateAsync({
        bundle: buildPractitionerSaveBundle({ values, practitionerId, etag, existingRoles }),
        practitionerId,
      });
    } catch (error) {
      if (error instanceof FhirError && error.status === 412) setConflict(true);
      return; // updatePractitioner.error が submitError として表示される
    }

    navigate("/partner-practitioners");
  }

  return (
    <>
      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この医師情報は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}
      <PractitionerForm
        partner
        initialValues={initialValues}
        onSubmit={handleSubmit}
        submitting={updatePractitioner.isPending}
        submitError={conflict ? undefined : updatePractitioner.error}
        submitLabel="更新"
      />
    </>
  );
}
