import { useState, type FormEvent } from "react";
import type { Medicine } from "../api/masterClient";
import { useCurrentPractitioner } from "../api/authQueries";
import { useInsulinScaleInputs, useRegisterInjectionPerform } from "../api/queries";
import { useLotRequiredCodes } from "../api/masterQueries";
import {
  groupInjectionByRp,
  injectionTimeLabel,
  injectionUsageSummary,
} from "../fhir/injectionHelpers";
import {
  OUTCOME_OPTIONS,
  buildInjectionPerformBundle,
  emptyInjectionPerformForm,
  scheduledPerformCount,
  type InjectionPerformDisplay,
  type InjectionPerformFormValues,
  type InjectionPerformMedicineLine,
  type InjectionPerformOutcome,
  type InsulinMeasurement,
  type InsulinPerformContext,
  latestScaleMeasurement,
} from "../fhir/injectionPerformHelpers";
import {
  filledInsulinScaleRows,
  guideInsulinDose,
  guideInsulinDoseByRow,
  insulinScaleRowLabel,
  insulinScaleSummary,
  isMeasuredInsulinScaleKind,
  type MeasuredInsulinScaleKind,
} from "../fhir/insulinScaleHelpers";
import { isNursingOrderRunningOn } from "../fhir/nursingOrderHelpers";
import { clockTime } from "../lib/dates";
import { referenceIdOfType } from "../fhir/shared";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { duplicateLotIndexes } from "../fhir/lotNumberHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { LotColumnHeading, LotNumberCell } from "./LotNumberCell";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { Modal } from "./Modal";
import { RemoveRowButton } from "./RemoveRowButton";

// 注射の実施入力(施用の記録)。輸血(TransfusionPerformModal)と同じく、実施記録一式と
// Task の実施済を 1 つの transaction で登録する。
//
// 施用するのは病棟なので、カルテのカードから開く(注射ワークリストは別タスク)。
// 初期表示はオーダーの薬剤をそのまま行にしたもの。実際に入れた量が違えば直し、
// 混注のうち一部を入れなかったなら「施用」を外す。オーダーに無い薬剤は RP ごとの
// 「医薬品追加」から足せる(注射は依頼時と実施時で内容が変わることが多い)。
// オーダーの行は消せない(施用しなかった記録として「施用」を外す)が、足した行は消せる。

interface Props {
  order: fhir4.ServiceRequest;
  medicationRequests: fhir4.MedicationRequest[];
  task: fhir4.Task | undefined;
  /** 既にあるこのオーダーの実施記録。予定回数に達したかの判定に使う。 */
  performs: InjectionPerformDisplay[];
  onClose: () => void;
}

