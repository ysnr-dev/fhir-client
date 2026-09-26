import { makeFieldUpdater } from "../lib/form";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { Medicine, MedicineUsage } from "../api/masterClient";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import {
  CATEGORY_OPTIONS,
  defaultPrescriptionCategory,
  emptyMedicineLine,
  emptyPrescriptionForm,
  emptyRp,
  hasDoseDays,
  SETTING_OPTIONS,
  type MedicineLineValues,
  type PrescriptionFormValues,
  type PrescriptionSetting,
  type RpValues,
} from "../fhir/prescriptionHelpers";
import { isAsNeededUsage } from "../fhir/medicationScheduleHelpers";
import {
  emptySupplement,
  isValidUnevenDose,
  supplementError,
  unevenDailyDose,
  unevenTimingLabels,
} from "../fhir/supplementaryUsage";
import { presetUsageFilters } from "../fhir/usageMapping";
import { usePrescriptionCategoryDefaults } from "../api/queries";
import { useBulkStartDate } from "../hooks/useBulkStartDate";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import { ErrorBanner } from "./ErrorBanner";
import { MedicineCautionMarks, MedicineWarnings, useMedicationWarnings } from "./MedicineWarnings";
import { PregnancyNotice } from "./PregnancyNotice";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { ProblemSelect } from "./ProblemSelect";
import { RowMenu } from "./RowMenu";
import { SupplementaryUsageEditor, UnevenDoseEditor } from "./SupplementaryUsageEditor";
import { UsageSearchModal } from "./UsageSearchModal";

