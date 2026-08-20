import { useMemo, useState, type FormEvent } from "react";
import type { Medicine, MedicineUsage } from "../api/masterClient";
import { useCurrentPractitioner } from "../api/authQueries";
import { useRegisterRxDispense, type RxWorklistRow } from "../api/queries";
import { displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import {
  orderContextSummary,
  parsePrescriptionForm,
  prescriptionComment,
  prescriptionRequester,
  summarizeServiceRequest,
  type MedicineLineValues,
  type PrescriptionFormValues,
  type RpValues,
} from "../fhir/prescriptionHelpers";
import { buildRxDispenseBundle } from "../fhir/rxDispenseHelpers";
import { presetUsageFilters } from "../fhir/usageMapping";
import { ErrorBanner } from "./ErrorBanner";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { Modal } from "./Modal";
import { UsageSearchModal } from "./UsageSearchModal";

// 処方一覧の「調剤登録」。受付済(処方箋発行済み)のオーダーを薬剤部が調剤し、
// その結果を登録する画面。
//
// 入力欄は処方オーダー登録(PrescriptionForm)と同じ組み方だが、調剤は「出された
// 処方を実際にどう出したか」の記録なので、変えられるものを絞ってある:
//
// - 処方共通(処方日・入外区分・処方区分・依頼科)は処方医が決めたものなので出すだけ
// - RP の構成(RP の数・1 RP に入る薬剤の数)は変えない。追加・削除のボタンを出さない
// - 医薬品・用量・用法・投与日数は変えられる(後発品への変更、疑義照会を受けた修正)
// - 疑義照会は薬剤ごとではなくオーダー全体への記録なので、末尾にまとめて 1 欄置く
//
// 登録すると明細ごとに MedicationDispense を作り、進捗を調剤済へ進める
// (組み立ては rxDispenseHelpers)。

interface Props {
  row: RxWorklistRow;
  onClose: () => void;
}

type ModalState =
  | { kind: "usage"; rpIndex: number }
  | { kind: "medicine"; rpIndex: number; medIndex: number }
  | null;

export function RxDispenseModal({ row, onClose }: Props) {
  const { order, patient } = row;
  const register = useRegisterRxDispense();
  const { practitionerId, practitioner } = useCurrentPractitioner();

  // 処方の内容をそのまま初期値にする(調剤は処方どおりに出すのが既定)。
  const [values, setValues] = useState<PrescriptionFormValues>(() =>
    parsePrescriptionForm(order, row.medicationRequests),
  );
  const [query, setQuery] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  const summary = summarizeServiceRequest(order);
  const comment = prescriptionComment(order);
  // 一般名処方(【般】〜)は外来の院外処方でだけ出せる。調剤で銘柄を選び直すときも
  // 同じ制限を掛ける(処方オーダー登録と同じ判定)。
  const allowGeneric = summary.settingCode === "outpatient" && summary.categoryCode === "external";

  const performer = useMemo(
    () => ({
      practitionerId: practitionerId ?? "",
      practitionerName: practitioner ? practitionerDisplayName(practitioner) : "",
    }),
    [practitionerId, practitioner],
  );

  function updateRp(rpIndex: number, patch: Partial<RpValues>) {
    setValues((v) => ({
      ...v,
      rps: v.rps.map((rp, i) => (i === rpIndex ? { ...rp, ...patch } : rp)),
    }));
  }

  function updateMedicine(rpIndex: number, medIndex: number, patch: Partial<MedicineLineValues>) {
    setValues((v) => ({
      ...v,
      rps: v.rps.map((rp, i) =>
        i === rpIndex
          ? {
              ...rp,
              medicines: rp.medicines.map((m, j) => (j === medIndex ? { ...m, ...patch } : m)),
            }
          : rp,
      ),
    }));
  }

  function handleUsageSelect(usage: MedicineUsage) {
    if (modal?.kind !== "usage") return;
    updateRp(modal.rpIndex, { usage });
    setModal(null);
  }

  function handleMedicineSelect(medicine: Medicine) {
    if (modal?.kind !== "medicine") return;
    updateMedicine(modal.rpIndex, modal.medIndex, { medicine });
    setModal(null);
  }

  function validate(): string | null {
    for (let i = 0; i < values.rps.length; i++) {
      const rp = values.rps[i];
      const rpLabel = `RP${i + 1}`;
      if (!rp.usage) return `${rpLabel}: 用法を選択してください。`;
      if (rp.usage.basic_usage_category === "内服" && (!rp.doseDays || Number(rp.doseDays) < 1)) {
        return `${rpLabel}: 投与日数を入力してください。`;
      }
      if (rp.usage.basic_usage_category === "頓服" && (!rp.doseCount || Number(rp.doseCount) < 1)) {
        return `${rpLabel}: 投与回数を入力してください。`;
      }
      for (const med of rp.medicines) {
        if (!med.medicine) return `${rpLabel}: 医薬品を選択してください。`;
        if (med.medicine.generic && !allowGeneric) {
          return `${rpLabel}: 一般名(${med.medicine.name})は外来の院外処方でのみ調剤できます。`;
        }
        if (!med.dose || Number(med.dose) <= 0) return `${rpLabel}: 用量を入力してください。`;
      }
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validate();
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    register.mutate(
      buildRxDispenseBundle(values, order, row.task, row.medicationRequests, query.trim(), performer),
      { onSuccess: onClose },
    );
  }

  // 一覧から開くので、どの患者の処方を調剤しているかを必ず頭に出す。
  const meta = [
    patient ? `${patient.identifier?.[0]?.value ?? "-"} ${displayName(patient)}` : "",
    summary.date,
    summary.settingDisplay,
    summary.categoryDisplay,
    orderContextSummary(prescriptionRequester(order)),
  ].filter(Boolean);

  return (
    <Modal title="調剤登録" onClose={onClose} className="modal--wide">
      <form className="prescription-form" onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={register.error} />

        <fieldset>
          <legend>処方共通</legend>
          <dl className="prescription-detail__common">
            <dt>患者 | 処方日 | 区分 | 依頼科</dt>
            <dd>{meta.join(" | ")}</dd>
            <dt>処方箋コメント</dt>
            <dd>{comment || "-"}</dd>
            <dt>調剤者</dt>
            <dd>{performer.practitionerName || "(未設定)"}</dd>
          </dl>
        </fieldset>

        {values.rps.map((rp, rpIndex) => (
          <fieldset className="rp-card" key={rpIndex}>
            <legend>{`RP${rpIndex + 1}`}</legend>

            <table className="rp-card__medicines rp-card__medicines--form">
              <colgroup>
                <col />
                <col style={{ width: "88px" }} />
                <col style={{ width: "60px" }} />
                <col style={{ width: "18%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>医薬品</th>
                  <th>用量</th>
                  <th>単位</th>
                  <th>薬剤コメント</th>
                </tr>
              </thead>
              <tbody>
                {rp.medicines.map((med, medIndex) => (
                  <tr key={medIndex}>
                    <td>
                      <div className="rp-card__medicine-cell">
                        <button
                          type="button"
                          onClick={() => setModal({ kind: "medicine", rpIndex, medIndex })}
                        >
                          変更
                        </button>
                        {med.medicine ? (
                          <span className="rp-card__medicine-name">{med.medicine.name}</span>
                        ) : (
                          <span className="rp-card__usage-value--empty">未選択</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        className="rp-card__dose-input"
                        value={med.dose}
                        onChange={(e) => updateMedicine(rpIndex, medIndex, { dose: e.target.value })}
                      />
                    </td>
                    <td className="rp-card__medicine-unit">{med.medicine?.unit_name ?? "-"}</td>
                    <td>
                      <input
                        type="text"
                        value={med.comment}
                        onChange={(e) =>
                          updateMedicine(rpIndex, medIndex, { comment: e.target.value })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="rp-card__usage">
              <span className="rp-card__usage-label">用法</span>
              <div className="rp-card__usage-row">
                <button
                  type="button"
                  className="rp-card__compact-button"
                  onClick={() => setModal({ kind: "usage", rpIndex })}
                >
                  用法を変更
                </button>
                {rp.usage ? (
                  <span className="rp-card__usage-value">{rp.usage.usage_name}</span>
                ) : (
                  <span className="rp-card__usage-value rp-card__usage-value--empty">未選択</span>
                )}

                {rp.usage?.basic_usage_category === "内服" && (
                  <span className="rp-card__dose-count">
                    <span className="rp-card__dose-count-label">投与日数</span>
                    <input
                      type="number"
                      min="1"
                      className="rp-card__dose-count-input"
                      value={rp.doseDays}
                      onChange={(e) => updateRp(rpIndex, { doseDays: e.target.value })}
                    />
                    <span className="rp-card__dose-count-suffix">日分</span>
                  </span>
                )}
                {rp.usage?.basic_usage_category === "頓服" && (
                  <span className="rp-card__dose-count">
                    <span className="rp-card__dose-count-label">投与回数</span>
                    <input
                      type="number"
                      min="1"
                      className="rp-card__dose-count-input"
                      value={rp.doseCount}
                      onChange={(e) => updateRp(rpIndex, { doseCount: e.target.value })}
                    />
                    <span className="rp-card__dose-count-suffix">回分</span>
                  </span>
                )}
              </div>
            </div>

            {rp.usageComment && <p className="karte-card__note">{rp.usageComment}</p>}
          </fieldset>
        ))}

        <fieldset>
          <legend>疑義照会</legend>
          {/* 処方医に問い合わせた内容と回答。オーダーを直さずに調剤内容だけ変えた
              経緯がここに残るので、変更した理由はこの欄に書く。 */}
          <textarea
            className="rx-dispense__query"
            rows={3}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="処方医への問い合わせと回答があれば入力してください"
          />
        </fieldset>

        <div className="prescription-form__submit">
          <button type="submit" disabled={register.isPending}>
            {register.isPending ? "送信中..." : "調剤を登録"}
          </button>
        </div>
      </form>

      {modal?.kind === "usage" && (
        <UsageSearchModal
          onSelect={handleUsageSelect}
          onClose={() => setModal(null)}
          initialFilters={presetUsageFilters(
            values.rps[modal.rpIndex].medicines.find((m) => m.medicine)?.medicine,
          )}
        />
      )}
      {modal?.kind === "medicine" && (
        <MedicineSearchModal
          onSelect={handleMedicineSelect}
          onClose={() => setModal(null)}
          allowGeneric={allowGeneric}
        />
      )}
    </Modal>
  );
}
