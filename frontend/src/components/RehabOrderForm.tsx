import { useState, type FormEvent } from "react";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import {
  DISEASE_CATEGORY_OPTIONS,
  THERAPY_TYPE_OPTIONS,
  emptyRehabOrderForm,
  rehabElapsedDays,
  validateRehabOrderForm,
  type RehabDiseaseCategory,
  type RehabOrderFormValues,
  type RehabTherapyType,
} from "../fhir/rehabOrderHelpers";
import { makeFieldUpdater } from "../lib/form";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { ErrorBanner } from "./ErrorBanner";
import { ProblemSelect } from "./ProblemSelect";

// リハビリオーダーの入力フォーム。食事と同じく明細も伝票レイアウトも無いので
// 1 枚のフォームで完結する。
//
// 疾患別リハ区分と療法種別はどちらも診療報酬上の固定の分類で、施設ごとに増減しない。
// DB マスタを持たずフロントの定数から選択肢を出す(docs/rehab-order-design.md §3)。
//
// 療法種別だけがチェックボックス群なのは、1 人の患者に PT と OT を併せて出すことが
// 普通にあるため。種別ごとに単位数が分かれないので、単位数はオーダー全体で 1 つ。
//
// 至急区分と時刻の入力欄は持たない。何時に行うかは予約(Appointment)と実施記録
// (Procedure)の担当で、オーダーは「いつからいつまで、週何回、1 回何単位」を決める。

interface RehabOrderFormProps {
  patientId: string;
  initialValues?: RehabOrderFormValues;
  onSubmit: (values: RehabOrderFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
}

export function RehabOrderForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: RehabOrderFormProps) {
  const [values, setValues] = useState<RehabOrderFormValues>(
    initialValues ?? emptyRehabOrderForm(""),
  );
  const [validationError, setValidationError] = useState("");
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));

  const problemOptions = useProblemOptions(patientId);
  const update = makeFieldUpdater(setValues);

  function toggleTherapyType(code: RehabTherapyType, checked: boolean) {
    setValues((v) => ({
      ...v,
      therapyTypes: checked
        ? [...v.therapyTypes, code]
        : v.therapyTypes.filter((type) => type !== code),
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateRehabOrderForm(values);
    setValidationError(error);
    if (error) return;

    onSubmit({ ...values, problem: refreshProblemDisplay(values.problem, problemOptions) });
  }

  // 起算日からの経過日数。疾患別リハの算定日数上限(150 日・180 日)を意識する
  // 手がかりとして出す。上限そのものの警告は未実装。
  const elapsedDays = rehabElapsedDays(values.onsetDate, values.startDate);

  return (
    <form className="prescription-form" onSubmit={handleSubmit}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <fieldset>
        <legend>リハビリ内容</legend>
        <label>
          疾患別リハ区分 *
          <select
            value={values.diseaseCategory}
            onChange={(e) => update("diseaseCategory", e.target.value as RehabDiseaseCategory)}
            required
          >
            <option value="">選択してください</option>
            {DISEASE_CATEGORY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {/* 療法種別。PT・OT・ST は併用できるのでチェックボックスで複数選ばせる。 */}
      <fieldset>
        <legend>療法種別 *</legend>
        <div className="rehab-order__therapy-types">
          {THERAPY_TYPE_OPTIONS.map((o) => (
            <label key={o.code} className="rehab-order__therapy-type">
              <input
                type="checkbox"
                checked={values.therapyTypes.includes(o.code)}
                onChange={(e) => toggleTherapyType(o.code, e.target.checked)}
              />
              {o.display}
            </label>
          ))}
        </div>
      </fieldset>

      {/* 実施の目安。週何回・1 回何単位で、実際に何回行ったかは実施記録が正本。 */}
      <fieldset>
        <legend>実施量</legend>
        <label>
          1回あたりの単位数 *
          <input
            type="number"
            min={1}
            max={24}
            step={1}
            value={values.unitsPerSession}
            onChange={(e) => update("unitsPerSession", e.target.value)}
            required
          />
        </label>
        <label>
          週あたりの回数
          <input
            type="number"
            min={1}
            max={7}
            step={1}
            value={values.frequencyPerWeek}
            onChange={(e) => update("frequencyPerWeek", e.target.value)}
            placeholder="目安"
          />
        </label>
        <p className="order-select__muted">
          1 単位は 20 分。実際に行った単位数は実施記録に入れます。
        </p>
      </fieldset>

      {/* 期間。終了日を入れなければ継続で、部門一覧の「終了」か退院で終わる。 */}
      <fieldset>
        <legend>期間</legend>
        <label>
          開始日 *
          <input
            type="date"
            value={values.startDate}
            onChange={(e) => update("startDate", e.target.value)}
            required
          />
        </label>
        <label>
          終了日
          <input
            type="date"
            value={values.endDate}
            onChange={(e) => update("endDate", e.target.value)}
            placeholder="空欄なら継続"
          />
        </label>
      </fieldset>

      {/* 起算日と対象疾患名は疾患別リハの算定要件。起算日は算定日数上限の起点。 */}
      <fieldset>
        <legend>対象</legend>
        <label>
          対象疾患名 *
          <input
            type="text"
            value={values.targetDisease}
            onChange={(e) => update("targetDisease", e.target.value)}
            placeholder="脳梗塞 など"
            required
          />
        </label>
        <label>
          起算日
          <input
            type="date"
            value={values.onsetDate}
            onChange={(e) => update("onsetDate", e.target.value)}
            placeholder="発症日・手術日"
          />
        </label>
        {elapsedDays !== undefined && (
          <p className="order-select__muted">開始日は起算日から {elapsedDays} 日目です。</p>
        )}
        <label>
          対象プロブレム
          <ProblemSelect
            value={values.problem}
            options={problemOptions}
            onChange={(problem) => update("problem", problem)}
          />
        </label>
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
        <label>
          依頼日
          <input
            type="date"
            value={values.authoredDate}
            onChange={(e) => update("authoredDate", e.target.value)}
          />
        </label>
        {commentOpen ? (
          <div className="prescription-form__comment-field">
            <label>
              リハ部門への指示
              <input
                type="text"
                value={values.comment}
                onChange={(e) => update("comment", e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rp-card__icon-button"
              title="リハ部門への指示を削除"
              aria-label="リハ部門への指示を削除"
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
              ＋リハ部門への指示
            </button>
          </div>
        )}
      </fieldset>

      <div className="prescription-form__actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "保存中..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
