import { useMemo, useState, type FormEvent } from "react";
import type { Medicine } from "../api/masterClient";
import { useCurrentPractitioner } from "../api/authQueries";
import { useRegisterInjectionDispense, type InjectionWorklistRow } from "../api/queries";
import {
  buildInjectionDispenseBundle,
  dispenseLinesFromOrder,
  type InjectionDispenseLine,
} from "../fhir/injectionDispenseHelpers";
import {
  groupInjectionByRp,
  injectionComment,
  injectionUsageSummary,
  summarizeInjectionServiceRequest,
} from "../fhir/injectionHelpers";
import { displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { orderContextSummary, prescriptionRequester } from "../fhir/prescriptionHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { Modal } from "./Modal";

// 注射一覧の「払出登録」。受付済のオーダーを薬剤部が払い出し、その結果を登録する。
//
// 処方の調剤登録(RxDispenseModal)と同じ考え方で、変えられるものを絞ってある:
// - 注射共通(注射日・区分・依頼科)と用法(経路・手技・速度)は医師が決めたものなので出すだけ
// - RP の構成は変えない
// - 銘柄(代替)と払出数量は変えられる。数量の既定は「投与量 × その日の施用回数」
// - 疑義照会はオーダー全体への記録なので末尾に 1 欄
//
// 登録すると薬剤ごとに MedicationDispense を作り、進捗を払出済へ進める
// (組み立ては injectionDispenseHelpers)。

interface Props {
  row: InjectionWorklistRow;
  onClose: () => void;
}

export function InjectionDispenseModal({ row, onClose }: Props) {
  const { order, patient } = row;
  const register = useRegisterInjectionDispense();
  const { practitionerId, practitioner } = useCurrentPractitioner();

  const [lines, setLines] = useState<InjectionDispenseLine[]>(() =>
    dispenseLinesFromOrder(row.medicationRequests),
  );
  const [query, setQuery] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [changingIndex, setChangingIndex] = useState<number | null>(null);

  const rps = groupInjectionByRp(row.medicationRequests);
  const summary = summarizeInjectionServiceRequest(order);
  const comment = injectionComment(order);

  const performer = useMemo(
    () => ({
      practitionerId: practitionerId ?? "",
      practitionerName: practitioner ? practitionerDisplayName(practitioner) : "",
    }),
    [practitionerId, practitioner],
  );

  function updateLine(index: number, patch: Partial<InjectionDispenseLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function handleMedicineSelect(medicine: Medicine) {
    if (changingIndex == null) return;
    updateLine(changingIndex, { medicine });
    setChangingIndex(null);
  }

  function validate(): string | null {
    if (lines.length === 0) return "払い出す薬剤がありません。";
    for (const line of lines) {
      if (!line.quantity || Number(line.quantity) <= 0) {
        return `${line.medicine.name}: 払出数量を入力してください。`;
      }
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validate();
    setValidationError(error);
    if (error) return;
    register.mutate(buildInjectionDispenseBundle(lines, order, row.task, query.trim(), performer), {
      onSuccess: onClose,
    });
  }

  // 一覧から開くので、どの患者の注射を払い出しているかを必ず頭に出す。
  const meta = [
    patient ? `${patient.identifier?.[0]?.value ?? "-"} ${displayName(patient)}` : "",
    order.authoredOn?.slice(0, 10),
    summary.settingDisplay,
    summary.categoryDisplay,
    orderContextSummary(prescriptionRequester(order)),
  ].filter(Boolean);

  return (
    <Modal title="払出登録" onClose={onClose} className="modal--wide">
      <form className="prescription-form" onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={register.error} />

        <fieldset>
          <legend>注射共通</legend>
          <dl className="prescription-detail__common">
            <dt>患者 | 注射日 | 区分 | 依頼科</dt>
            <dd>{meta.join(" | ")}</dd>
            <dt>注射コメント</dt>
            <dd>{comment || "-"}</dd>
            <dt>払出者</dt>
            <dd>{performer.practitionerName || "(未設定)"}</dd>
          </dl>
        </fieldset>

        {rps.map((rp) => (
          <fieldset className="rp-card" key={rp.rpNumber}>
            <legend>{`RP${rp.rpNumber}`}</legend>
            <table className="rp-card__medicines rp-card__medicines--form">
              <thead>
                <tr>
                  <th>医薬品</th>
                  <th>投与量</th>
                  <th>施用回数</th>
                  <th>払出数量</th>
                  <th>単位</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) =>
                  line.rpNumber !== rp.rpNumber ? null : (
                    <tr key={index}>
                      <td>
                        <div className="rp-card__medicine-cell">
                          <button type="button" onClick={() => setChangingIndex(index)}>
                            変更
                          </button>
                          <span className="rp-card__medicine-name">{line.medicine.name}</span>
                          {/* 銘柄を変えた(代替)ことがひと目で分かるよう、元の銘柄を添える。 */}
                          {line.medicine.medicine_code !== line.ordered.code && (
                            <span className="order-select__muted">{`(依頼: ${line.ordered.name})`}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        {line.ordered.dose != null
                          ? `${line.ordered.dose}${line.ordered.unit ?? ""}`
                          : "-"}
                      </td>
                      <td>{line.times}</td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          className="rp-card__dose-input"
                          value={line.quantity}
                          onChange={(e) => updateLine(index, { quantity: e.target.value })}
                        />
                      </td>
                      <td className="rp-card__medicine-unit">{line.medicine.unit_name ?? "-"}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            <div className="karte-rp__detail">
              <span className="karte-rp__detail-label">用法:</span>
              <span>{injectionUsageSummary(rp) || "-"}</span>
              {rp.startTimes.length > 0 && (
                <span className="karte-rp__dose">{`開始 ${rp.startTimes.join("、")}`}</span>
              )}
              {rp.usageComment && (
                <span className="karte-rp__comment">{`（${rp.usageComment}）`}</span>
              )}
            </div>
          </fieldset>
        ))}

        <fieldset>
          <legend>疑義照会</legend>
          {/* 医師に問い合わせた内容と回答。オーダーを直さずに払出内容だけ変えた経緯を残す。 */}
          <textarea
            className="rx-dispense__query"
            rows={3}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="依頼医師への問い合わせと回答があれば入力してください"
          />
        </fieldset>

        <div className="prescription-form__submit">
          <button type="submit" disabled={register.isPending}>
            {register.isPending ? "送信中..." : "払出を登録"}
          </button>
        </div>
      </form>

      {changingIndex != null && (
        <MedicineSearchModal
          dosageForm="4"
          title="払い出す銘柄を選択"
          onSelect={handleMedicineSelect}
          onClose={() => setChangingIndex(null)}
        />
      )}
    </Modal>
  );
}
