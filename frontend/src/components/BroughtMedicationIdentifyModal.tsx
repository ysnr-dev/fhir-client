import { useState } from "react";
import type { Medicine } from "../api/masterClient";
import { useCurrentPractitioner } from "../api/authQueries";
import { useBroughtMedicationTransaction } from "../api/queries";
import {
  broughtDoseLabel,
  broughtMedicationEntry,
  buildIdentifiedMedication,
  parseIdentifyValues,
  SUBSTITUTION_OPTIONS,
  summarizeBroughtMedication,
  validateIdentifyValues,
  type BroughtIdentifyValues,
  type BroughtSubstitution,
} from "../fhir/broughtMedicationHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { useValidationError } from "../hooks/useValidationError";
import { ErrorBanner } from "./ErrorBanner";
import { MedicineCautionMarks } from "./MedicineWarnings";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { Modal } from "./Modal";

// 持参薬の鑑別。入院 1 件ぶんの持参薬(判断がまだのもの)をまとめて入力する。
// カルテの持参薬タブと薬剤部の鑑別一覧の両方から開く。
//
// 呼び出し側がフォームの中に置くことがあるので、ここでは <form> を使わない
// (Modal はポータルを使わないので、入れ子の form になる)。

type PickState = { index: number; target: "medicine" | "substitute" } | null;

interface BroughtMedicationIdentifyModalProps {
  statements: fhir4.MedicationStatement[];
  onClose: () => void;
  onSaved?: () => void;
}

export function BroughtMedicationIdentifyModal({
  statements,
  onClose,
  onSaved,
}: BroughtMedicationIdentifyModalProps) {
  const [rows, setRows] = useState<BroughtIdentifyValues[]>(() => statements.map(parseIdentifyValues));
  const [pick, setPick] = useState<PickState>(null);
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const transaction = useBroughtMedicationTransaction();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const actor =
    practitionerId && practitioner
      ? { practitionerId, display: practitionerDisplayName(practitioner) }
      : null;

  function updateRow(index: number, patch: Partial<BroughtIdentifyValues>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function handlePick(medicine: Medicine) {
    if (!pick) return;
    updateRow(pick.index, pick.target === "medicine" ? { medicine } : { substitute: medicine });
    setPick(null);
  }

  function handleSave() {
    if (!actor) {
      setValidationError("鑑別は医療従事者に紐付いたアカウントで登録してください。");
      return;
    }
    for (const [index, row] of rows.entries()) {
      const error = validateIdentifyValues(row, summarizeBroughtMedication(statements[index]).name);
      if (error) {
        setValidationError(error);
        return;
      }
    }
    setValidationError(null);
    const entries = statements.map((statement, index) =>
      broughtMedicationEntry(buildIdentifiedMedication(statement, rows[index], actor)),
    );
    transaction.mutate(entries, {
      onSuccess: () => {
        onSaved?.();
        onClose();
      },
    });
  }

  return (
    <Modal title="持参薬の鑑別" onClose={onClose} className="modal--wide">
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={transaction.error} />

      <div className="prescription-form">
        {statements.map((statement, index) => {
          const summary = summarizeBroughtMedication(statement);
          const row = rows[index];
          return (
            <fieldset className="rp-card" key={statement.id ?? index}>
              <legend>{summary.reportedName ?? summary.name}</legend>
              <p className="brought-med__meta">
                {[summary.usageName, broughtDoseLabel(summary), summary.prescriber]
                  .filter(Boolean)
                  .join(" / ") || "-"}
              </p>
              <label className="brought-med__check">
                <input
                  type="checkbox"
                  checked={row.notTaken}
                  onChange={(e) => updateRow(index, { notTaken: e.target.checked })}
                />
                服用していない
              </label>
              {!row.notTaken && (
                <>
                  <div className="rp-card__usage">
                    <span className="rp-card__usage-label">医薬品</span>
                    <div className="rp-card__usage-row">
                      <button
                        type="button"
                        className="rp-card__compact-button"
                        onClick={() => setPick({ index, target: "medicine" })}
                      >
                        {row.medicine ? "変更" : "選択"}
                      </button>
                      {row.medicine ? (
                        <span className="rp-card__medicine-name">
                          {row.medicine.name}
                          <MedicineCautionMarks medicine={row.medicine} />
                        </span>
                      ) : (
                        <span className="rp-card__usage-value rp-card__usage-value--empty">
                          未特定
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="rp-card__usage-row">
                    <label>
                      持参数
                      <input
                        type="number"
                        min="0"
                        step="any"
                        className="rp-card__dose-input"
                        value={row.quantity}
                        onChange={(e) => updateRow(index, { quantity: e.target.value })}
                      />
                    </label>
                    <label>
                      残日数
                      <input
                        type="number"
                        min="0"
                        className="rp-card__dose-input"
                        value={row.remainingDays}
                        onChange={(e) => updateRow(index, { remainingDays: e.target.value })}
                      />
                    </label>
                  </div>
                  <label>
                    院内での扱い
                    <select
                      value={row.substitution}
                      onChange={(e) =>
                        updateRow(index, { substitution: e.target.value as BroughtSubstitution | "" })
                      }
                    >
                      <option value="">選択してください</option>
                      {SUBSTITUTION_OPTIONS.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.display}
                        </option>
                      ))}
                    </select>
                  </label>
                  {row.substitution === "alternative" && (
                    <div className="rp-card__usage">
                      <span className="rp-card__usage-label">代替薬</span>
                      <div className="rp-card__usage-row">
                        <button
                          type="button"
                          className="rp-card__compact-button"
                          onClick={() => setPick({ index, target: "substitute" })}
                        >
                          {row.substitute ? "変更" : "選択"}
                        </button>
                        {row.substitute ? (
                          <span className="rp-card__medicine-name">{row.substitute.name}</span>
                        ) : (
                          <span className="rp-card__usage-value rp-card__usage-value--empty">
                            未選択
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
              <label>
                コメント
                <input
                  type="text"
                  value={row.comment}
                  onChange={(e) => updateRow(index, { comment: e.target.value })}
                />
              </label>
            </fieldset>
          );
        })}

        <div className="brought-med__actions">
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" onClick={handleSave} disabled={transaction.isPending}>
            {transaction.isPending ? "保存中..." : "保存"}
          </button>
        </div>
      </div>

      {pick && (
        <MedicineSearchModal
          title={pick.target === "medicine" ? "持参薬を特定" : "代替薬を選択"}
          onSelect={handlePick}
          onClose={() => setPick(null)}
        />
      )}
    </Modal>
  );
}
