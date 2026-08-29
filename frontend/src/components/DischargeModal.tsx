import { useState } from "react";
import {
  usePatientMealOrders,
  usePatientRehabOrders,
  useDischargePatient,
} from "../api/queries";
import {
  encounterAdmissionDate,
  encounterPatientId,
  validateDischargeDate,
} from "../fhir/encounterHelpers";
import {
  DEFAULT_MEAL_STOP_TIMING,
  MEAL_TIMING_OPTIONS,
  mealOrderNeedsStop,
  mealStapleText,
  summarizeMealOrder,
  type MealTiming,
} from "../fhir/mealOrderHelpers";
import { displayName } from "../fhir/patientHelpers";
import { rehabOrderNeedsStop, summarizeRehabOrder } from "../fhir/rehabOrderHelpers";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 退院。入院取消(誤登録)と違って退院日を残すので、日付だけ聞く小さなモーダルにする。
//
// 食事オーダーは終了を書くまで続くので、退院で一緒に止める。止める食事(退院日の
// どこまで出すか)は施設や退院時刻で変わるため画面で選ばせ、既定は「朝まで」。
//
// リハビリオーダーも同じ期間継続型なので一緒に止める。こちらは食事のような時間帯を
// 持たないので退院日をそのまま終了日にする。外来リハに切り替えて続けることもあるので、
// 食事と別のチェックにして外せるようにしてある。

interface DischargeModalProps {
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
  bedLabel: string;
  onClose: () => void;
}

export function DischargeModal({ encounter, patient, bedLabel, onClose }: DischargeModalProps) {
  const [dischargeDate, setDischargeDate] = useState(today);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [stopMeals, setStopMeals] = useState(true);
  const [mealEndTiming, setMealEndTiming] = useState<MealTiming>(DEFAULT_MEAL_STOP_TIMING);
  const [stopRehab, setStopRehab] = useState(true);
  const discharge = useDischargePatient();

  const patientId = encounterPatientId(encounter);
  const mealOrders = usePatientMealOrders(patientId);
  // 退院日のその食事より後まで続くものだけが止める対象(すでに終わっているものは触らない)。
  const stopping = (mealOrders.data ?? []).filter((sr) =>
    mealOrderNeedsStop(sr, dischargeDate, mealEndTiming),
  );

  const rehabOrders = usePatientRehabOrders(patientId);
  const stoppingRehab = (rehabOrders.data ?? []).filter((sr) =>
    rehabOrderNeedsStop(sr, dischargeDate),
  );

  function handleSubmit() {
    const error = validateDischargeDate(encounter, dischargeDate);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    discharge.mutate(
      {
        encounter,
        dischargeDate,
        mealOrders: stopMeals ? stopping : [],
        mealEndTiming,
        rehabOrders: stopRehab ? stoppingRehab : [],
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="退院" onClose={onClose}>
      <ErrorBanner error={discharge.error} />
      <ErrorBanner error={mealOrders.error} />
      <ErrorBanner error={rehabOrders.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <div className="walk-in">
        <div className="walk-in__patient">
          <span>{patient ? displayName(patient) : "(患者不明)"}</span>
          <span>{bedLabel}</span>
        </div>

        <div className="walk-in__fields">
          <label>
            入院日
            <input type="text" value={encounterAdmissionDate(encounter)} readOnly />
          </label>
          <label>
            退院日(必須)
            <input
              type="date"
              value={dischargeDate}
              onChange={(e) => setDischargeDate(e.target.value)}
            />
          </label>
        </div>

        {stopping.length > 0 && (
          <div className="discharge__meal">
            <label className="discharge__meal-toggle">
              <input
                type="checkbox"
                checked={stopMeals}
                onChange={(e) => setStopMeals(e.target.checked)}
              />
              食事オーダーを終了する
            </label>
            <label className="discharge__meal-timing">
              退院日は
              <select
                value={mealEndTiming}
                onChange={(e) => setMealEndTiming(e.target.value as MealTiming)}
                disabled={!stopMeals}
              >
                {MEAL_TIMING_OPTIONS.map((timing) => (
                  <option key={timing.code} value={timing.code}>
                    {timing.display}食まで
                  </option>
                ))}
              </select>
            </label>
            <ul className="discharge__meal-list">
              {stopping.map((sr) => {
                const summary = summarizeMealOrder(sr);
                const staple = mealStapleText(summary);
                return (
                  <li key={sr.id}>
                    {summary.dietName}
                    {staple && `(${staple})`} {summary.startLabel}〜
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {stoppingRehab.length > 0 && (
          <div className="discharge__meal">
            <label className="discharge__meal-toggle">
              <input
                type="checkbox"
                checked={stopRehab}
                onChange={(e) => setStopRehab(e.target.checked)}
              />
              リハビリオーダーを退院日で終了する
            </label>
            <ul className="discharge__meal-list">
              {stoppingRehab.map((sr) => {
                const summary = summarizeRehabOrder(sr);
                return (
                  <li key={sr.id}>
                    {summary.diseaseCategoryShort} {summary.therapyTypesLabel}{" "}
                    {summary.periodLabel}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="walk-in__actions">
          <button type="button" onClick={handleSubmit} disabled={discharge.isPending}>
            {discharge.isPending ? "退院処理中..." : "退院"}
          </button>
          <button type="button" onClick={onClose} disabled={discharge.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
