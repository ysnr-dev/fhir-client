import { useMemo, useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useNursingObservationsByManageNos } from "../api/masterQueries";
import { usePractitionerOptions, useRegisterNursingPerform } from "../api/queries";
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
  onClose: () => void;
}

// 看護指示の実施入力。患者 1 人ぶんの指示を縦に並べ、観察は値を、行為はチェックを
// まとめて入れて 1 transaction で保存する(ラウンドで 1 患者ぶんを一度に記録する運用)。
//
// 他部門の実施入力と違い、進捗 Task を動かさない(fhir/nursingPerformHelpers.ts)。
// 観察の入力欄は MEDIS 観察マスタの表現タイプで切り替える。マスタが引けない指示
// (自由記載)は文字入力にする。
export function NursingPerformModal({ patientName, orders, defaultAt, onClose }: Props) {
  const register = useRegisterNursingPerform();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const { practitioners, error: practitionersError } = usePractitionerOptions();

  const observationOrders = useMemo(() => orders.filter(isObservationOrder), [orders]);
  const actOrders = useMemo(() => orders.filter((o) => !isObservationOrder(o)), [orders]);

  // 観察指示の表現タイプ・単位・選択肢はマスタにしかない(指示には管理番号だけ)。
  const manageNos = useMemo(
    () =>
      observationOrders
        .map((order) => nursingOrderItem(order))
        .flatMap((item) => (item?.kind === "observation" ? [item.manageNo] : [])),
    [observationOrders],
  );
  const masters = useNursingObservationsByManageNos(manageNos);
  const specs = useMemo(() => {
    const map = new Map<string, NursingObservationInputSpec>();
    for (const order of observationOrders) {
      const item = nursingOrderItem(order);
      const obs = item?.kind === "observation" ? masters.data?.get(item.manageNo) : undefined;
      map.set(order.id ?? "", nursingObservationInputSpec(obs));
    }
    return map;
  }, [observationOrders, masters.data]);

  const [values, setValues] = useState<NursingPerformFormValues>(() => ({
    ...emptyNursingPerformForm(orders, defaultAt || toDateTimeInput(new Date())),
    performerId: practitionerId ?? "",
    performerName: practitioner ? practitionerDisplayName(practitioner) : "",
  }));
  const [validationError, setValidationError] = useState("");

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
                      <tr key={id}>
                        <td>{summary.text}</td>
                        <td className="nursing-perform__muted">{summary.frequency}</td>
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
                    <tr key={id}>
                      <td className="nursing-worklist__check">
                        <input
                          type="checkbox"
                          checked={input.done}
                          onChange={(e) => updateAct(id, { done: e.target.checked })}
                          aria-label={`${summary.text} を実施した`}
                        />
                      </td>
                      <td>{summary.text}</td>
                      <td className="nursing-perform__muted">{summary.frequency}</td>
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
