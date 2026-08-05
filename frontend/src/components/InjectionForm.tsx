import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { Medicine } from "../api/masterClient";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import {
  CATEGORY_OPTIONS,
  LINE_OPTIONS,
  METHOD_OPTIONS,
  ROUTE_OPTIONS,
  SITE_OPTIONS,
  USAGE_TYPE_OPTIONS,
  defaultCategory,
  emptyInjectionForm,
  emptyInjectionRp,
  type InjectionFormValues,
  type InjectionRpValues,
  type InjectionUsageType,
} from "../fhir/injectionHelpers";
import {
  SETTING_OPTIONS,
  emptyMedicineLine,
  type MedicineLineValues,
  type PrescriptionSetting,
} from "../fhir/prescriptionHelpers";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { ErrorBanner } from "./ErrorBanner";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { ProblemSelect } from "./ProblemSelect";

// 注射オーダーの入力フォーム。構成は処方(PrescriptionForm)に合わせ、用法だけ
// 注射固有の構造化項目(用法種別・投与経路・部位・手技・ライン・速度・開始時刻)にする。

interface InjectionFormProps {
  patientId: string;
  initialValues?: InjectionFormValues;
  onSubmit: (values: InjectionFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
}

type ModalState = { kind: "medicine"; rpIndex: number; medIndex: number } | null;

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

export function InjectionForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: InjectionFormProps) {
  const [values, setValues] = useState<InjectionFormValues>(initialValues ?? emptyInjectionForm);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));
  const [usageCommentOpen, setUsageCommentOpen] = useState<boolean[]>(() =>
    (initialValues ?? emptyInjectionForm()).rps.map((rp) => Boolean(rp.usageComment)),
  );

  const problemOptions = useProblemOptions(patientId);

  function update<K extends keyof InjectionFormValues>(key: K, value: InjectionFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // 注射区分の選択肢は入外区分で変わるので選び直させる。外来のように選択肢が
  // 1 つしかないときは既定値を入れておく。
  function handleSettingChange(setting: PrescriptionSetting) {
    setValues((v) => ({ ...v, setting, category: defaultCategory(setting) }));
  }

  function updateRp(rpIndex: number, patch: Partial<InjectionRpValues>) {
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

  function addRp() {
    setValues((v) => ({
      ...v,
      rps: [...v.rps, { ...emptyInjectionRp, startTimes: [], medicines: [{ ...emptyMedicineLine }] }],
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

  function handleMedicineSelect(medicine: Medicine) {
    if (modal?.kind !== "medicine") return;
    updateMedicine(modal.rpIndex, modal.medIndex, { medicine });
    setModal(null);
  }

  function addStartTime(rpIndex: number) {
    updateRp(rpIndex, { startTimes: [...values.rps[rpIndex].startTimes, ""] });
  }

  function updateStartTime(rpIndex: number, timeIndex: number, value: string) {
    updateRp(rpIndex, {
      startTimes: values.rps[rpIndex].startTimes.map((t, i) => (i === timeIndex ? value : t)),
    });
  }

  function removeStartTime(rpIndex: number, timeIndex: number) {
    updateRp(rpIndex, {
      startTimes: values.rps[rpIndex].startTimes.filter((_, i) => i !== timeIndex),
    });
  }

  function validate(): string | null {
    if (!values.authoredDate) return "注射日は必須です。";
    if (!values.setting) return "入外区分は必須です。";
    if (!values.category) return "注射区分は必須です。";
    if (values.rps.length === 0) return "RPを1件以上登録してください。";

    for (let i = 0; i < values.rps.length; i++) {
      const rp = values.rps[i];
      const rpLabel = `RP${i + 1}`;
      if (!rp.usageType) return `${rpLabel}: 用法種別を選択してください。`;
      if (!rp.routeCode) return `${rpLabel}: 投与経路を選択してください。`;
      if (rp.usageType === "drip" && rp.rate && Number(rp.rate) <= 0) {
        return `${rpLabel}: 投与速度は正の数値で入力してください。`;
      }
      if (rp.startTimes.some((t) => !t)) {
        return `${rpLabel}: 開始時刻が未入力の行があります。入力するか削除してください。`;
      }
      if (rp.medicines.length === 0) return `${rpLabel}: 医薬品を1件以上登録してください。`;
      for (let j = 0; j < rp.medicines.length; j++) {
        const med = rp.medicines[j];
        if (!med.medicine) return `${rpLabel}: 医薬品を選択してください。`;
        if (!med.dose || Number(med.dose) <= 0) return `${rpLabel}: 投与量を入力してください。`;
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
    onSubmit({ ...values, problem: refreshProblemDisplay(values.problem, problemOptions) });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // input 上での Enter による暗黙の form submit を抑止する(処方フォームと同じ)。
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
    }
  }

  return (
    <form className="prescription-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <fieldset>
        <legend>注射共通</legend>
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
          注射区分
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
          注射日
          <input
            type="date"
            value={values.authoredDate}
            onChange={(e) => update("authoredDate", e.target.value)}
          />
        </label>
        {commentOpen ? (
          <div className="prescription-form__comment-field">
            <label>
              注射コメント
              <input
                type="text"
                value={values.comment}
                onChange={(e) => update("comment", e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rp-card__icon-button"
              title="注射コメントを削除"
              aria-label="注射コメントを削除"
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
              ＋注射コメント
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
                <th>投与量</th>
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

          <div className="injection-usage">
            <label>
              用法種別
              <select
                value={rp.usageType}
                onChange={(e) => {
                  const usageType = e.target.value as InjectionUsageType | "";
                  // ワンショットに投与速度は無いので、切り替えたら値も落とす。
                  updateRp(rpIndex, { usageType, ...(usageType === "drip" ? {} : { rate: "" }) });
                }}
              >
                <option value="">選択してください</option>
                {USAGE_TYPE_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
            <label>
              投与経路
              <select
                value={rp.routeCode}
                onChange={(e) => updateRp(rpIndex, { routeCode: e.target.value })}
              >
                <option value="">選択してください</option>
                {ROUTE_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
            <label>
              投与部位
              <select
                value={rp.siteCode}
                onChange={(e) => updateRp(rpIndex, { siteCode: e.target.value })}
              >
                <option value="">指定なし</option>
                {SITE_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
            <label>
              手技
              <select
                value={rp.methodCode}
                onChange={(e) => updateRp(rpIndex, { methodCode: e.target.value })}
              >
                <option value="">指定なし</option>
                {METHOD_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
            <label>
              ライン
              <select
                value={rp.lineCode}
                onChange={(e) => updateRp(rpIndex, { lineCode: e.target.value })}
              >
                <option value="">指定なし</option>
                {LINE_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
            {rp.usageType === "drip" && (
              <label>
                投与速度
                <span className="injection-usage__rate">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={rp.rate}
                    onChange={(e) => updateRp(rpIndex, { rate: e.target.value })}
                  />
                  <span className="injection-usage__rate-unit">mL/h</span>
                </span>
              </label>
            )}
          </div>

          <div className="injection-start-times">
            <span className="rp-card__usage-label">開始時刻</span>
            {rp.startTimes.map((time, timeIndex) => (
              <div className="injection-start-times__row" key={timeIndex}>
                <input
                  type="datetime-local"
                  value={time}
                  onChange={(e) => updateStartTime(rpIndex, timeIndex, e.target.value)}
                />
                <button
                  type="button"
                  className="rp-card__icon-button"
                  title="この開始時刻を削除"
                  aria-label="この開始時刻を削除"
                  onClick={() => removeStartTime(rpIndex, timeIndex)}
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
            <div className="rp-card__actions">
              <button
                type="button"
                className="rp-card__compact-button"
                onClick={() => addStartTime(rpIndex)}
              >
                + 開始時刻追加
              </button>
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

      {modal?.kind === "medicine" && (
        <MedicineSearchModal
          // 注射オーダーなので注射薬(剤形区分4)を初期絞り込みにする。
          dosageForm="4"
          onSelect={handleMedicineSelect}
          onClose={() => setModal(null)}
        />
      )}
    </form>
  );
}
