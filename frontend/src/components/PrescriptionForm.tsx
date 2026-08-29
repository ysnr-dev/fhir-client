import { makeFieldUpdater } from "../lib/form";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { Medicine, MedicineUsage } from "../api/masterClient";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import {
  CATEGORY_OPTIONS,
  emptyMedicineLine,
  emptyPrescriptionForm,
  emptyRp,
  SETTING_OPTIONS,
  type MedicineLineValues,
  type PrescriptionFormValues,
  type PrescriptionSetting,
  type RpValues,
} from "../fhir/prescriptionHelpers";
import { presetUsageFilters } from "../fhir/usageMapping";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import { ErrorBanner } from "./ErrorBanner";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { ProblemSelect } from "./ProblemSelect";
import { UsageSearchModal } from "./UsageSearchModal";

interface PrescriptionFormProps {
  // 対象プロブレムの候補(この患者のプロブレムリスト)を引くのに使う。
  patientId: string;
  initialValues?: PrescriptionFormValues;
  onSubmit: (values: PrescriptionFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
}

type ModalState =
  | { kind: "usage"; rpIndex: number }
  | { kind: "medicine"; rpIndex: number; medIndex: number }
  | null;

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4M6.5 6.5v5M9.5 6.5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PrescriptionForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: PrescriptionFormProps) {
  const [values, setValues] = useState<PrescriptionFormValues>(initialValues ?? emptyPrescriptionForm);
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [modal, setModal] = useState<ModalState>(null);
  // コメント欄は常に入力する訳ではないため、既に値がある場合のみ初期表示し、
  // それ以外はボタン操作で表示する。
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));
  const [usageCommentOpen, setUsageCommentOpen] = useState<boolean[]>(() =>
    (initialValues ?? emptyPrescriptionForm()).rps.map((rp) => Boolean(rp.usageComment)),
  );

  // 対象プロブレムの候補。POMR では「#1 糖尿病に対する処方」のように、オーダー 1 件を
  // 1 つのプロブレムに紐付ける(RP ごとに分けたいときはオーダーを分けて登録する)。
  const problemOptions = useProblemOptions(patientId);

  // 一般名処方は保険上、外来の院外処方でだけ算定できる。
  const allowGeneric = values.setting === "outpatient" && values.category === "external";

  const update = makeFieldUpdater(setValues);

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
          ? { ...rp, medicines: rp.medicines.map((m, j) => (j === medIndex ? { ...m, ...patch } : m)) }
          : rp,
      ),
    }));
  }

  function handleSettingChange(setting: PrescriptionSetting) {
    setValues((v) => ({ ...v, setting, category: "" }));
  }

  function addRp() {
    setValues((v) => ({
      ...v,
      rps: [...v.rps, { ...emptyRp, medicines: [{ ...emptyMedicineLine }] }],
    }));
    setUsageCommentOpen((open) => [...open, false]);
  }

  function removeRp(rpIndex: number) {
    setValues((v) => ({ ...v, rps: v.rps.filter((_, i) => i !== rpIndex) }));
    setUsageCommentOpen((open) => open.filter((_, i) => i !== rpIndex));
  }

  function toggleUsageComment(rpIndex: number, open: boolean) {
    setUsageCommentOpen((prev) => prev.map((v, i) => (i === rpIndex ? open : v)));
    if (!open) updateRp(rpIndex, { usageComment: "" });
  }

  function addMedicine(rpIndex: number) {
    const rp = values.rps[rpIndex];
    if (rp.medicines.some((m) => !m.medicine)) {
      setValidationError("医薬品が未選択のレコードがあります。選択してから追加してください。");
      return;
    }
    setValidationError(null);
    const newMedIndex = rp.medicines.length;
    setValues((v) => ({
      ...v,
      rps: v.rps.map((r, i) =>
        i === rpIndex ? { ...r, medicines: [...r.medicines, { ...emptyMedicineLine }] } : r,
      ),
    }));
    setModal({ kind: "medicine", rpIndex, medIndex: newMedIndex });
  }

  function removeMedicine(rpIndex: number, medIndex: number) {
    setValues((v) => ({
      ...v,
      rps: v.rps.map((rp, i) =>
        i === rpIndex ? { ...rp, medicines: rp.medicines.filter((_, j) => j !== medIndex) } : rp,
      ),
    }));
  }

  function handleUsageSelect(usage: MedicineUsage) {
    if (modal?.kind !== "usage") return;
    updateRp(modal.rpIndex, { usage, doseDays: "", doseCount: "" });
    setModal(null);
  }

  function handleMedicineSelect(medicine: Medicine) {
    if (modal?.kind !== "medicine") return;
    updateMedicine(modal.rpIndex, modal.medIndex, { medicine });
    setModal(null);
  }

  function validate(): string | null {
    if (!values.authoredDate) return "処方日は必須です。";
    if (!values.setting) return "入外区分は必須です。";
    if (!values.category) return "処方区分は必須です。";
    if (values.rps.length === 0) return "RPを1件以上登録してください。";

    for (let i = 0; i < values.rps.length; i++) {
      const rp = values.rps[i];
      const rpLabel = `RP${i + 1}`;
      if (!rp.usage) return `${rpLabel}: 用法を選択してください。`;
      if (rp.usage.basic_usage_category === "内服") {
        if (!rp.doseDays || Number(rp.doseDays) < 1) return `${rpLabel}: 投与日数を入力してください。`;
      }
      if (rp.usage.basic_usage_category === "頓服") {
        if (!rp.doseCount || Number(rp.doseCount) < 1) return `${rpLabel}: 投与回数を入力してください。`;
      }
      if (rp.medicines.length === 0) return `${rpLabel}: 医薬品を1件以上登録してください。`;
      for (let j = 0; j < rp.medicines.length; j++) {
        const med = rp.medicines[j];
        if (!med.medicine) return `${rpLabel}: 医薬品を選択してください。`;
        // 入外区分・処方区分は医薬品を選んだ後でも変えられるので、送信前にもう一度見る。
        if (med.medicine.generic && !allowGeneric) {
          return `${rpLabel}: 一般名(${med.medicine.name})は外来の院外処方でのみ使えます。`;
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
    // プロブレムの表示名は保存時点の最新にそろえる(病名を変えたあとに処方を編集保存
    // したとき、参照の display だけ古い名前で残らないように)。
    onSubmit({ ...values, problem: refreshProblemDisplay(values.problem, problemOptions) });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // input 上での Enter による暗黙の form submit を抑止する。
    // 「登録」ボタン(BUTTON要素)や textarea 上の Enter には影響しない。
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
    }
  }

  return (
    <form className="prescription-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <fieldset>
        <legend>処方共通</legend>
        <label>
          対象プロブレム
          <ProblemSelect
            value={values.problem}
            options={problemOptions}
            onChange={(problem) => update("problem", problem)}
          />
        </label>
        <label>
          入外区分
          <select
            value={values.setting}
            onChange={(e) => handleSettingChange(e.target.value as PrescriptionSetting)}
          >
            <option value="">選択してください</option>
            {SETTING_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          処方区分
          <select value={values.category} onChange={(e) => update("category", e.target.value)}>
            <option value="">選択してください</option>
            {values.setting &&
              CATEGORY_OPTIONS[values.setting].map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
          </select>
        </label>
        <label>
          処方日
          <input
            type="date"
            value={values.authoredDate}
            onChange={(e) => update("authoredDate", e.target.value)}
          />
        </label>
        {commentOpen ? (
          <div className="prescription-form__comment-field">
            <label>
              処方箋コメント
              <input
                type="text"
                value={values.comment}
                onChange={(e) => update("comment", e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rp-card__icon-button"
              title="処方箋コメントを削除"
              aria-label="処方箋コメントを削除"
              onClick={() => {
                setCommentOpen(false);
                update("comment", "");
              }}
            >
              <TrashIcon />
            </button>
          </div>
        ) : (
          <div className="prescription-form__comment-toggle">
            <button type="button" className="comment-add-button" onClick={() => setCommentOpen(true)}>
              ＋処方箋コメント
            </button>
          </div>
        )}
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
              <col style={{ width: "32px" }} />
            </colgroup>
            <thead>
              <tr>
                <th>医薬品</th>
                <th>用量</th>
                <th>単位</th>
                <th>薬剤コメント</th>
                <th></th>
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
                        {med.medicine ? "変更" : "選択"}
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
                      onChange={(e) => updateMedicine(rpIndex, medIndex, { comment: e.target.value })}
                    />
                  </td>
                  <td>
                    {rp.medicines.length > 1 && (
                      <button
                        type="button"
                        className="rp-card__icon-button"
                        title="この医薬品を削除"
                        aria-label="この医薬品を削除"
                        onClick={() => removeMedicine(rpIndex, medIndex)}
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="rp-card__actions">
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => addMedicine(rpIndex)}
            >
              + 医薬品追加
            </button>
          </div>

          <div className="rp-card__usage">
            <span className="rp-card__usage-label">用法</span>
            <div className="rp-card__usage-row">
              <button
                type="button"
                className="rp-card__compact-button"
                onClick={() => setModal({ kind: "usage", rpIndex })}
              >
                {rp.usage ? "用法を変更" : "用法を選択"}
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

          {usageCommentOpen[rpIndex] ? (
            <div className="rp-card__comment-field">
              <label>
                用法コメント
                <input
                  type="text"
                  value={rp.usageComment}
                  onChange={(e) => updateRp(rpIndex, { usageComment: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="rp-card__icon-button"
                title="用法コメントを削除"
                aria-label="用法コメントを削除"
                onClick={() => toggleUsageComment(rpIndex, false)}
              >
                <TrashIcon />
              </button>
            </div>
          ) : (
            <div className="rp-card__actions">
              <button
                type="button"
                className="comment-add-button"
                onClick={() => toggleUsageComment(rpIndex, true)}
              >
                ＋用法コメント
              </button>
            </div>
          )}

          {values.rps.length > 1 && (
            <div className="rp-card__actions rp-card__actions--end">
              <button
                type="button"
                className="rp-card__icon-button"
                title={`RP${rpIndex + 1}を削除`}
                aria-label={`RP${rpIndex + 1}を削除`}
                onClick={() => removeRp(rpIndex)}
              >
                <TrashIcon />
              </button>
            </div>
          )}
        </fieldset>
      ))}

      <div className="prescription-form__actions">
        <button type="button" onClick={addRp}>
          + RP追加
        </button>
      </div>

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>

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
    </form>
  );
}
