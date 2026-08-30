import { useMemo, useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useNursingObservationsByManageNos } from "../api/masterQueries";
import { useFacilitySettings, usePractitionerOptions, useRegisterNursingPerform } from "../api/queries";
import type { NursingPerformDisplay } from "../fhir/nursingPerformHelpers";
import {
  DEFAULT_NURSING_SCHEDULE,
  expandNursingSchedule,
  isDueAround,
  matchPerformsToSchedule,
  minutesOfDateTime,
  nextDueSlot,
  nursingScheduleOf,
  type NursingScheduleSlot,
} from "../fhir/nursingScheduleHelpers";
import { toDateTimeInput } from "../fhir/clinicalNoteHelpers";
import { nursingOrderItem, summarizeNursingOrder } from "../fhir/nursingOrderHelpers";
import {
  buildNursingPerformBundle,
  emptyNursingPerformForm,
  hasAnyNursingPerformValue,
  isObservationOrder,
  nursingObservationInputSpec,
  validateNursingPerformForm,
  type NursingObservationInput,
  type NursingObservationInputSpec,
  type NursingPerformFormValues,
} from "../fhir/nursingPerformHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface Props {
  patientName?: string;
  /** その患者の有効な指示(観察と行為が混在)。呼び出し側が絞って渡す。 */
  orders: fhir4.ServiceRequest[];
  /** 記録日時の既定(datetime-local)。省略時は今。 */
  defaultAt?: string;
  /** 記録日のその患者の実施記録(指示の id ごと)。予定の消化状況を出すのに使う。 */
  performsByOrderId?: Map<string, NursingPerformDisplay[]>;
  onClose: () => void;
}

