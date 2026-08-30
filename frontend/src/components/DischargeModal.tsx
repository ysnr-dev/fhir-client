import { useMemo, useState } from "react";
import { usePatientRehabOrders, usePatientNursingOrders, useDischargePatient } from "../api/queries";
import {
  encounterAdmissionDate,
  encounterPatientId,
  validateDischargeDate,
} from "../fhir/encounterHelpers";
import { buildDischargeSyncEntries, dischargeStopPoint } from "../fhir/mealEncounterSync";
import { mealPointDisplay } from "../fhir/mealOrderHelpers";
import { displayName } from "../fhir/patientHelpers";
import { rehabOrderNeedsStop, summarizeRehabOrder } from "../fhir/rehabOrderHelpers";
import { nursingOrderNeedsStop, summarizeNursingOrder } from "../fhir/nursingOrderHelpers";
import { useMealSyncContext } from "../hooks/useMealSyncContext";
import { nowDateTimeInput } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { MealSyncSummary } from "./MealSyncSummary";
import { Modal } from "./Modal";

// 退院。入院取消(誤登録)と違って退院日時を残すので、日時だけ聞く小さなモーダルにする。
//
// 食事オーダーは終了を書くまで続くので、退院で一緒に止める。どの食事まで出すかは
// 退院時刻と施設の食事提供時刻から決める(手で選ばせない)。退院予定で既に止めて
// いれば理由を「退院」に上書きする。退院取消で戻せるよう理由を残す。
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
  const [dischargeAt, setDischargeAt] = useState(nowDateTimeInput);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [stopMeals, setStopMeals] = useState(true);
  const [stopRehab, setStopRehab] = useState(true);
  const discharge = useDischargePatient();

  const patientId = encounterPatientId(encounter);
  const meal = useMealSyncContext(encounter);
  const dischargeDate = dischargeAt.slice(0, 10);
  const mealEntries = useMemo(
    () => (dischargeAt ? buildDischargeSyncEntries(meal.ctx, dischargeAt, "discharge") : []),
    [meal.ctx, dischargeAt],
  );
  const stopPoint = dischargeAt ? dischargeStopPoint(meal.ctx, dischargeAt) : null;

  const rehabOrders = usePatientRehabOrders(patientId);
  const stoppingRehab = (rehabOrders.data ?? []).filter((sr) =>
    rehabOrderNeedsStop(sr, dischargeDate),
  );

  const [stopNursing, setStopNursing] = useState(true);
  const nursingOrders = usePatientNursingOrders(patientId);
  const stoppingNursing = (nursingOrders.data?.orders ?? []).filter((sr) =>
    nursingOrderNeedsStop(sr, dischargeDate),
  );

  function handleSubmit() {
    const error = validateDischargeDate(encounter, dischargeAt);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    discharge.mutate(
      {
        encounter,
        dischargeAt,
        mealEntries: stopMeals ? mealEntries : [],
        rehabOrders: stopRehab ? stoppingRehab : [],
        nursingOrders: stopNursing ? stoppingNursing : [],
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="退院" onClose={onClose}>
      <ErrorBanner error={discharge.error} />
      <ErrorBanner error={meal.error} />
      <ErrorBanner error={rehabOrders.error} />
      <ErrorBanner error={nursingOrders.error} />
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
            退院日時(必須)
            <input
              type="datetime-local"
              value={dischargeAt}
              onChange={(e) => setDischargeAt(e.target.value)}
            />
          </label>
        </div>

        <MealSyncSummary
          title={`食事オーダーを ${stopPoint ? mealPointDisplay(stopPoint) : ""}食までで終了する`}
          entries={mealEntries}
          orders={meal.ctx.orders}
          enabled={stopMeals}
          onToggle={setStopMeals}
        />

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

        {stoppingNursing.length > 0 && (
          <div className="discharge__meal">
            <label className="discharge__meal-toggle">
              <input
                type="checkbox"
                checked={stopNursing}
                onChange={(e) => setStopNursing(e.target.checked)}
              />
              看護指示を退院日で終了する
            </label>
            <ul className="discharge__meal-list">
              {stoppingNursing.map((sr) => {
                const summary = summarizeNursingOrder(sr);
                return (
                  <li key={sr.id}>
                    {summary.text}
                    {summary.frequency ? ` (${summary.frequency})` : ""}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="walk-in__actions">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={discharge.isPending || !meal.ready}
          >
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
