import { useMemo, useState, type FormEvent } from "react";
import type { ManagementFeeItem } from "../api/masterClient";
import { useManagementFeeItems } from "../api/masterQueries";
import { usePatientMedicalManagementProcedures } from "../api/queries";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import {
  emptyMedicalManagementOrderForm,
  formatPoints,
  historyLabel,
  medicalManagementHistoryByCode,
  medicalManagementLimitAdvisories,
  validateMedicalManagementOrderForm,
  type MedicalManagementLine,
  type MedicalManagementOrderFormValues,
} from "../fhir/medicalManagementOrderHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import { useAdvisorySession } from "../hooks/useAdvisorySession";
import { useBulkStartDate } from "../hooks/useBulkStartDate";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import { makeFieldUpdater } from "../lib/form";
import { AdvisoryNotice } from "./AdvisoryNotice";
import { ErrorBanner } from "./ErrorBanner";
import { ProblemSelect } from "./ProblemSelect";
import { TrashIcon } from "./icons/TrashIcon";

// 指導・管理料オーダーの入力フォーム。施設が項目マスタに登録した管理料を入外区分で絞って
// 並べ、算定するものにチェックを入れる。チェックした項目の下に加算の候補が出る。
// 各項目には前回算定日と当月の回数を添え、項目マスタの上限に達していれば表示のみの警告を出す
// (算定できるかの判断は医事会計に任せる。docs/medical-management-order-design.md §5)。

