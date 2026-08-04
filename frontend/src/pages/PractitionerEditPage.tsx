import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDeleteLoginAccount, useLoginAccount, useUpsertLoginAccount } from "../api/authQueries";
import { FhirError } from "../api/fhirClient";
import { usePractitioner, usePractitionerRoles, useUpdatePractitioner } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PractitionerForm, type PractitionerLoginValues } from "../components/PractitionerForm";
import {
  buildPractitionerSaveBundle,
  parsePractitioner,
  type PractitionerFormValues,
} from "../fhir/practitionerHelpers";
import {
  emptyPractitionerRole,
  parseDepartmentRoles,
  parsePractitionerRole,
} from "../fhir/practitionerRoleHelpers";

export function PractitionerEditPage() {
  const { id } = useParams<{ id: string }>();
  const { data: result, isLoading, error: loadError } = usePractitioner(id);
  const role = usePractitionerRoles(id);
  // ログイン設定(backend の /auth/account)。フォームの初期値になるため、
  // 職種・所属と同様に取得完了を待ってから描画する。
  const account = useLoginAccount(id);

  const header = (
    <div className="page__header">
      <h1>医療従事者編集</h1>
      <Link to="/practitioners" className="button">
        ← 一覧に戻る
      </Link>
    </div>
  );

  if (isLoading || role.isLoading || account.isLoading) {
    return <div className="page">読み込み中...</div>;
  }

  if (loadError || role.error || account.error || !result) {
    return (
      <div className="page">
        {header}
        <ErrorBanner error={loadError ?? role.error ?? account.error} />
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
        existingRoles={role.roles}
        initialValues={{
          ...parsePractitioner(result.data),
          ...(role.role ? parsePractitionerRole(role.role) : emptyPractitionerRole),
          departments: parseDepartmentRoles(role.roles),
        }}
        initialLogin={{
          loginId: account.data?.login_id ?? "",
          registered: account.data?.registered ?? false,
        }}
      />
    </div>
  );
}

interface EditFormProps {
  practitionerId: string;
  practitioner: fhir4.Practitioner;
  etag: string | null;
  existingRoles: fhir4.PractitionerRole[];
  initialValues: PractitionerFormValues;
  initialLogin: { loginId: string; registered: boolean };
}

function EditForm({
  practitionerId,
  etag,
  existingRoles,
  initialValues,
  initialLogin,
}: EditFormProps) {
  const navigate = useNavigate();
  const updatePractitioner = useUpdatePractitioner();
  const upsertAccount = useUpsertLoginAccount();
  const deleteAccount = useDeleteLoginAccount();
  const [conflict, setConflict] = useState(false);
  const [accountError, setAccountError] = useState<unknown>(null);

  async function handleSubmit(values: PractitionerFormValues, login: PractitionerLoginValues) {
    if (!etag) return;
    setConflict(false);
    setAccountError(null);

    try {
      await updatePractitioner.mutateAsync({
        bundle: buildPractitionerSaveBundle({
          values,
          practitionerId,
          etag,
          existingRoles,
        }),
        practitionerId,
      });
    } catch (error) {
      if (error instanceof FhirError && error.status === 412) setConflict(true);
      return; // updatePractitioner.error が submitError として表示される
    }

    // Practitioner 保存後にログイン設定を反映する。変更が無ければ何も送らない。
    try {
      if (login.loginId) {
        const unchanged =
          initialLogin.registered && login.loginId === initialLogin.loginId && !login.password;
        if (!unchanged) {
          await upsertAccount.mutateAsync({
            practitionerId,
            loginId: login.loginId,
            password: login.password || undefined,
          });
        }
      } else if (initialLogin.registered) {
        // ログインIDを空にして保存 = ログインの無効化
        await deleteAccount.mutateAsync(practitionerId);
      }
    } catch (error) {
      setAccountError(error);
      return;
    }

    navigate("/practitioners");
  }

  const submitting =
    updatePractitioner.isPending || upsertAccount.isPending || deleteAccount.isPending;

  return (
    <>
      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この医療従事者情報は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}
      {accountError != null && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            医療従事者情報は更新されましたが、ログイン設定の保存に失敗しました:{" "}
            {accountError instanceof Error ? accountError.message : "不明なエラー"}
          </p>
        </div>
      )}
      <PractitionerForm
        initialValues={initialValues}
        initialLogin={initialLogin}
        onSubmit={handleSubmit}
        submitting={submitting}
        submitError={conflict ? undefined : updatePractitioner.error}
        submitLabel="更新"
      />
    </>
  );
}
