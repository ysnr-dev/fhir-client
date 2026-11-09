import { useMemo, useState, type FormEvent } from "react";
import { useDialysisShifts } from "../api/queries";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import {
  DIALYSIS_ACCESS_OPTIONS,
  DIALYSIS_DOSE_UNITS,
  DIALYSIS_MODALITY_OPTIONS,
  dialysisModalityHasSubstitution,
  emptyDialysisOrderForm,
  isAcuteDialysisModality,
  validateDialysisOrderForm,
  type DialysisAccessType,
  type DialysisModality,
  type DialysisOrderField,
  type DialysisOrderFormValues,
  type DialysisCodedValue,
  type DialysisPatternEntry,
} from "../fhir/dialysisOrderHelpers";
import type { DialysisShift } from "../fhir/dialysisShiftHelpers";
import {
  bloodPurifierKindDisplay,
  bloodPurifierKindForRow,
  bloodPurifierLabel,
  bloodPurifierRowCount,
} from "../fhir/bloodPurifierHelpers";
import { DAY_OF_WEEK_OPTIONS } from "../fhir/injectionHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import { useBulkStartDate } from "../hooks/useBulkStartDate";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";
import { shownValidationError, useFieldAlert } from "./FieldAlert";
import { BloodPurifierSearchModal } from "./BloodPurifierSearchModal";
import { TrashIcon } from "./icons/TrashIcon";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { ProblemSelect } from "./ProblemSelect";

// 透析オーダーの入力フォーム。明細も伝票レイアウトも無いので 1 枚で完結する。
//
// 曜日 × シフトは格子のチェックボックスで選ぶ(セル全体が押せる)。曜日ごとにシフトが違う指示(月曜は午前・金曜は午後)を
// そのまま表せるため。施設設定から消したシフトを指すオーダーの編集では、そのシフトの行も残して出す
// (黙って外さない)。
//
// 検索モーダルは <form> を内側に持つので、<form> の外に置く(Modal はポータルではない)。

/** 血液浄化器の入力行。浄化方法が使う本数に満たない分は空行で埋める。 */
function padPurifierRows(purifiers: readonly DialysisCodedValue[], count: number): DialysisCodedValue[] {
  const blanks = Array.from({ length: Math.max(count - purifiers.length, 0) }, () => ({ code: "", name: "" }));
  return [...purifiers, ...blanks];
}

/** 格子の行。施設設定のシフトに、オーダーが指している設定に無いシフトを足したもの。設定に無いシフトは時間帯を持たない。 */
function shiftRows(
  shifts: readonly DialysisShift[],
  pattern: readonly DialysisPatternEntry[],
): (Pick<DialysisShift, "code" | "label"> & Partial<Pick<DialysisShift, "start" | "end">>)[] {
  const known = new Set(shifts.map((shift) => shift.code));
  const orphaned = new Map<string, string>();
  for (const entry of pattern) {
    if (!known.has(entry.shift)) orphaned.set(entry.shift, entry.shiftLabel);
  }
  return [...shifts, ...[...orphaned].map(([code, label]) => ({ code, label }))];
}

