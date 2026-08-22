import { useState } from "react";
import { useUpdateFacilitySettings } from "../api/adminQueries";
import { useFacilitySettings, useOrganizationOptions } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { organizationDisplayName } from "../fhir/organizationHelpers";

// 「どの Organization が自院か」を指定する。本アプリはマルチテナントではなく、
// 診療科・診察室・スタッフは自院のものしか登録しない。他院は診療情報提供書の
// 宛先候補(連携先)として別に登録するため、その区別の基点になる設定。
export function FacilitySettingsPage() {
  const settings = useFacilitySettings();
  const { organizations, isLoading: loadingOrganizations } = useOrganizationOptions();
  const update = useUpdateFacilitySettings();
  // 未保存の選択。読み込み前は undefined にしておき、保存済みの値を初期表示にする。
  const [selected, setSelected] = useState<string | undefined>(undefined);

  const saved = settings.data?.self_organization_id ?? "";
  const value = selected ?? saved;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    update.mutate(value);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>自院設定</h1>
      </div>
      <p className="connection-settings__lead">
        登録済みの医療機関のうち、どれが自院かを指定します。診療科・診察室・医療従事者は
        ここで選んだ医療機関に所属するものとして登録され、処方箋の医療機関欄や帳票の
        自院欄にもこの医療機関の情報が入ります。
      </p>
      {(settings.isLoading || loadingOrganizations) && <p>読み込み中...</p>}
      <ErrorBanner error={settings.error} />

      <form className="connection-settings-form" onSubmit={handleSubmit}>
        <label>
          自院の医療機関
          <select value={value} onChange={(e) => setSelected(e.target.value)}>
            <option value="">（未設定）</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organizationDisplayName(organization)}
              </option>
            ))}
          </select>
          <span className="connection-settings-form__field-hint">
            候補に無い場合は「マスタメンテ &gt; 共通 &gt; 医療機関」から先に登録してください。
          </span>
        </label>

        <div className="connection-settings-form__actions">
          <button type="submit" disabled={update.isPending}>
            {update.isPending ? "保存中..." : "保存"}
          </button>
        </div>

        {update.isSuccess && (
          <p className="connection-settings-form__success" role="status">
            自院設定を保存しました
          </p>
        )}
        <ErrorBanner error={update.error} />
      </form>
    </div>
  );
}
