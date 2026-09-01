import { useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { usePractitionerOptions, useRegisterNutritionGuidancePerform } from "../api/queries";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { summarizeNutritionGuidanceOrder } from "../fhir/nutritionGuidanceOrderHelpers";
import {
  buildNutritionGuidancePerformBundle,
  emptyNutritionGuidancePerformForm,
  sessionTypesForOrder,
  validateNutritionGuidancePerformForm,
  type NutritionGuidancePerformFormValues,
  type NutritionGuidanceSessionType,
} from "../fhir/nutritionGuidanceResultHelpers";
import {
  questionnaireResponsePlainText,
  type TemplateBinding,
} from "../fhir/questionnaireResponseHelpers";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { TemplateEntryModal } from "./TemplateEntryModal";

// 栄養指導の実施入力。1 回ぶんの指導を登録する。
//
// **リハビリと同じく、進捗 Task を動かさない。** 1 つのオーダーが期間中ずっと受付済
// (実施中)のままで、その間に指導が何度も積み上がるため
// (docs/nutrition-guidance-order-design.md §3)。初回の指導で Task を実施済にすると
// 2 回目以降が実施できなくなる。
//
// リハビリと違うのは指導記録をテンプレート(Questionnaire)からも書けること(§4.2)。
// 記入した回答は平文になって指導内容の欄に入り、回答そのものも QuestionnaireResponse
// として残る(他科依頼の依頼目的・放射線の特別指示と同じ作り)。
//
// 担当管理栄養士を選ばせるのは、実施したのがログインした人とは限らないから。
// 既定はログイン中の医療従事者。

interface Props {
  order: fhir4.ServiceRequest;
  /** 誰の栄養指導かを見出しに出す。 */
  patientName?: string;
  /** 患者 id。テンプレートの記入で使う。 */
  patientId: string;
  /** 実施日の初期値。予約から開いたときはその日を渡す。未指定なら当日。 */
  defaultDate?: string;
  /** 実施時刻の初期値(HH:mm)。予約から開いたときは枠の開始時刻を渡す。 */
  defaultTime?: string;
  onClose: () => void;
}

export function NutritionGuidancePerformModal({
  order,
  patientName,
  patientId,
  defaultDate,
  defaultTime,
  onClose,
}: Props) {
  const register = useRegisterNutritionGuidancePerform();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const { practitioners, error: practitionersError } = usePractitionerOptions();
  const summary = summarizeNutritionGuidanceOrder(order);
  // オーダーの指導形態で選べる指導種別が決まる(集団オーダーなら「集団」だけ)。
  const sessionTypes = sessionTypesForOrder(order);

  const [values, setValues] = useState<NutritionGuidancePerformFormValues>(() => {
    const base = emptyNutritionGuidancePerformForm(
      sessionTypes.length === 1 ? sessionTypes[0].code : "",
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
  const [templateOpen, setTemplateOpen] = useState(false);

  const update = makeFieldUpdater(setValues);
  const fromTemplate = Boolean(values.recordTemplate);

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
    const error = validateNutritionGuidancePerformForm(values);
    setValidationError(error);
    if (error) return;

    register.mutate(buildNutritionGuidancePerformBundle(values, order), { onSuccess: onClose });
  }

  return (
    <Modal
      title={`栄養指導の実施入力${patientName ? ` - ${patientName}` : ""}`}
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

        {/* 何を対象にした指導の指示なのか。入力欄より先に目に入る位置に出す。 */}
        <p className="rad-perform__items">
          <span className="rad-perform__items-label">指示</span>
          {[summary.formatDisplay, summary.targetDisease, summary.targetDiet]
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
            指導種別 *
            <select
              value={values.sessionType}
              onChange={(e) =>
                update("sessionType", e.target.value as NutritionGuidanceSessionType)
              }
              required
            >
              <option value="">選択してください</option>
              {/* オーダーの指導形態と食い違う種別は出さない。個別のオーダーに
                  「集団指導」を入れると算定区分がオーダーと食い違う。 */}
              {sessionTypes.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            実施時間(分) *
            <input
              type="number"
              min={1}
              max={600}
              step={1}
              value={values.minutes}
              onChange={(e) => update("minutes", e.target.value)}
              placeholder="初回30・継続20 が算定の目安"
              required
            />
          </label>
          <label>
            担当管理栄養士 *
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

        {/* テンプレート紐付き中は直接編集させない(回答と本文が食い違うため)。
            「解除」は紐付けだけ外し、記載された文言は残す。 */}
        <section className="lab-order-item__section lab-order-item__section--tail">
          <div className="lab-order-item__section-head">
            <h3>指導内容</h3>
          </div>
          <div className="rad-gp__template-field">
            <textarea
              rows={4}
              value={values.note}
              onChange={(e) => update("note", e.target.value)}
              readOnly={fromTemplate}
              aria-label="指導内容"
              placeholder={
                fromTemplate
                  ? undefined
                  : "1日1600kcalの食事内容を説明。間食の置き換えを提案 など"
              }
              title={
                fromTemplate
                  ? "テンプレートから記載した内容です。テンプレート編集から直します"
                  : undefined
              }
            />
            <div className="rad-gp__template-actions">
              <button
                type="button"
                onClick={() => setTemplateOpen(true)}
                title={
                  fromTemplate ? "指導内容をテンプレートから直す" : "指導内容をテンプレートから記入"
                }
              >
                {fromTemplate ? "テンプレート編集" : "テンプレート"}
              </button>
              {fromTemplate && (
                <button
                  type="button"
                  onClick={() => update("recordTemplate", null)}
                  title="テンプレートとの紐付けを外して直接入力に戻す(記載された文言は残る)"
                >
                  解除
                </button>
              )}
            </div>
          </div>
        </section>

        <div className="prescription-form__actions">
          <button type="submit" disabled={register.isPending}>
            {register.isPending ? "登録中..." : "実施を登録"}
          </button>
          <button type="button" onClick={onClose} disabled={register.isPending}>
            キャンセル
          </button>
        </div>
      </form>

      {/* テンプレート記入は form の外に置く(Modal は非ポータルなので、form の中に
          もう 1 つ form を書くと入れ子になり送信が外へ漏れる)。 */}
      {templateOpen && (
        <TemplateEntryModal
          patientId={patientId}
          draft={values.recordTemplate?.draft ?? null}
          responseId={values.recordTemplate?.responseId ?? null}
          onSubmit={(draft) => {
            // 保存済みの回答を再編集した場合は同じ id へ書き戻す(id は保存時に使う)。
            const binding: TemplateBinding = {
              responseId: values.recordTemplate?.responseId ?? null,
              draft,
            };
            setValues((current) => ({
              ...current,
              note: questionnaireResponsePlainText(draft.questionnaire, draft.response),
              recordTemplate: binding,
            }));
            setTemplateOpen(false);
          }}
          onClose={() => setTemplateOpen(false)}
        />
      )}
    </Modal>
  );
}