interface MedicalManagementOrderFormProps {
  patientId: string;
  initialValues?: MedicalManagementOrderFormValues;
  /** 編集中のオーダー。前回算定日・当月の回数から自分の記録を外す。 */
  editingOrderId?: string;
  onSubmit: (values: MedicalManagementOrderFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
  /** オーダーセットの適用日。外から算定日をまとめて入れるときに渡す。 */
  bulkStartDate?: string;
  /** セットの内容として入力する(患者と日付に依存する入力を出さず、その検証も外す)。 */
  setMode?: boolean;
  /** 送信ボタンを出さない(積んだフォームを外から一括 submit する画面で使う)。 */
  hideSubmit?: boolean;
}

export function MedicalManagementOrderForm({
  patientId,
  initialValues,
  editingOrderId,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
  bulkStartDate,
  setMode = false,
  hideSubmit = false,
}: MedicalManagementOrderFormProps) {
  const [values, setValues] = useState<MedicalManagementOrderFormValues>(
    initialValues ?? emptyMedicalManagementOrderForm(""),
  );
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));

  const problemOptions = useProblemOptions(patientId);
  useBulkStartDate(bulkStartDate, (date) => setValues((v) => ({ ...v, date })));
  const update = makeFieldUpdater(setValues);

  const master = useManagementFeeItems({ active: true, setting: values.setting || undefined });
  const masterItems = useMemo(() => master.data?.items ?? [], [master.data]);
  const records = usePatientMedicalManagementProcedures(setMode ? undefined : patientId);

  const history = useMemo(
    () => medicalManagementHistoryByCode(records.data?.procedures ?? [], values.date, editingOrderId),
    [records.data, values.date, editingOrderId],
  );
  const limits = useMemo(
    () => new Map(masterItems.map((item) => [item.receipt_code, item.monthly_limit])),
    [masterItems],
  );
  const limitAdvisories = useMemo(
    () => medicalManagementLimitAdvisories(values.lines, history, limits),
    [values.lines, history, limits],
  );
  const session = useAdvisorySession(limitAdvisories, "medical-management", !setMode);

  // マスタから外れた(無効にした・入外区分が合わない)項目でも、保存済みなら行として残す。
  const orphanLines = values.lines.filter(
    (line) => !masterItems.some((item) => item.receipt_code === line.code),
  );

  function lineOf(code: string): MedicalManagementLine | undefined {
    return values.lines.find((line) => line.code === code);
  }

  function toggleItem(item: ManagementFeeItem, checked: boolean) {
    setValues((v) => ({
      ...v,
      lines: checked
        ? [...v.lines, { code: item.receipt_code, name: item.name, additions: [] }]
        : v.lines.filter((line) => line.code !== item.receipt_code),
    }));
  }

  function toggleAddition(code: string, addition: { code: string; name: string }, checked: boolean) {
    setValues((v) => ({
      ...v,
      lines: v.lines.map((line) =>
        line.code !== code
          ? line
          : {
              ...line,
              additions: checked
                ? [...line.additions, addition]
                : line.additions.filter((a) => a.code !== addition.code),
            },
      ),
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateMedicalManagementOrderForm(values, { requireDates: !setMode });
    setValidationError(error);
    if (error) return;

    session.confirm([]);
    onSubmit({ ...values, problem: refreshProblemDisplay(values.problem, problemOptions) });
  }

  function historyOf(code: string, limit: number | null) {
    if (setMode) return null;
    const label = historyLabel(history.get(code), limit);
    return label ? <span className="medical-management-form__history">{label}</span> : null;
  }

  return (
    <form className="prescription-form medical-management-form" onSubmit={handleSubmit} noValidate={hideSubmit}>
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />
      <ErrorBanner error={master.error ?? records.error} />
      <AdvisoryNotice advisories={session.advisories} />

      <fieldset>
        <legend>算定項目</legend>
        <ul className="medical-management-form__items">
          {masterItems.map((item) => {
            const line = lineOf(item.receipt_code);
            return (
              <li key={item.id}>
                <label className="medical-management-form__item">
                  <input
                    type="checkbox"
                    checked={Boolean(line)}
                    onChange={(e) => toggleItem(item, e.target.checked)}
                  />
                  <span>{item.name}</span>
                  <span className="medical-management-form__points">{formatPoints(item.receipt_points)}</span>
                  {historyOf(item.receipt_code, item.monthly_limit)}
                </label>
                {line && (item.additions ?? []).length > 0 && (
                  <ul className="medical-management-form__additions">
                    {(item.additions ?? []).map((addition) => {
                      const name = addition.name ?? addition.code;
                      return (
                        <li key={addition.code}>
                          <label className="medical-management-form__item">
                            <input
                              type="checkbox"
                              checked={line.additions.some((a) => a.code === addition.code)}
                              onChange={(e) =>
                                toggleAddition(item.receipt_code, { code: addition.code, name }, e.target.checked)
                              }
                            />
                            <span>{name}</span>
                            <span className="medical-management-form__points">{formatPoints(addition.points)}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
          {orphanLines.map((line) => (
            <li key={line.code}>
              <label className="medical-management-form__item">
                <input type="checkbox" checked onChange={() => update("lines", values.lines.filter((l) => l !== line))} />
                <span>{line.name}</span>
                {historyOf(line.code, null)}
              </label>
              {line.additions.length > 0 && (
                <ul className="medical-management-form__additions">
                  {line.additions.map((addition) => (
                    <li key={addition.code}>
                      <label className="medical-management-form__item">
                        <input
                          type="checkbox"
                          checked
                          onChange={() => toggleAddition(line.code, addition, false)}
                        />
                        <span>{addition.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {master.data && masterItems.length === 0 && orphanLines.length === 0 && (
            <li className="order-select__muted">項目がありません</li>
          )}
        </ul>
        {records.data?.truncated && (
          <p className="order-select__muted">前回算定日は直近 500 件の記録から求めています</p>
        )}
      </fieldset>

      <fieldset>
        <legend>算定日</legend>
        {!setMode && (
          <label>
            算定日 *
            <input type="date" value={values.date} onChange={(e) => update("date", e.target.value)} required />
          </label>
        )}
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
      </fieldset>

      <fieldset>
        <legend>依頼共通</legend>
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
              備考
              <input type="text" value={values.comment} onChange={(e) => update("comment", e.target.value)} />
            </label>
            <button
              type="button"
              className="rp-card__icon-button"
              title="備考を削除"
              aria-label="備考を削除"
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
              ＋備考
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
  );
}