interface PrescriptionFormProps {
  // 対象プロブレムの候補(この患者のプロブレムリスト)を引くのに使う。
  patientId: string;
  initialValues?: PrescriptionFormValues;
  onSubmit: (values: PrescriptionFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
  /**
   * オーダーセットの内容として入力する(既定は患者に出すオーダー)。患者と日付に
   * 依存する入力を出さず、その検証も外す。値そのものは既定値のまま残り、保存時に
   * サニタイザが落とす(fhir/orderSetHelpers.ts)。
   */
  /**
   * オーダーセットの適用日。外から開始日をまとめて入れるときに渡す(値が変わった
   * ときだけ反映し、他の入力は保つ)。
   */
  bulkStartDate?: string;
  setMode?: boolean;
  /** 送信ボタンを出さない(積んだフォームを外から一括 submit する画面で使う)。 */
  hideSubmit?: boolean;
  /** 編集中のオーダー(ServiceRequest.id)。重複投与の警告から自分自身を外すのに使う。 */
  orderId?: string;
}

type ModalState =
  | { kind: "usage"; rpIndex: number }
  | { kind: "medicine"; rpIndex: number; medIndex: number }
  | null;

function removeButton(onClick: () => void, label: string) {
  return (
    <button
      type="button"
      className="rp-card__icon-button"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <TrashIcon />
    </button>
  );
}

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
  bulkStartDate,
  setMode = false,
  hideSubmit = false,
  orderId,
}: PrescriptionFormProps) {
  // 処方区分の初期値(施設設定。入外区分ごとに持つ)。区分が決まっていないフォーム
  // (新規・DO で入外区分が変わったとき)にだけ入れ、入力済み・保存済みの区分は動かさない。
  const categoryDefaults = usePrescriptionCategoryDefaults();
  const [values, setValues] = useState<PrescriptionFormValues>(() => {
    const base = initialValues ?? emptyPrescriptionForm();
    if (base.category) return base;
    return {
      ...base,
      category: defaultPrescriptionCategory(categoryDefaults.defaults, base.setting),
    };
  });
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [modal, setModal] = useState<ModalState>(null);
  // コメント欄は常に入力する訳ではないため、既に値がある場合のみ初期表示し、
  // それ以外はボタン操作で表示する。
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));

  // 対象プロブレムの候補。POMR では「#1 糖尿病に対する処方」のように、オーダー 1 件を
  // 1 つのプロブレムに紐付ける(RP ごとに分けたいときはオーダーを分けて登録する)。
  const problemOptions = useProblemOptions(patientId);

  // 薬剤の安全性チェック(アレルギー・重複投与)。オーダーセットの内容入力では患者が
  // 決まらないので出さない(妊娠の注意と同じ)。
  const warnings = useMedicationWarnings({
    patientId: setMode ? "" : patientId,
    startDate: values.startDate,
    rps: values.rps,
    excludeOrderId: orderId,
  });

  // 一般名処方は保険上、外来の院外処方でだけ算定できる。
  const allowGeneric = values.setting === "outpatient" && values.category === "external";

  const update = makeFieldUpdater(setValues);

  // セット適用で投与開始日をまとめて入れる。
  useBulkStartDate(bulkStartDate, (date) => update("startDate", date));

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

  // 入外区分を変えると処方区分の選択肢ごと変わるので、区分はその入外区分の初期値
  // (施設設定)に入れ替える。初期値が無ければ未選択に戻す。
  function handleSettingChange(setting: PrescriptionSetting) {
    setValues((v) => ({
      ...v,
      setting,
      category: defaultPrescriptionCategory(categoryDefaults.defaults, setting),
    }));
  }

  function addRp() {
    setValues((v) => ({
      ...v,
      rps: [...v.rps, { ...emptyRp, medicines: [{ ...emptyMedicineLine }] }],
    }));
  }

  function removeRp(rpIndex: number) {
    setValues((v) => ({ ...v, rps: v.rps.filter((_, i) => i !== rpIndex) }));
  }

  function updateUnevenDoses(rpIndex: number, medIndex: number, unevenDoses: string[]) {
    updateMedicine(rpIndex, medIndex, { unevenDoses, dose: unevenDailyDose(unevenDoses) });
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
    // 不均等は服用回数が用法で決まるので、回数に合わせて詰め直す。不均等にできない
    // 用法に変えたら外す(1 日量はそのまま残す)。
    const labels = unevenTimingLabels(usage.usage_code);
    const rp = values.rps[modal.rpIndex];
    updateRp(modal.rpIndex, {
      usage,
      doseDays: "",
      doseCount: "",
      supplement: isAsNeededUsage(usage.usage_code) ? null : rp.supplement,
      medicines: rp.medicines.map((med) => {
        if (!med.unevenDoses) return med;
        if (!labels) return { ...med, unevenDoses: null };
        const unevenDoses = labels.map((_, i) => med.unevenDoses?.[i] ?? "");
        return { ...med, unevenDoses, dose: unevenDailyDose(unevenDoses) };
      }),
    });
    setModal(null);
  }

  function handleMedicineSelect(medicine: Medicine) {
    if (modal?.kind !== "medicine") return;
    updateMedicine(modal.rpIndex, modal.medIndex, { medicine });
    setModal(null);
  }

  function validate(): string | null {
    // セットの内容としての入力では投与開始日を持たない(適用時に入れる)。
    if (!setMode && !values.startDate) return "投与開始日は必須です。";
    if (!values.setting) return "入外区分は必須です。";
    if (!values.category) return "処方区分は必須です。";
    if (values.rps.length === 0) return "RPを1件以上登録してください。";

    for (let i = 0; i < values.rps.length; i++) {
      const rp = values.rps[i];
      const rpLabel = `RP${i + 1}`;
      if (!rp.usage) return `${rpLabel}: 用法を選択してください。`;
      if (hasDoseDays(rp.usage.usage_code, rp.usage.basic_usage_category)) {
        if (!rp.doseDays || Number(rp.doseDays) < 1) return `${rpLabel}: 投与日数を入力してください。`;
      }
      if (isAsNeededUsage(rp.usage.usage_code)) {
        if (!rp.doseCount || Number(rp.doseCount) < 1) return `${rpLabel}: 投与回数を入力してください。`;
      }
      if (rp.supplement) {
        const error = supplementError(rp.supplement);
        if (error) return `${rpLabel}: ${error}`;
      }
      if (rp.medicines.length === 0) return `${rpLabel}: 医薬品を1件以上登録してください。`;
      for (let j = 0; j < rp.medicines.length; j++) {
        const med = rp.medicines[j];
        if (!med.medicine) return `${rpLabel}: 医薬品を選択してください。`;
        // 入外区分・処方区分は医薬品を選んだ後でも変えられるので、送信前にもう一度見る。
        if (med.medicine.generic && !allowGeneric) {
          return `${rpLabel}: 一般名(${med.medicine.name})は外来の院外処方でのみ使えます。`;
        }
        if (med.unevenDoses && !med.unevenDoses.every(isValidUnevenDose)) {
          return `${rpLabel}: 不均等投与の量は数字と小数点で6桁以内で入力してください。`;
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
      {/* 催奇形性・乳汁移行の判断に要るので、妊娠中・授乳中なら入力欄の前に出す。 */}
      {!setMode && <PregnancyNotice patientId={patientId} />}

      <fieldset>
        <legend>処方共通</legend>
        {!setMode && (
          <label>
            対象プロブレム
            <ProblemSelect
              value={values.problem}
              options={problemOptions}
              onChange={(problem) => update("problem", problem)}
            />
          </label>
        )}
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
        {!setMode && (
          <label>
            投与開始日
            <input
              type="date"
              value={values.startDate}
              onChange={(e) => update("startDate", e.target.value)}
            />
          </label>
        )}
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
              <col style={{ width: "72px" }} />
            </colgroup>
            <thead>
              <tr>
                <th>医薬品</th>
                <th>用量</th>
                <th>単位</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rp.medicines.map((med, medIndex) => {
                const unevenLabels = unevenTimingLabels(rp.usage?.usage_code);
                // コメントは値があれば出す(オーダーセット・レジメンから来た値はフラグを持たない)。
                const showComment = Boolean(med.showComment || med.comment);
                const canComment = !showComment;
                const canUneven = !med.unevenDoses && unevenLabels !== null;
                return (
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
                          <span className="rp-card__medicine-name">
                            {med.medicine.name}
                            <MedicineCautionMarks medicine={med.medicine} />
                          </span>
                        ) : (
                          <span className="rp-card__usage-value--empty">未選択</span>
                        )}
                      </div>
                      <MedicineWarnings warnings={warnings[rpIndex]?.[medIndex]} />
                      {med.unevenDoses && unevenLabels && (
                        <UnevenDoseEditor
                          labels={unevenLabels}
                          doses={med.unevenDoses}
                          onChange={(doses) => updateUnevenDoses(rpIndex, medIndex, doses)}
                          onRemove={() => updateMedicine(rpIndex, medIndex, { unevenDoses: null })}
                          removeButton={removeButton}
                        />
                      )}
                      {showComment && (
                        <div className="rp-card__comment-field rp-card__comment-field--inline">
                          <label>
                            薬剤コメント
                            <input
                              type="text"
                              value={med.comment}
                              onChange={(e) =>
                                updateMedicine(rpIndex, medIndex, { comment: e.target.value })
                              }
                            />
                          </label>
                          {removeButton(
                            () => updateMedicine(rpIndex, medIndex, { comment: "", showComment: false }),
                            "薬剤コメントを削除",
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        className="rp-card__dose-input"
                        value={med.dose}
                        readOnly={Boolean(med.unevenDoses)}
                        onChange={(e) => updateMedicine(rpIndex, medIndex, { dose: e.target.value })}
                      />
                    </td>
                    <td className="rp-card__medicine-unit">{med.medicine?.unit_name ?? "-"}</td>
                    <td>
                      <div className="rp-card__row-actions">
                        {(canComment || canUneven) && (
                          <RowMenu label="この医薬品の操作" escapesClipping>
                            {canComment && (
                              <button
                                type="button"
                                className="row-menu__item"
                                onClick={() => updateMedicine(rpIndex, medIndex, { showComment: true })}
                              >
                                薬剤コメント
                              </button>
                            )}
                            {canUneven && (
                              <button
                                type="button"
                                className="row-menu__item"
                                onClick={() =>
                                  updateMedicine(rpIndex, medIndex, {
                                    unevenDoses: unevenLabels?.map(() => "") ?? null,
                                  })
                                }
                              >
                                不均等投与
                              </button>
                            )}
                          </RowMenu>
                        )}
                        {rp.medicines.length > 1 &&
                          removeButton(() => removeMedicine(rpIndex, medIndex), "この医薬品を削除")}
                      </div>
                    </td>
                  </tr>
                );
              })}
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
              {hasDoseDays(rp.usage?.usage_code, rp.usage?.basic_usage_category) && (
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
              {isAsNeededUsage(rp.usage?.usage_code) && (
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
              {rp.usage &&
                ((!rp.supplement && !isAsNeededUsage(rp.usage.usage_code)) ||
                  !(rp.showUsageComment || rp.usageComment)) && (
                <RowMenu label="用法の操作" escapesClipping>
                  {!rp.supplement && !isAsNeededUsage(rp.usage.usage_code) && (
                    <button
                      type="button"
                      className="row-menu__item"
                      onClick={() => updateRp(rpIndex, { supplement: emptySupplement("interval") })}
                    >
                      補足用法
                    </button>
                  )}
                  {!(rp.showUsageComment || rp.usageComment) && (
                    <button
                      type="button"
                      className="row-menu__item"
                      onClick={() => updateRp(rpIndex, { showUsageComment: true })}
                    >
                      用法コメント
                    </button>
                  )}
                </RowMenu>
              )}
            </div>
          </div>

          {rp.supplement && (
            <SupplementaryUsageEditor
              name={`rp-${rpIndex}-supplement`}
              value={rp.supplement}
              onChange={(supplement) => updateRp(rpIndex, { supplement })}
              onRemove={() => updateRp(rpIndex, { supplement: null })}
              removeButton={removeButton}
            />
          )}

          {(rp.showUsageComment || rp.usageComment) && (
            <div className="rp-card__comment-field">
              <label>
                用法コメント
                <input
                  type="text"
                  value={rp.usageComment}
                  onChange={(e) => updateRp(rpIndex, { usageComment: e.target.value })}
                />
              </label>
              {removeButton(
                () => updateRp(rpIndex, { usageComment: "", showUsageComment: false }),
                "用法コメントを削除",
              )}
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

      {!hideSubmit && (
        <div className="prescription-form__submit">
          <button type="submit" disabled={submitting}>
            {submitting ? "送信中..." : submitLabel}
          </button>
        </div>
      )}

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
