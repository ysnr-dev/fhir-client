import { useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { usePractitionerOptions, useRegisterRehabPerform } from "../api/queries";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import {
  REHAB_UNIT_LABEL,
  summarizeRehabOrder,
  therapyTypeDisplay,
  type RehabTherapyType,
} from "../fhir/rehabOrderHelpers";
import {
  buildRehabPerformBundle,
  emptyRehabPerformForm,
  validateRehabPerformForm,
  type RehabPerformFormValues,
} from "../fhir/rehabResultHelpers";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// リハビリの実施入力。1 回ぶんの実施を登録する。
//
// **他部門の実施入力と違い、進捗 Task を動かさない。** リハビリは 1 つのオーダーが
// 期間中ずっと受付済(実施中)のままで、その間に実施が何度も積み上がるため
// (docs/rehab-order-design.md §4)。他部門に合わせて Task を実施済にすると、
// 初日の実施で 2 日目以降が実施できなくなる。
//
// 器材・薬剤・データセットの入力欄は無い。リハビリの実施で個別算定する器材や薬剤は
// 無く、算定は単位数で決まるため。
//
// 担当療法士を選ばせるのは、実施したのがログインした人とは限らないから
// (受付が代わりに入れる運用がある)。既定はログイン中の医療従事者。

interface Props {
  order: fhir4.ServiceRequest;
  /** 誰のリハビリかを見出しに出す。 */
  patientName?: string;
  /** 実施日の初期値。予約から開いたときはその日を渡す。未指定なら当日。 */
  defaultDate?: string;
  /** 実施時刻の初期値(HH:mm)。予約から開いたときは枠の開始時刻を渡す。 */
  defaultTime?: string;
  onClose: () => void;
}

export function RehabPerformModal({
  order,
  patientName,
  defaultDate,
  defaultTime,
  onClose,
}: Props) {
  const register = useRegisterRehabPerform();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const { practitioners, error: practitionersError } = usePractitionerOptions();
  const summary = summarizeRehabOrder(order);

  // オーダーに載っている療法種別が 1 つだけなら選ぶまでもないので初期選択にする。
  const [values, setValues] = useState<RehabPerformFormValues>(() => {
    const base = emptyRehabPerformForm(
      summary.therapyTypes.length === 1 ? summary.therapyTypes[0] : "",
      summary.unitsPerSession == null ? "" : String(summary.unitsPerSession),
    );
    return {
      ...base,
      performedDate: defaultDate || base.performedDate,
      performedTime: defaultTime ?? base.performedTime,
      performerId: practitionerId ?? "",
      performerName: practitioner ? practitionerDisplayName(practitioner) : "",
    };
  });
  const [validationError, setValidationError] = useState("");

  const update = makeFieldUpdater(setValues);

  function handlePerformerChange(id: string) {
    const selected = practitioners.find((p) => p.id === id);
    setValues((prev) => ({
      ...prev,
      performerId: id,
      performerName: selected ? practitionerDisplayName(selected) : "",
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateRehabPerformForm(values);
    setValidationError(error);
    if (error) return;

    register.mutate(buildRehabPerformBundle(values, order), { onSuccess: onClose });
  }

  return (
    <Modal
      title={`リハビリの実施入力${patientName ? ` - ${patientName}` : ""}`}
      onClose={onClose}
      className="modal--wide"
    >
      <form className="transfusion-perform" onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={register.error} />
        <ErrorBanner error={practitionersError} />

        {/* 何のリハビリを何単位やる指示なのか。入力欄より先に目に入る位置に出す。 */}
        <p className="rad-perform__items">
          <span className="rad-perform__items-label">指示</span>
          {[summary.diseaseCategoryDisplay, summary.therapyTypesLabel, summary.scheduleLabel]
            .filter(Boolean)
            .join(" / ")}
        </p>

        <div className="lab-order-item__fields">
          <label>
            実施日 *
            <input
              type="date"
              value={values.performedDate}
              onChange={(e) => update("performedDate", e.target.value)}
              required
            />
          </label>
          <label>
            実施時刻
            <input
              type="time"
              value={values.performedTime}
              onChange={(e) => update("performedTime", e.target.value)}
            />
          </label>
          <label>
            療法種別 *
            <select
              value={values.therapyType}
              onChange={(e) => update("therapyType", e.target.value as RehabTherapyType)}
              required
            >
              <option value="">選択してください</option>
              {/* オーダーで指示された種別だけを出す。指示に無い療法を実施記録だけで
                  増やすと、算定の根拠がオーダーと食い違う。 */}
              {summary.therapyTypes.map((code) => (
                <option key={code} value={code}>
                  {therapyTypeDisplay(code)}
                </option>
              ))}
            </select>
          </label>
          <label>
            実施単位数 *
            <input
              type="number"
              min={1}
              max={24}
              step={1}
              value={values.units}
              onChange={(e) => update("units", e.target.value)}
              required
            />
          </label>
          <label>
            担当療法士 *
            <select
              value={values.performerId}
              onChange={(e) => handlePerformerChange(e.target.value)}
              required
            >
              <option value="">選択してください</option>
              {practitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {practitionerDisplayName(p)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>訓練内容</h3>
          </div>
          <label className="meal-comment">
            <textarea
              value={values.note}
              onChange={(e) => update("note", e.target.value)}
              rows={3}
              placeholder="歩行訓練 平行棒内 / 関節可動域訓練 など"
            />
          </label>
        </section>

        <p className="order-select__muted">
          実施を登録してもオーダーの進捗は変わりません(期間が終わるまで実施中のままです)。
          1 単位は 20 分・{REHAB_UNIT_LABEL}数は実際に行ったぶんを入れてください。
        </p>

        <div className="prescription-form__actions">
          <button type="submit" disabled={register.isPending}>
            {register.isPending ? "登録中..." : "実施を登録"}
          </button>
          <button type="button" onClick={onClose} disabled={register.isPending}>
            キャンセル
          </button>
        </div>
      </form>
    </Modal>
  );
}