// 看護指示の実施入力。患者 1 人ぶんの指示を縦に並べ、観察は値を、行為はチェックを
// まとめて入れて 1 transaction で保存する(ラウンドで 1 患者ぶんを一度に記録する運用)。
//
// 他部門の実施入力と違い、進捗 Task を動かさない(fhir/nursingPerformHelpers.ts)。
// 観察の入力欄は MEDIS 観察マスタの表現タイプで切り替える。マスタが引けない指示
// (自由記載)は文字入力にする。
export function NursingPerformModal({
  patientName,
  orders,
  defaultAt,
  performsByOrderId,
  onClose,
}: Props) {
  const register = useRegisterNursingPerform();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const { practitioners, error: practitionersError } = usePractitionerOptions();

  const facility = useFacilitySettings();
  const scheduleSettings = facility.data?.nursing_schedule ?? DEFAULT_NURSING_SCHEDULE;
  // マスタ引きに使う元の並び。表示用の並び(予定のあるものを上に)は後で作る。
  const observationBase = useMemo(() => orders.filter(isObservationOrder), [orders]);

  // 観察指示の表現タイプ・単位・選択肢はマスタにしかない(指示には管理番号だけ)。
  const manageNos = useMemo(
    () =>
      observationBase
        .map((order) => nursingOrderItem(order))
        .flatMap((item) => (item?.kind === "observation" ? [item.manageNo] : [])),
    [observationBase],
  );
  const masters = useNursingObservationsByManageNos(manageNos);
  const specs = useMemo(() => {
    const map = new Map<string, NursingObservationInputSpec>();
    for (const order of observationBase) {
      const item = nursingOrderItem(order);
      const obs = item?.kind === "observation" ? masters.data?.get(item.manageNo) : undefined;
      map.set(order.id ?? "", nursingObservationInputSpec(obs));
    }
    return map;
  }, [observationBase, masters.data]);

  const [values, setValues] = useState<NursingPerformFormValues>(() => ({
    ...emptyNursingPerformForm(orders, defaultAt || toDateTimeInput(new Date())),
    performerId: practitionerId ?? "",
    performerName: practitioner ? practitionerDisplayName(practitioner) : "",
  }));
  const [validationError, setValidationError] = useState("");

  // 記録日時を基準に、指示ごとの予定の消化状況と「いま入れるべきか」を出す。
  // 記録日時を変えれば並びと強調が追従する。
  const recordedDate = values.recordedAt.slice(0, 10);
  const recordedMinutes = minutesOfDateTime(values.recordedAt) ?? 0;
  const scheduleByOrderId = useMemo(() => {
    const map = new Map<string, { slots: NursingScheduleSlot[]; due: boolean }>();
    for (const order of orders) {
      const id = order.id ?? "";
      const times = expandNursingSchedule(nursingScheduleOf(order), recordedDate, scheduleSettings);
      const { slots } = matchPerformsToSchedule(times, performsByOrderId?.get(id) ?? []);
      map.set(id, { slots, due: slots.length > 0 && isDueAround(slots, recordedMinutes) });
    }
    return map;
  }, [orders, recordedDate, recordedMinutes, scheduleSettings, performsByOrderId]);

  // いま予定のある指示を上に(安定ソートなので元の並びは保つ)。予定の無い指示も
  // 入力はできるが薄く出す(臨時の測定・頓用の記録のため)。
  const byDue = (a: fhir4.ServiceRequest, b: fhir4.ServiceRequest) =>
    Number(scheduleByOrderId.get(b.id ?? "")?.due ?? false) -
    Number(scheduleByOrderId.get(a.id ?? "")?.due ?? false);
  const observationOrders = useMemo(
    () => [...observationBase].sort(byDue),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [observationBase, scheduleByOrderId],
  );
  const actOrders = useMemo(
    () => orders.filter((o) => !isObservationOrder(o)).sort(byDue),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, scheduleByOrderId],
  );
  const rowClass = (order: fhir4.ServiceRequest) => {
    const state = scheduleByOrderId.get(order.id ?? "");
    return state && state.slots.length > 0 && !state.due ? "nursing-perform__row--idle" : undefined;
  };

  function updateObservation(orderId: string, patch: Partial<NursingObservationInput>) {
    setValues((prev) => ({
      ...prev,
      observations: {
        ...prev.observations,
        [orderId]: { ...(prev.observations[orderId] ?? { values: ["", ""], note: "" }), ...patch },
      },
    }));
  }

  function updateObservationValue(orderId: string, index: 0 | 1, value: string) {
    const current = values.observations[orderId]?.values ?? ["", ""];
    const next: [string, string] = [current[0], current[1]];
    next[index] = value;
    updateObservation(orderId, { values: next });
  }

  function updateAct(orderId: string, patch: Partial<{ done: boolean; note: string }>) {
    setValues((prev) => ({
      ...prev,
      acts: { ...prev.acts, [orderId]: { ...(prev.acts[orderId] ?? { done: false, note: "" }), ...patch } },
    }));
  }

  function handlePerformerChange(id: string) {
    const selected = practitioners.find((p) => p.id === id);
    setValues((prev) => ({
      ...prev,
      performerId: id,
      performerName: selected ? practitionerDisplayName(selected) : "",
    }));
  }

  const mastersReady = manageNos.length === 0 || !masters.isPending;
  const canSubmit = mastersReady && hasAnyNursingPerformValue(values) && !register.isPending;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateNursingPerformForm(values, orders, specs);
    setValidationError(error);
    if (error) return;
    register.mutate(buildNursingPerformBundle(values, orders, specs), { onSuccess: onClose });
  }

  return (
    <Modal
      title={`実施記録${patientName ? ` - ${patientName}` : ""}`}
      onClose={onClose}
      className="modal--wide"
    >
      <form className="transfusion-perform" onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={register.error} />
        <ErrorBanner error={practitionersError} />
        <ErrorBanner error={masters.error} />

        <div className="lab-order-item__fields">
          <label>
            記録日時 *
            <input
              type="datetime-local"
              value={values.recordedAt}
              onChange={(e) => setValues((prev) => ({ ...prev, recordedAt: e.target.value }))}
              required
            />
          </label>
          <label>
            実施者
            <select value={values.performerId} onChange={(e) => handlePerformerChange(e.target.value)}>
              <option value="">選択してください</option>
              {practitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {practitionerDisplayName(p)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {observationOrders.length > 0 && (
          <section className="lab-order-item__section">
            <div className="lab-order-item__section-head">
              <h3>観察</h3>
            </div>
            {!mastersReady ? (
              <p>読み込み中...</p>
            ) : (
              <table className="nursing-perform__table">
                <thead>
                  <tr>
                    <th>指示内容</th>
                    <th>頻度・条件</th>
                    <th>値</th>
                    <th>備考</th>
                  </tr>
                </thead>
                <tbody>
                  {observationOrders.map((order) => {
                    const id = order.id ?? "";
                    const summary = summarizeNursingOrder(order);
                    const input = values.observations[id] ?? { values: ["", ""], note: "" };
                    return (
                      <tr key={id} className={rowClass(order)}>
                        <td>{summary.text}</td>
                        <td className="nursing-perform__muted">
                          {summary.frequency}
                          <ScheduleBadges
                            slots={scheduleByOrderId.get(id)?.slots ?? []}
                            nowMinutes={recordedMinutes}
                          />
                        </td>
                        <td>
                          <ObservationInput
                            spec={specs.get(id) ?? { kind: "text" }}
                            values={input.values}
                            onChange={(index, value) => updateObservationValue(id, index, value)}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={input.note}
                            onChange={(e) => updateObservation(id, { note: e.target.value })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        )}

        {actOrders.length > 0 && (
          <section className="lab-order-item__section">
            <div className="lab-order-item__section-head">
              <h3>行為</h3>
            </div>
            <table className="nursing-perform__table">
              <thead>
                <tr>
                  <th className="nursing-worklist__check"></th>
                  <th>指示内容</th>
                  <th>頻度・条件</th>
                  <th>備考</th>
                </tr>
              </thead>
              <tbody>
                {actOrders.map((order) => {
                  const id = order.id ?? "";
                  const summary = summarizeNursingOrder(order);
                  const input = values.acts[id] ?? { done: false, note: "" };
                  return (
                    <tr key={id} className={rowClass(order)}>
                      <td className="nursing-worklist__check">
                        <input
                          type="checkbox"
                          checked={input.done}
                          onChange={(e) => updateAct(id, { done: e.target.checked })}
                          aria-label={`${summary.text} を実施した`}
                        />
                      </td>
                      <td>{summary.text}</td>
                      <td className="nursing-perform__muted">
                        {summary.frequency}
                        <ScheduleBadges
                          slots={scheduleByOrderId.get(id)?.slots ?? []}
                          nowMinutes={recordedMinutes}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={input.note}
                          onChange={(e) => updateAct(id, { note: e.target.value })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {orders.length === 0 && <p className="patient-table__empty">有効な指示がありません。</p>}

        <div className="prescription-form__actions">
          <button type="submit" disabled={!canSubmit}>
            {register.isPending ? "登録中..." : "記録"}
          </button>
          <button type="button" onClick={onClose} disabled={register.isPending}>
            キャンセル
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** 表現タイプごとの入力欄。 */
function ObservationInput({
  spec,
  values,
  onChange,
}: {
  spec: NursingObservationInputSpec;
  values: [string, string];
  onChange: (index: 0 | 1, value: string) => void;
}) {
  switch (spec.kind) {
    case "number":
      return (
        <span className="nursing-perform__value">
          <input
            type="number"
            step={spec.mask.step}
            max={spec.mask.max}
            value={values[0]}
            onChange={(e) => onChange(0, e.target.value)}
          />
          {spec.unit && <span className="nursing-perform__unit">{spec.unit}</span>}
        </span>
      );
    case "enum":
      return (
        <select value={values[0]} onChange={(e) => onChange(0, e.target.value)}>
          <option value="">-</option>
          {spec.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    case "pair":
      return (
        <span className="nursing-perform__value">
          <input
            type="number"
            step={spec.masks[0].step}
            max={spec.masks[0].max}
            value={values[0]}
            onChange={(e) => onChange(0, e.target.value)}
            placeholder={spec.labels[0]}
            aria-label={spec.labels[0]}
          />
          {spec.units[0] && <span className="nursing-perform__unit">{spec.units[0]}</span>}
          <input
            type="number"
            step={spec.masks[1].step}
            max={spec.masks[1].max}
            value={values[1]}
            onChange={(e) => onChange(1, e.target.value)}
            placeholder={spec.labels[1]}
            aria-label={spec.labels[1]}
          />
          {spec.units[1] && <span className="nursing-perform__unit">{spec.units[1]}</span>}
        </span>
      );
    case "bp":
      return (
        <span className="nursing-perform__value">
          <input
            type="number"
            step={1}
            value={values[0]}
            onChange={(e) => onChange(0, e.target.value)}
            placeholder="収縮期"
            aria-label="収縮期血圧"
          />
          <span className="nursing-perform__unit">/</span>
          <input
            type="number"
            step={1}
            value={values[1]}
            onChange={(e) => onChange(1, e.target.value)}
            placeholder="拡張期"
            aria-label="拡張期血圧"
          />
          <span className="nursing-perform__unit">mmHg</span>
        </span>
      );
    default:
      return <input type="text" value={values[0]} onChange={(e) => onChange(0, e.target.value)} />;
  }
}

/** その日の予定の消化状況。✓ は実施済、● は次に入れる予定(遅れは赤)。 */
function ScheduleBadges({ slots, nowMinutes }: { slots: NursingScheduleSlot[]; nowMinutes: number }) {
  if (slots.length === 0) return null;
  const next = nextDueSlot(slots, nowMinutes);
  return (
    <span className="nursing-perform__slots">
      {slots.map((slot) => {
        const isNext = next?.slot === slot;
        const cls = slot.done
          ? "nursing-perform__slot nursing-perform__slot--done"
          : isNext
            ? `nursing-perform__slot nursing-perform__slot--next${next?.late ? " nursing-perform__slot--late" : ""}`
            : "nursing-perform__slot";
        return (
          <span key={slot.time} className={cls} title={slot.done ? `${slot.done.atLabel} ${slot.done.value}` : undefined}>
            {slot.time}
            {slot.done ? "✓" : isNext ? "●" : ""}
          </span>
        );
      })}
    </span>
  );
}
