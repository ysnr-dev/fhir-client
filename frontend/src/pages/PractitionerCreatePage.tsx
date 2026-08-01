import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUpsertLoginAccount } from "../api/authQueries";
import { useCreatePractitioner } from "../api/queries";
import { PractitionerForm, type PractitionerLoginValues } from "../components/PractitionerForm";
import {
  buildPractitionerSaveBundle,
  createdPractitionerId,
  type PractitionerFormValues,
} from "../fhir/practitionerHelpers";

export function PractitionerCreatePage() {
  const navigate = useNavigate();
  const createPractitioner = useCreatePractitioner();
  const upsertAccount = useUpsertLoginAccount();
  // Practitioner の作成は成功したがログイン設定の保存で失敗した状態。
  // このままフォームを再送信すると Practitioner が二重登録されるので、
  // 編集画面からの再設定へ誘導する。
  const [accountFailure, setAccountFailure] = useState<{
    practitionerId?: string;
    error: unknown;
  } | null>(null);

  async function handleSubmit(values: PractitionerFormValues, login: PractitionerLoginValues) {
    setAccountFailure(null);

    let practitionerId: string | undefined;
    try {
      const result = await createPractitioner.mutateAsync(buildPractitionerSaveBundle({ values }));
      practitionerId = createdPractitionerId(result.data);
    } catch {
      return; // createPractitioner.error が submitError として表示される
    }

    if (login.loginId) {
      if (!practitionerId) {
        // レスポンス Bundle から ID が取れないのは想定外。黙って握り潰さない。
        setAccountFailure({
          error: new Error("作成された医療従事者の ID を特定できませんでした"),
        });
        return;
      }
      try {
        await upsertAccount.mutateAsync({
          practitionerId,
          loginId: login.loginId,
          password: login.password,
        });
      } catch (error) {
        setAccountFailure({ practitionerId, error });
        return;
      }
    }

    navigate("/practitioners");
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>医療従事者登録</h1>
        <Link to="/practitioners" className="button">
          ← 一覧に戻る
        </Link>
      </div>
      {accountFailure && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            医療従事者は登録されましたが、ログイン設定の保存に失敗しました:{" "}
            {accountFailure.error instanceof Error
              ? accountFailure.error.message
              : "不明なエラー"}
          </p>
          {accountFailure.practitionerId && (
            <p className="error-banner__line">
              <Link to={`/practitioners/${accountFailure.practitionerId}/edit`}>
                編集画面からログイン設定をやり直す
              </Link>
            </p>
          )}
        </div>
      )}
      <PractitionerForm
        onSubmit={handleSubmit}
        submitting={createPractitioner.isPending || upsertAccount.isPending}
        submitError={createPractitioner.error}
        submitLabel="登録"
      />
    </div>
  );
}
