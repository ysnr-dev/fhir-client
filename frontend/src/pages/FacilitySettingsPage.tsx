import { useState } from "react";
import { useUpdateFacilitySettings } from "../api/adminQueries";
import { useFacilitySettings, useOrganizationOptions } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import {
  DEFAULT_NURSING_SCHEDULE,
  isValidTime,
  type NursingScheduleSettings,
} from "../fhir/nursingScheduleHelpers";

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

  // 看護指示の既定時刻。未編集の間は保存済み(未設定なら既定値)を出す。
  const [scheduleDraft, setScheduleDraft] = useState<NursingScheduleSettings | undefined>(undefined);
  const savedSchedule = settings.data?.nursing_schedule ?? DEFAULT_NURSING_SCHEDULE;
  const schedule = scheduleDraft ?? savedSchedule;
  const scheduleValid =
    Object.values(schedule.daily).every((times) => times.every(isValidTime)) &&
    isValidTime(schedule.interval_start);

  function updateDailyTime(count: string, index: number, time: string) {
    setScheduleDraft((prev) => {
      const base = prev ?? savedSchedule;
      const times = [...(base.daily[count] ?? [])];
      times[index] = time;
      return { ...base, daily: { ...base.daily, [count]: times } };
    });
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!scheduleValid) return;
    update.mutate({ self_organization_id: value, nursing_schedule: schedule });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>施設設定</h1>
      </div>
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
        </label>

        {/* 看護指示の「1日N回」の既定時刻と「N時間毎」の起点。指示を登録するときの
            初期値で、登録済みの指示には時刻が焼き付いているのでここを変えても動かない。
            普段は触らない設定なので折り畳んでおく。閉じている間はブラウザの必須チェックが
            効かない(非表示の入力にフォーカスできない)ため、required は付けずに
            scheduleValid で保存ボタンを止める。 */}
        <details className="facility-settings__schedule">
          <summary>看護指示の既定時刻</summary>
          <div className="facility-settings__schedule-body">
            {["1", "2", "3", "4"].map((count) => (
              <label key={count}>
                1日{count}回
                <span className="facility-settings__times">
                  {(schedule.daily[count] ?? []).map((time, index) => (
                    <input
                      key={index}
                      type="time"
                      value={time}
                      onChange={(e) => updateDailyTime(count, index, e.target.value)}
                      aria-label={`1日${count}回の ${index + 1} 回目`}
                    />
                  ))}
                </span>
              </label>
            ))}
            <label>
              N時間毎の起点
              <input
                type="time"
                value={schedule.interval_start}
                onChange={(e) =>
                  setScheduleDraft({ ...(scheduleDraft ?? savedSchedule), interval_start: e.target.value })
                }
              />
              <span className="connection-settings-form__field-hint">
                4時間毎ならこの時刻から 4 時間刻みで、その日の予定を組みます。
              </span>
            </label>
          </div>
        </details>

        <div className="connection-settings-form__actions">
          <button type="submit" disabled={update.isPending || !scheduleValid}>
            {update.isPending ? "保存中..." : "保存"}
          </button>
        </div>

        {!scheduleValid && (
          <p className="connection-settings-form__field-hint" role="status">
            「看護指示の既定時刻」に空欄があります。
          </p>
        )}

        {update.isSuccess && (
          <p className="connection-settings-form__success" role="status">
            施設設定を保存しました
          </p>
        )}
        <ErrorBanner error={update.error} />
      </form>
    </div>
  );
}
