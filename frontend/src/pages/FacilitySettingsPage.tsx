import { useState } from "react";
import { useUpdateFacilitySettings } from "../api/adminQueries";
import { useFacilitySettings, useOrganizationOptions } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import {
  DEFAULT_MEAL_SCHEDULE,
  MEAL_TIMING_OPTIONS,
  type MealScheduleSettings,
} from "../fhir/mealOrderHelpers";
import {
  DEFAULT_NURSING_SCHEDULE,
  isValidTime,
  type NursingScheduleSettings,
} from "../fhir/nursingScheduleHelpers";
import {
  DEFAULT_VITAL_THRESHOLDS,
  VITAL_THRESHOLD_ITEMS,
  type VitalThresholdSettings,
} from "../fhir/vitalHelpers";
import {
  EMPTY_WATER_BALANCE,
  type WaterBalanceSettings,
} from "../fhir/flowsheetWaterBalanceHelpers";
import {
  DEFAULT_MEDICATION_SCHEDULE,
  type MedicationScheduleSettings,
} from "../fhir/medicationScheduleHelpers";
import { useNursingObservationsByManageNos } from "../api/masterQueries";
import { NursingItemSearchModal } from "../components/NursingItemSearchModal";

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

  // 食事の提供時刻。退院・外出泊の時刻から「どの食事まで / どの食事から」を決めるのに使う。
  const [mealDraft, setMealDraft] = useState<MealScheduleSettings | undefined>(undefined);
  const savedMeal = settings.data?.meal_schedule ?? DEFAULT_MEAL_SCHEDULE;
  const mealSchedule = mealDraft ?? savedMeal;
  const mealValid =
    MEAL_TIMING_OPTIONS.every((t) => isValidTime(mealSchedule[t.code])) &&
    mealSchedule.breakfast < mealSchedule.lunch &&
    mealSchedule.lunch < mealSchedule.dinner;

  // 経過表の異常値のしきい値。項目ごとに下限・上限を持ち、空欄はその側を判定しない。
  const [thresholdDraft, setThresholdDraft] = useState<VitalThresholdSettings | undefined>(undefined);
  const savedThresholds = settings.data?.vital_thresholds ?? DEFAULT_VITAL_THRESHOLDS;
  const thresholds = thresholdDraft ?? savedThresholds;
  const thresholdsValid = VITAL_THRESHOLD_ITEMS.every((item) => {
    const { low, high } = thresholds[item.code] ?? {};
    return low == null || high == null || low < high;
  });

  function updateThreshold(code: string, side: "low" | "high", raw: string) {
    setThresholdDraft((prev) => {
      const base = prev ?? savedThresholds;
      const bounds = { ...(base[code] ?? {}) };
      if (raw === "") delete bounds[side];
      else bounds[side] = Number(raw);
      return { ...base, [code]: bounds };
    });
  }

  // 内服の与薬の予定時刻。食事の時刻からのずらしと、就寝前・起床時の時刻。
  const [medicationDraft, setMedicationDraft] = useState<MedicationScheduleSettings | undefined>(
    undefined,
  );
  const savedMedication = settings.data?.medication_schedule ?? DEFAULT_MEDICATION_SCHEDULE;
  const medicationSchedule = medicationDraft ?? savedMedication;
  const medicationValid =
    isValidTime(medicationSchedule.bedtime) &&
    isValidTime(medicationSchedule.wake_time) &&
    [medicationSchedule.before_meal_minutes, medicationSchedule.after_meal_minutes].every(
      (minutes) => Number.isFinite(minutes) && minutes >= 0,
    );

  function updateMedication<K extends keyof MedicationScheduleSettings>(
    key: K,
    value: MedicationScheduleSettings[K],
  ) {
    setMedicationDraft((prev) => ({ ...(prev ?? savedMedication), [key]: value }));
  }

  // 水分出納に数える看護観察。管理番号だけを保存し、名前はマスタから引く。
  const [balanceDraft, setBalanceDraft] = useState<WaterBalanceSettings | undefined>(undefined);
  const savedBalance = settings.data?.water_balance ?? EMPTY_WATER_BALANCE;
  const balance = balanceDraft ?? savedBalance;
  // 選択中の項目を選ぶモーダル。開いている側("in" / "out")を持つ。
  const [pickingSide, setPickingSide] = useState<keyof WaterBalanceSettings | null>(null);
  const balanceNames = useNursingObservationsByManageNos([...balance.in, ...balance.out]);

  function addBalanceItem(side: keyof WaterBalanceSettings, manageNo: string) {
    setBalanceDraft((prev) => {
      const base = prev ?? savedBalance;
      if (base[side].includes(manageNo)) return base;
      return { ...base, [side]: [...base[side], manageNo] };
    });
  }

  function removeBalanceItem(side: keyof WaterBalanceSettings, manageNo: string) {
    setBalanceDraft((prev) => {
      const base = prev ?? savedBalance;
      return { ...base, [side]: base[side].filter((code) => code !== manageNo) };
    });
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!scheduleValid || !mealValid || !thresholdsValid || !medicationValid) return;
    update.mutate({
      self_organization_id: value,
      nursing_schedule: schedule,
      meal_schedule: mealSchedule,
      vital_thresholds: thresholds,
      water_balance: balance,
      medication_schedule: medicationSchedule,
    });
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

        {/* 食事の提供時刻。退院・外出泊の時刻と突き合わせて「退院日は朝食まで」
            「帰院後は夕食から」を自動で決める。食事オーダーの時刻(08/12/18)は SS-MIX2 の
            コードなので、ここを変えても登録済みのオーダーは動かない。 */}
        <details className="facility-settings__schedule">
          <summary>食事の提供時刻</summary>
          <div className="facility-settings__schedule-body">
            {MEAL_TIMING_OPTIONS.map((timing) => (
              <label key={timing.code}>
                {timing.display}食
                <input
                  type="time"
                  value={mealSchedule[timing.code]}
                  onChange={(e) =>
                    setMealDraft({ ...(mealDraft ?? savedMeal), [timing.code]: e.target.value })
                  }
                />
              </label>
            ))}
            <span className="connection-settings-form__field-hint">
              退院・外出泊の時刻と比べて、その時刻までに出た最後の食事で止め、その時刻以降に
              出る最初の食事から戻します。
            </span>
          </div>
        </details>

        {/* 経過表でバイタルを異常値(H/L)として色付けするしきい値。上限以上で H、下限以下で L。
            空欄はその側を判定しない。表示時に判定するので、変えれば過去の測定にも効く。 */}
        <details className="facility-settings__schedule">
          <summary>バイタルの異常値</summary>
          <div className="facility-settings__schedule-body">
            {VITAL_THRESHOLD_ITEMS.map((item) => (
              <label key={item.code}>
                {item.label}
                <span className="facility-settings__times">
                  <input
                    type="number"
                    step={item.step}
                    value={thresholds[item.code]?.low ?? ""}
                    onChange={(e) => updateThreshold(item.code, "low", e.target.value)}
                    aria-label={`${item.label}の下限`}
                    placeholder="下限"
                  />
                  <input
                    type="number"
                    step={item.step}
                    value={thresholds[item.code]?.high ?? ""}
                    onChange={(e) => updateThreshold(item.code, "high", e.target.value)}
                    aria-label={`${item.label}の上限`}
                    placeholder="上限"
                  />
                </span>
              </label>
            ))}
          </div>
        </details>

        {/* 内服の与薬の予定時刻。処方は「1日3回・食後」までしか持たないので、食事の
            時刻(上の設定)からのずらしと、就寝前・起床時の時刻をここで決める。表示時に
            計算するので、変えれば過去の処方の予定にも効く。 */}
        <details className="facility-settings__schedule">
          <summary>内服の与薬の時刻</summary>
          <div className="facility-settings__schedule-body">
            <label>
              食前・食直前
              <span className="facility-settings__times">
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={medicationSchedule.before_meal_minutes}
                  onChange={(e) => updateMedication("before_meal_minutes", Number(e.target.value))}
                  aria-label="食前の分"
                />
                <span className="facility-settings__unit">分前</span>
              </span>
            </label>
            <label>
              食直後・食後
              <span className="facility-settings__times">
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={medicationSchedule.after_meal_minutes}
                  onChange={(e) => updateMedication("after_meal_minutes", Number(e.target.value))}
                  aria-label="食後の分"
                />
                <span className="facility-settings__unit">分後</span>
              </span>
            </label>
            <label>
              就寝前
              <input
                type="time"
                value={medicationSchedule.bedtime}
                onChange={(e) => updateMedication("bedtime", e.target.value)}
              />
            </label>
            <label>
              起床時
              <input
                type="time"
                value={medicationSchedule.wake_time}
                onChange={(e) => updateMedication("wake_time", e.target.value)}
              />
            </label>
          </div>
        </details>

        {/* 経過表の水分出納に数える看護観察。同じ名前で単位違いの項目(尿量 mL / g)が
            あるので管理番号で持つ。集計できるのは mL の項目だけなので候補も mL に絞る。 */}
        <details className="facility-settings__schedule">
          <summary>水分出納の対象項目</summary>
          <div className="facility-settings__schedule-body">
            {(["in", "out"] as const).map((side) => (
              <div key={side} className="facility-settings__balance">
                <span className="facility-settings__balance-label">
                  {side === "in" ? "IN（摂取）" : "OUT（排泄）"}
                </span>
                <ul className="facility-settings__balance-list">
                  {balance[side].map((manageNo) => (
                    <li key={manageNo}>
                      <span>{balanceNames.data?.get(manageNo)?.name ?? manageNo}</span>
                      <button
                        type="button"
                        aria-label={`${balanceNames.data?.get(manageNo)?.name ?? manageNo} を削除`}
                        onClick={() => removeBalanceItem(side, manageNo)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="rp-card__compact-button"
                  onClick={() => setPickingSide(side)}
                >
                  + 項目を追加
                </button>
              </div>
            ))}
          </div>
        </details>

        <div className="connection-settings-form__actions">
          <button
            type="submit"
            disabled={
              update.isPending ||
              !scheduleValid ||
              !mealValid ||
              !thresholdsValid ||
              !medicationValid
            }
          >
            {update.isPending ? "保存中..." : "保存"}
          </button>
        </div>

        {!scheduleValid && (
          <p className="connection-settings-form__field-hint" role="status">
            「看護指示の既定時刻」に空欄があります。
          </p>
        )}
        {!mealValid && (
          <p className="connection-settings-form__field-hint" role="status">
            「食事の提供時刻」は朝・昼・夕の順に、すべて入れてください。
          </p>
        )}
        {!thresholdsValid && (
          <p className="connection-settings-form__field-hint" role="status">
            「バイタルの異常値」は下限より上限を大きくしてください。
          </p>
        )}

        {!medicationValid && (
          <p className="connection-settings-form__field-hint" role="status">
            「内服の与薬の時刻」は 0 以上の分と、HH:MM の時刻で入れてください。
          </p>
        )}
        {update.isSuccess && (
          <p className="connection-settings-form__success" role="status">
            施設設定を保存しました
          </p>
        )}
        <ErrorBanner error={update.error} />
      </form>

      {pickingSide && (
        <NursingItemSearchModal
          only="observation"
          onSelect={(item) => {
            if (item?.kind === "observation") addBalanceItem(pickingSide, item.manageNo);
            setPickingSide(null);
          }}
          onClose={() => setPickingSide(null)}
        />
      )}
    </div>
  );
}