export function InjectionPerformModal({
  order,
  medicationRequests,
  task,
  performs,
  onClose,
}: Props) {
  const register = useRegisterInjectionPerform();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const rps = groupInjectionByRp(medicationRequests);

  const [values, setValues] = useState<InjectionPerformFormValues>(() =>
    emptyInjectionPerformForm(medicationRequests),
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  // 医薬品検索を開いている RP。追加した行はその RP に属する。
  const [addingRp, setAddingRp] = useState<number | null>(null);

  // ロット番号を記録する薬(薬剤付加情報)。対象の薬が 1 つでもあればロットの列を出す。
  const lotCodes = useLotRequiredCodes(values.medicines.map((m) => m.code));
  const showLot = values.medicines.some((m) => lotCodes.has(m.code) || m.lotNumber);
  const duplicateLots = duplicateLotIndexes(values.medicines.map((m) => (m.skipped ? { code: "" } : m)));

  const scheduled = scheduledPerformCount(medicationRequests);
  const done = performs.filter((p) => p.counted).length;

  // スケールのインスリン。施用時刻の前後の血糖値・主食の摂取量から実施量を案内する
  // (フリースケールは行を選んでもらう)。
  const patientId = referenceIdOfType(order.subject?.reference, "Patient");
  const day = values.startedAt.slice(0, 10);
  const scaleKinds = new Set(
    values.medicines
      .filter((m) => !m.skipped)
      .map((m) => m.insulinScale?.kind)
      .filter((kind) => kind !== undefined)
      .filter(isMeasuredInsulinScaleKind),
  );
  const insulinInputs = useInsulinScaleInputs(patientId, day, scaleKinds.size > 0);
  const scaleObservations = insulinInputs.data?.observations ?? [];
  const records = {
    glucose: latestScaleMeasurement(scaleObservations, "glucose", values.startedAt),
    meal: latestScaleMeasurement(scaleObservations, "meal", values.startedAt),
  };

  /** 手で入れた値があればそれ、無ければ直近の記録。 */
  function measurementOf(kind: MeasuredInsulinScaleKind): InsulinMeasurement | null {
    const manual = kind === "glucose" ? values.glucose : values.mealPercent;
    if (manual !== null) {
      return manual.trim() !== "" && Number.isFinite(Number(manual)) ? { value: Number(manual) } : null;
    }
    const record = records[kind];
    return record ? { value: record.value, observationId: record.observationId } : null;
  }

  function guideOf(m: InjectionPerformMedicineLine) {
    const scale = m.insulinScale;
    if (!scale) return null;
    const base = m.orderedDose ?? null;
    if (!isMeasuredInsulinScaleKind(scale.kind)) return guideInsulinDoseByRow(scale, base, m.scaleRowIndex ?? null);
    return guideInsulinDose(scale, base, measurementOf(scale.kind)?.value ?? null);
  }

  /** 実施量。スケールの行は手で直していなければ案内量。 */
  function doseOf(m: InjectionPerformMedicineLine): string {
    if (!m.insulinScale || m.doseTouched) return m.dose;
    const guide = guideOf(m)?.dose;
    return guide == null ? "" : String(guide);
  }

  function differsFromGuide(m: InjectionPerformMedicineLine): boolean {
    const guide = guideOf(m)?.dose;
    return Boolean(m.insulinScale && m.doseTouched && guide != null && Number(m.dose) !== guide);
  }

  function measurementInputValue(kind: MeasuredInsulinScaleKind): string {
    const manual = kind === "glucose" ? values.glucose : values.mealPercent;
    if (manual !== null) return manual;
    const record = records[kind];
    return record ? String(record.value) : "";
  }

  function update<K extends keyof InjectionPerformFormValues>(
    key: K,
    value: InjectionPerformFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function updateMedicine(index: number, patch: Partial<InjectionPerformMedicineLine>) {
    setValues((prev) => ({
      ...prev,
      medicines: prev.medicines.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    }));
  }

  function addMedicine(rpNumber: number, medicine: Medicine) {
    setValues((prev) => {
      // 同じ RP の行の後ろに足す(RP ごとに並べて出すため)。
      const lastIndex = prev.medicines.map((m) => m.rpNumber).lastIndexOf(rpNumber);
      const line: InjectionPerformMedicineLine = {
        medicationRequestId: "",
        rpNumber,
        orderInRp: prev.medicines.filter((m) => m.rpNumber === rpNumber).length + 1,
        code: medicine.medicine_code,
        yjCode: medicine.yj_code ?? undefined,
        name: medicine.name,
        dose: "",
        unit: medicine.unit_name ?? "",
        orderedDose: undefined,
        skipped: false,
        added: true,
      };
      const medicines = [...prev.medicines];
      medicines.splice(lastIndex + 1, 0, line);
      return { ...prev, medicines };
    });
    setAddingRp(null);
  }

  function removeMedicine(index: number) {
    setValues((prev) => ({ ...prev, medicines: prev.medicines.filter((_, i) => i !== index) }));
  }

  function validate(): string | null {
    if (!values.startedAt) return "開始時刻を入れてください。";
    if (values.endedAt && values.endedAt < values.startedAt) {
      return "終了時刻は開始時刻より後にしてください。";
    }
    if (values.outcome !== "not-done") {
      const given = values.medicines.filter((m) => !m.skipped);
      if (given.length === 0) return "施用した薬剤が 1 つもありません。実施せず を選んでください。";
      if (scaleKinds.has("glucose") && !measurementOf("glucose")) return "血糖値を入れてください。";
      if (scaleKinds.has("meal") && !measurementOf("meal")) return "主食の摂取量を入れてください。";
      for (const m of given) {
        const dose = doseOf(m);
        if (m.insulinScale) {
          if (m.insulinScale.kind === "free" && m.scaleRowIndex == null) return `${m.name}: スケールを選んでください。`;
          if (dose === "" || Number(dose) < 0) return `${m.name}: 実施量を入れてください。`;
          if (differsFromGuide(m) && !m.doseReason?.trim()) return `${m.name}: 変更理由を入れてください。`;
          continue;
        }
        if (!dose || Number(dose) <= 0) return `${m.name}: 実施量を入れてください。`;
      }
      if (duplicateLots.size > 0) return "同じ薬に同じロット番号が重なっています。";
    }
    if (values.outcome !== "completed" && !values.reason.trim()) {
      return "途中で中止・実施せず の理由を入れてください。";
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validate();
    setValidationError(error);
    if (error) return;

    const submitted: InjectionPerformFormValues = {
      ...values,
      performerId: practitionerId ?? "",
      performerName: practitioner ? practitionerDisplayName(practitioner) : "",
      medicines: values.medicines.map((m) => ({ ...m, dose: doseOf(m) })),
    };
    const insulin: InsulinPerformContext | undefined =
      scaleKinds.size > 0
        ? {
            glucose: scaleKinds.has("glucose") ? measurementOf("glucose") : null,
            meal: scaleKinds.has("meal") ? measurementOf("meal") : null,
            glucoseOrder: insulinInputs.data?.glucoseOrders.find((sr) => isNursingOrderRunningOn(sr, day)),
          }
        : undefined;
    register.mutate(
      buildInjectionPerformBundle(submitted, order, medicationRequests, task, done, insulin),
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="注射の実施入力" onClose={onClose} className="modal--wide">
      <form className="transfusion-perform" onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={register.error} />

        {/* 1 日に複数回の施用があるオーダーでは、何回目の記録かを先に見せる。 */}
        <p className="rad-perform__items">
          <span className="rad-perform__items-label">施用</span>
          {scheduled > 1
            ? `${done + 1} 回目 / 予定 ${scheduled} 回(${rps
                .flatMap((rp) => rp.times.map(injectionTimeLabel))
                .join("、")})`
            : done > 0
              ? `${done + 1} 回目(予定は 1 回)`
              : "1 回目"}
        </p>

        <div className="lab-order-item__fields">
          <label>
            開始時刻 *
            <input
              type="datetime-local"
              value={values.startedAt}
              onChange={(e) => update("startedAt", e.target.value)}
              required
            />
          </label>
          <label>
            終了時刻
            <input
              type="datetime-local"
              value={values.endedAt}
              onChange={(e) => update("endedAt", e.target.value)}
            />
          </label>
          <label>
            実施者
            <input
              type="text"
              value={practitioner ? practitionerDisplayName(practitioner) : "(未設定)"}
              readOnly
              disabled
            />
          </label>
        </div>

        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>結果 *</h3>
          </div>
          <div className="transfusion-order__chips" role="group" aria-label="実施の結果">
            {OUTCOME_OPTIONS.map((option) => {
              const selected = values.outcome === option.code;
              return (
                <button
                  key={option.code}
                  type="button"
                  aria-pressed={selected}
                  className={`transfusion-chip${selected ? " transfusion-chip--selected" : ""}`}
                  onClick={() => update("outcome", option.code as InjectionPerformOutcome)}
                >
                  {option.display}
                </button>
              );
            })}
          </div>
          {values.outcome !== "completed" && (
            <label className="transfusion-perform__reaction-note">
              理由 *
              <input
                type="text"
                value={values.reason}
                onChange={(e) => update("reason", e.target.value)}
                placeholder="血管外漏出・患者拒否 など"
              />
            </label>
          )}
        </section>

        {values.outcome !== "not-done" && scaleKinds.size > 0 && (
          <div className="lab-order-item__fields insulin-perform__fields">
            {(["glucose", "meal"] as const)
              .filter((kind) => scaleKinds.has(kind))
              .map((kind) => {
                const manual = kind === "glucose" ? values.glucose : values.mealPercent;
                const record = records[kind];
                return (
                  <label key={kind}>
                    {kind === "glucose" ? "血糖値(mg/dL) *" : "主食の摂取量(%) *"}
                    <span className="insulin-perform__measure">
                      <input
                        type="number"
                        min={0}
                        step={kind === "glucose" ? 1 : 10}
                        value={measurementInputValue(kind)}
                        onChange={(e) => update(kind === "glucose" ? "glucose" : "mealPercent", e.target.value)}
                      />
                      {manual === null && record && (
                        <span className="order-select__muted">{`${clockTime(record.at)} 記録`}</span>
                      )}
                    </span>
                  </label>
                );
              })}
          </div>
        )}

        {values.outcome !== "not-done" &&
          rps.map((rp) => (
            <section className="lab-order-item__section" key={rp.rpNumber}>
              <div className="lab-order-item__section-head">
                <h3>{`RP${rp.rpNumber}`}</h3>
                <span className="order-select__muted">{injectionUsageSummary(rp)}</span>
                <button type="button" onClick={() => setAddingRp(rp.rpNumber)}>
                  医薬品追加
                </button>
              </div>
              <table className="rp-card__medicines rp-card__medicines--detail">
                <thead>
                  <tr>
                    <th>医薬品</th>
                    <th>オーダー量</th>
                    <th>実施量</th>
                    <th>単位</th>
                    {showLot && (
                      <th className="lot-number-column">
                        <LotColumnHeading
                          missing={values.medicines.some(
                            (m) =>
                              m.rpNumber === rp.rpNumber && !m.skipped && lotCodes.has(m.code) && !m.lotNumber?.trim(),
                          )}
                        />
                      </th>
                    )}
                    <th>施用</th>
                    <th className="rp-card__medicine-di"></th>
                  </tr>
                </thead>
                <tbody>
                  {values.medicines.map((m, index) =>
                    m.rpNumber !== rp.rpNumber ? null : (
                      <tr key={index} className={m.skipped ? "karte-card--dimmed" : undefined}>
                        <td>
                          {m.name}
                          {m.added && <span className="injection-perform__added">追加</span>}
                          {m.insulinScale && (
                            <span className="insulin-scale-summary">
                              {insulinScaleSummary(m.insulinScale, m.orderedDose)}
                            </span>
                          )}
                          {m.insulinScale?.kind === "free" && (
                            <label className="insulin-perform__reason">
                              スケール *
                              <select
                                className="insulin-perform__choice"
                                value={m.scaleRowIndex ?? ""}
                                disabled={m.skipped}
                                onChange={(e) =>
                                  updateMedicine(index, {
                                    scaleRowIndex: e.target.value === "" ? null : Number(e.target.value),
                                  })
                                }
                              >
                                <option value="">選択してください</option>
                                {filledInsulinScaleRows(m.insulinScale).map((row, rowIndex) => (
                                  <option key={rowIndex} value={rowIndex}>
                                    {`${insulinScaleRowLabel(row)} → ${
                                      guideInsulinDoseByRow(m.insulinScale!, m.orderedDose ?? null, rowIndex).dose ?? "-"
                                    }`}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          {differsFromGuide(m) && (
                            <label className="insulin-perform__reason">
                              変更理由 *
                              <input
                                type="text"
                                value={m.doseReason ?? ""}
                                onChange={(e) => updateMedicine(index, { doseReason: e.target.value })}
                              />
                            </label>
                          )}
                        </td>
                        <td>
                          {/* フリースケールは条件をスケールの選択に出しているので、ここは量だけ。 */}
                          {m.insulinScale?.kind === "free" ? (
                            (guideOf(m)?.dose ?? "-")
                          ) : m.insulinScale ? (
                            <InsulinGuide guide={guideOf(m)} />
                          ) : (
                            (m.orderedDose ?? "-")
                          )}
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={doseOf(m)}
                            disabled={m.skipped}
                            onChange={(e) => updateMedicine(index, { dose: e.target.value, doseTouched: true })}
                            className="injection-perform__dose"
                          />
                        </td>
                        <td>{m.unit || "-"}</td>
                        {showLot && (
                          <td className="lot-number-column">
                            <LotNumberCell
                              required={lotCodes.has(m.code) && !m.skipped}
                              value={m.lotNumber ?? ""}
                              medicineName={m.name}
                              disabled={m.skipped}
                              duplicate={duplicateLots.has(index)}
                              onChange={(lotNumber) => updateMedicine(index, { lotNumber })}
                            />
                          </td>
                        )}
                        <td className="injection-perform__given">
                          {/* 混注のうち入れなかった薬剤。外すと投与記録を作らない。
                              列見出しが「施用」なので、セルはチェックボックスだけ。 */}
                          <input
                            type="checkbox"
                            checked={!m.skipped}
                            aria-label={`${m.name} を施用した`}
                            onChange={(e) => updateMedicine(index, { skipped: !e.target.checked })}
                          />
                        </td>
                        <td className="rp-card__medicine-di">
                          {/* 足した行だけ消せる。オーダーの行は「施用」を外して残す。 */}
                          {m.added && (
                            <RemoveRowButton title={`${m.name}を削除`} onClick={() => removeMedicine(index)} />
                          )}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </section>
          ))}

        <div className="lab-order-item__fields">
          <label className="transfusion-perform__comment">
            実施コメント
            <textarea
              value={values.comment}
              onChange={(e) => update("comment", e.target.value)}
              rows={2}
            />
          </label>
        </div>

        <div className="lab-order-item__actions">
          <button type="submit" disabled={register.isPending}>
            {register.isPending ? "保存中..." : "実施登録"}
          </button>
        </div>
      </form>
      {addingRp != null && (
        <MedicineSearchModal
          // 注射薬(剤形区分4)を初期絞り込みにする(オーダー画面と同じ)。
          dosageForm="4"
          title={`RP${addingRp} に医薬品を追加`}
          onSelect={(medicine) => addMedicine(addingRp, medicine)}
          onClose={() => setAddingRp(null)}
        />
      )}
    </Modal>
  );
}

/** スケールの案内量(「151〜200 → 2」)。測定値が無い・どの幅にも入らなければ「-」。 */
function InsulinGuide({ guide }: { guide: ReturnType<typeof guideInsulinDose> | null }) {
  if (!guide?.row) return <>-</>;
  const note = guide.row.note.trim();
  return (
    <span className="insulin-perform__guide">
      {`${insulinScaleRowLabel(guide.row)} → ${guide.dose ?? "-"}`}
      {note && <span className="insulin-perform__guide-note">{note}</span>}
    </span>
  );
}