interface DialysisOrderFormProps {
  patientId: string;
  initialValues?: DialysisOrderFormValues;
  onSubmit: (values: DialysisOrderFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
  /** オーダーセットの適用日。外から開始日をまとめて入れるときに渡す。 */
  bulkStartDate?: string;
  /** セットの内容として入力する(患者と日付に依存する入力を出さず、その検証も外す)。 */
  setMode?: boolean;
  /** 送信ボタンを出さない(積んだフォームを外から一括 submit する画面で使う)。 */
  hideSubmit?: boolean;
}

export function DialysisOrderForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
  bulkStartDate,
  setMode = false,
  hideSubmit = false,
}: DialysisOrderFormProps) {
  const [values, setValues] = useState<DialysisOrderFormValues>(
    initialValues ?? emptyDialysisOrderForm(""),
  );
  const [validationError, setValidationError, validationErrorRef, invalidField] =
    useValidationError<DialysisOrderField>();
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));
  const [pickingAnticoagulant, setPickingAnticoagulant] = useState(false);
  /** 検索モーダルを開いている血液浄化器の行。 */
  const [pickingPurifierRow, setPickingPurifierRow] = useState<number | null>(null);

  const shifts = useDialysisShifts();
  const problemOptions = useProblemOptions(patientId);
  useBulkStartDate(bulkStartDate, (date) => setValues((v) => ({ ...v, startDate: date })));
  const update = makeFieldUpdater(setValues);

  const rows = shiftRows(shifts, values.pattern);
  const fixedPurifierRows = bloodPurifierRowCount(values.modality);
  const purifierRows = padPurifierRows(values.purifiers, fixedPurifierRows);

  function setPurifierRow(row: number, value: DialysisCodedValue) {
    setValues((v) => ({
      ...v,
      purifiers: padPurifierRows(v.purifiers, fixedPurifierRows).map((purifier, i) => (i === row ? value : purifier)),
    }));
  }

  function selectModality(modality: DialysisModality | "") {
    setValues((v) => ({ ...v, modality, bedside: isAcuteDialysisModality(modality) }));
  }

  function togglePattern(dayOfWeek: string, shift: { code: string; label: string }, checked: boolean) {
    setValues((v) => ({
      ...v,
      pattern: checked
        ? [...v.pattern, { dayOfWeek, shift: shift.code, shiftLabel: shift.label }]
        : v.pattern.filter((entry) => entry.dayOfWeek !== dayOfWeek || entry.shift !== shift.code),
    }));
  }

  // 弾いた項目が直されたら(同じ規則が通るようになったら)、バナーと印を消す。
  const liveFailure = useMemo(
    () => validateDialysisOrderForm(values, { requireDates: !setMode }),
    [values, setMode],
  );
  const shownError = shownValidationError(validationError, invalidField, liveFailure);
  const fieldAlert = useFieldAlert<DialysisOrderField>(invalidField, shownError);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const failure = validateDialysisOrderForm(values, { requireDates: !setMode });
    if (failure) {
      setValidationError(failure.message, failure.field);
      return;
    }
    setValidationError(null);

    onSubmit({
      ...values,
      // シフト名は登録時の施設設定のものを焼き付ける(設定に無いシフトは元の名前のまま)。
      pattern: values.pattern.map((entry) => ({
        ...entry,
        shiftLabel: shifts.find((shift) => shift.code === entry.shift)?.label ?? entry.shiftLabel,
      })),
      problem: refreshProblemDisplay(values.problem, problemOptions),
    });
  }

  return (
    <>
      <form className="prescription-form" onSubmit={handleSubmit} noValidate={hideSubmit}>
        {shownError && (
          <div className="error-banner" role="alert" ref={validationErrorRef}>
            <p className="error-banner__line error-banner__line--error">{shownError}</p>
          </div>
        )}
        <ErrorBanner error={submitError} />

        <fieldset>
          <legend>透析内容</legend>
          <label className={fieldAlert.className("modality")}>
            {fieldAlert.label("modality", "浄化方法 *")}
            <select
              value={values.modality}
              onChange={(e) => selectModality(e.target.value as DialysisModality | "")}
              required
            >
              <option value="">選択してください</option>
              {DIALYSIS_MODALITY_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label className="prescription-form__check">
            <input
              type="checkbox"
              checked={values.bedside}
              onChange={(e) => update("bedside", e.target.checked)}
            />
            ベッドサイドで実施
          </label>
        </fieldset>

        <fieldset>
          <legend>期間</legend>
          <label className={fieldAlert.className("startDate")}>
            {fieldAlert.label("startDate", "開始日 *")}
            <input
              type="date"
              value={values.startDate}
              onChange={(e) => update("startDate", e.target.value)}
              required
            />
          </label>
          <label className={fieldAlert.className("endDate")}>
            {fieldAlert.label("endDate", "終了日")}
            <input
              type="date"
              value={values.endDate}
              onChange={(e) => update("endDate", e.target.value)}
            />
          </label>
        </fieldset>

        {!values.bedside && (
          <fieldset>
            <legend>{fieldAlert.label("pattern", "曜日 × シフト *")}</legend>
            <table className="dialysis-order__pattern">
              <thead>
                <tr>
                  <th />
                  {DAY_OF_WEEK_OPTIONS.map((day) => (
                    <th key={day.code} className={`dialysis-order__day--${day.code}`}>
                      {day.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((shift) => (
                  <tr key={shift.code}>
                    <th>
                      {shift.label}
                      {shift.start && (
                        <span className="dialysis-order__shift-time">
                          {shift.start}〜{shift.end}
                        </span>
                      )}
                    </th>
                    {DAY_OF_WEEK_OPTIONS.map((day) => (
                      <td key={day.code}>
                        <label className="dialysis-order__cell">
                          <input
                            type="checkbox"
                            aria-label={`${day.label}曜 ${shift.label}`}
                            checked={values.pattern.some(
                              (entry) => entry.dayOfWeek === day.code && entry.shift === shift.code,
                            )}
                            onChange={(e) => togglePattern(day.code, shift, e.target.checked)}
                          />
                        </label>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </fieldset>
        )}

        <fieldset>
          <legend>透析条件</legend>
          <label className={fieldAlert.className("durationMinutes")}>
            {fieldAlert.label("durationMinutes", values.bedside ? "透析時間(分)" : "透析時間(分) *")}
            <input
              type="number"
              min={30}
              max={1440}
              step={1}
              value={values.durationMinutes}
              onChange={(e) => update("durationMinutes", e.target.value)}
            />
          </label>
          <label className={fieldAlert.className("qb")}>
            {fieldAlert.label("qb", "QB(mL/min)")}
            <input
              type="number"
              min={0}
              step="any"
              value={values.qb}
              onChange={(e) => update("qb", e.target.value)}
            />
          </label>
          <label className={fieldAlert.className("qd")}>
            {fieldAlert.label("qd", "QD(mL/min)")}
            <input
              type="number"
              min={0}
              step="any"
              value={values.qd}
              onChange={(e) => update("qd", e.target.value)}
            />
          </label>
          {dialysisModalityHasSubstitution(values.modality) && (
            <label className={fieldAlert.className("substitutionVolume")}>
              {fieldAlert.label("substitutionVolume", "補液量(L)")}
              <input
                type="number"
                min={0}
                step="any"
                value={values.substitutionVolume}
                onChange={(e) => update("substitutionVolume", e.target.value)}
              />
            </label>
          )}
          {purifierRows.map((purifier, row) => {
            const kind = bloodPurifierKindForRow(values.modality, row);
            return (
              <label className="dialysis-order__wide" key={row}>
                {kind ? bloodPurifierKindDisplay(kind) : "血液浄化器"}
                <span className="dialysis-order__picker">
                  <input
                    type="text"
                    value={purifier.name}
                    onChange={(e) => setPurifierRow(row, { code: "", name: e.target.value })}
                  />
                  <button
                    type="button"
                    className="rp-card__compact-button"
                    onClick={() => setPickingPurifierRow(row)}
                  >
                    選択
                  </button>
                  {row >= fixedPurifierRows && (
                    <button
                      type="button"
                      className="rp-card__icon-button"
                      title="血液浄化器を削除"
                      aria-label="血液浄化器を削除"
                      onClick={() =>
                        update(
                          "purifiers",
                          purifierRows.filter((_, i) => i !== row),
                        )
                      }
                    >
                      <TrashIcon />
                    </button>
                  )}
                </span>
              </label>
            );
          })}
          <div className="dialysis-order__wide">
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => update("purifiers", [...purifierRows, { code: "", name: "" }])}
            >
              追加
            </button>
          </div>
          <label className="dialysis-order__wide">
            透析液
            <input
              type="text"
              value={values.dialysate}
              onChange={(e) => update("dialysate", e.target.value)}
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>抗凝固薬</legend>
          <label className={fieldAlert.className("anticoagulant", "dialysis-order__wide")}>
            {fieldAlert.label("anticoagulant", "薬剤")}
            <span className="dialysis-order__picker">
              <input type="text" readOnly value={values.anticoagulant?.name ?? ""} />
              <button
                type="button"
                className="rp-card__compact-button"
                onClick={() => setPickingAnticoagulant(true)}
              >
                選択
              </button>
              {values.anticoagulant && (
                <button
                  type="button"
                  className="rp-card__icon-button"
                  title="抗凝固薬を外す"
                  aria-label="抗凝固薬を外す"
                  onClick={() => update("anticoagulant", null)}
                >
                  ×
                </button>
              )}
            </span>
          </label>
          <label className={fieldAlert.className("anticoagulantInitialDose")}>
            {fieldAlert.label("anticoagulantInitialDose", "初回量")}
            <input
              type="number"
              min={0}
              step="any"
              value={values.anticoagulantInitialDose}
              onChange={(e) => update("anticoagulantInitialDose", e.target.value)}
            />
          </label>
          <label className={fieldAlert.className("anticoagulantContinuousDose")}>
            {fieldAlert.label("anticoagulantContinuousDose", "持続量(/h)")}
            <input
              type="number"
              min={0}
              step="any"
              value={values.anticoagulantContinuousDose}
              onChange={(e) => update("anticoagulantContinuousDose", e.target.value)}
            />
          </label>
          <label>
            単位
            <select
              value={values.anticoagulantDoseUnit}
              onChange={(e) => update("anticoagulantDoseUnit", e.target.value)}
            >
              {DIALYSIS_DOSE_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>バスキュラーアクセス</legend>
          <label>
            種類
            <select
              value={values.accessType}
              onChange={(e) => update("accessType", e.target.value as DialysisAccessType | "")}
            >
              <option value="">選択してください</option>
              {DIALYSIS_ACCESS_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            部位
            <input
              type="text"
              value={values.accessSite}
              onChange={(e) => update("accessSite", e.target.value)}
            />
          </label>
          <label>
            穿刺針
            <input
              type="text"
              value={values.needle}
              onChange={(e) => update("needle", e.target.value)}
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>依頼共通</legend>
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
              onChange={(e) => update("setting", e.target.value as PrescriptionSetting)}
            >
              <option value="">選択してください</option>
              {SETTING_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          {commentOpen ? (
            <div className="prescription-form__comment-field">
              <label>
                透析部門への指示
                <input
                  type="text"
                  value={values.comment}
                  onChange={(e) => update("comment", e.target.value)}
                />
              </label>
              <button
                type="button"
                className="rp-card__icon-button"
                title="透析部門への指示を削除"
                aria-label="透析部門への指示を削除"
                onClick={() => {
                  setCommentOpen(false);
                  update("comment", "");
                }}
              >
                ×
              </button>
            </div>
          ) : (
            <div className="prescription-form__comment-toggle">
              <button
                type="button"
                className="comment-add-button"
                onClick={() => setCommentOpen(true)}
              >
                ＋透析部門への指示
              </button>
            </div>
          )}
        </fieldset>

        {!hideSubmit && (
          <div className="prescription-form__actions">
            <button type="submit" disabled={submitting}>
              {submitting ? "保存中..." : submitLabel}
            </button>
          </div>
        )}
      </form>

      {pickingPurifierRow !== null && (
        <BloodPurifierSearchModal
          initialKind={bloodPurifierKindForRow(values.modality, pickingPurifierRow)}
          onSelect={(purifier) => {
            setPurifierRow(pickingPurifierRow, { code: purifier.purifier_code, name: bloodPurifierLabel(purifier) });
            setPickingPurifierRow(null);
          }}
          onClose={() => setPickingPurifierRow(null)}
        />
      )}
      {pickingAnticoagulant && (
        <MedicineSearchModal
          title="抗凝固薬を選択"
          dosageForm="4"
          onSelect={(medicine) => {
            setPickingAnticoagulant(false);
            update("anticoagulant", {
              medicineCode: medicine.medicine_code,
              yjCode: medicine.yj_code ?? "",
              name: medicine.name ?? medicine.medicine_code,
            });
          }}
          onClose={() => setPickingAnticoagulant(false)}
        />
      )}
    </>
  );
}
