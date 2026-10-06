import { useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { usePractitionerOptions, useRegisterMedicationGuidancePerform } from "../api/queries";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { summarizeMedicationGuidanceOrder } from "../fhir/medicationGuidanceOrderHelpers";
import {
  buildMedicationGuidanceTaskUpdate,
  medicationGuidanceTaskStatus,
} from "../fhir/medicationGuidanceTaskHelpers";
import { taskBundleEntry } from "../api/queries/worklist";
import {
  UNDERSTANDING_OPTIONS,
  buildMedicationGuidancePerformBundle,
  defaultSessionTypeFor,
  emptyMedicationGuidancePerformForm,
  sessionTypesForOrder,
  validateMedicationGuidancePerformForm,
  type MedicationGuidancePerformFormValues,
  type MedicationGuidanceSessionType,
  type MedicationGuidanceUnderstanding,
} from "../fhir/medicationGuidanceResultHelpers";
import { questionnaireResponsePlainText, type TemplateBinding } from "../fhir/questionnaireResponseHelpers";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { TemplateEntryModal } from "./TemplateEntryModal";

// 服薬指導の実施入力。1 回ぶんの指導を登録する。栄養指導と同じく進捗 Task は動かさない
// (期間中ずっと実施中のまま、指導が積み上がる)。指導記録はテンプレートからも書ける。
// 担当薬剤師の既定はログイン中の医療従事者(実施したのがログインした人とは限らないので選び直せる)。

interface Props {
  order: fhir4.ServiceRequest;
  patientName?: string;
  patientId: string;
  /** 実施日の初期値。未指定なら当日。 */
  defaultDate?: string;
  /**
   * 受付を飛ばして実施するときの進捗 Task(クリニカルパスから開くとき)。渡すと、まだ依頼済なら
   * 実施と一緒に受付済にする(完了にはしない)。部門の一覧は受付済の行からしか開かないので渡さない。
   */
  acceptTask?: { task: fhir4.Task | undefined };
  onClose: () => void;
}

export function MedicationGuidancePerformModal({
  order,
  patientName,
  patientId,
  defaultDate,
  acceptTask,
  onClose,
}: Props) {
  const register = useRegisterMedicationGuidancePerform();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const { practitioners, error: practitionersError } = usePractitionerOptions();
  const summary = summarizeMedicationGuidanceOrder(order);
  const sessionTypes = sessionTypesForOrder(order);

  const [values, setValues] = useState<MedicationGuidancePerformFormValues>(() => {
    const base = emptyMedicationGuidancePerformForm(defaultSessionTypeFor(order));
    return {
      ...base,
      performedDate: defaultDate || base.performedDate,
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
    setValues((prev) => ({ ...prev, performerId: id, performerName: selected ? practitionerDisplayName(selected) : "" }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateMedicationGuidancePerformForm(values);
    setValidationError(error);
    if (error) return;
    const bundle = buildMedicationGuidancePerformBundle(values, order);
    if (acceptTask && medicationGuidanceTaskStatus(acceptTask.task) === "requested") {
      bundle.entry?.push(taskBundleEntry(buildMedicationGuidanceTaskUpdate(acceptTask.task, order, "accepted")));
    }
    register.mutate(bundle, { onSuccess: onClose });
  }

  return (
    <Modal title={`服薬指導の実施入力${patientName ? ` - ${patientName}` : ""}`} onClose={onClose} className="modal--wide">
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
          {[summary.kindDisplay, summary.conditionsLabel, summary.targetDrugs].filter(Boolean).join(" / ")}
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
            <input type="time" value={values.performedTime} onChange={(e) => update("performedTime", e.target.value)} />
          </label>
          <label>
            指導種別 *
            <select
              value={values.sessionType}
              onChange={(e) => update("sessionType", e.target.value as MedicationGuidanceSessionType)}
              required
            >
              <option value="">選択してください</option>
              {sessionTypes.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            理解度
            <select
              value={values.understanding}
              onChange={(e) => update("understanding", e.target.value as MedicationGuidanceUnderstanding | "")}
            >
              <option value="">選択してください</option>
              {UNDERSTANDING_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            担当薬剤師 *
            <select value={values.performerId} onChange={(e) => handlePerformerChange(e.target.value)} required>
              <option value="">選択してください</option>
              {practitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {practitionerDisplayName(p)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* テンプレート紐付き中は直接編集させない(回答と本文が食い違うため)。 */}
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
            />
            <div className="rad-gp__template-actions">
              <button type="button" onClick={() => setTemplateOpen(true)}>
                {fromTemplate ? "テンプレート編集" : "テンプレート"}
              </button>
              {fromTemplate && (
                <button type="button" onClick={() => update("recordTemplate", null)}>
                  解除
                </button>
              )}
            </div>
          </div>
        </section>

        <div className="prescription-form__actions">
          <button type="submit" disabled={register.isPending}>
            {register.isPending ? "登録中..." : "実施登録"}
          </button>
          <button type="button" onClick={onClose} disabled={register.isPending}>
            キャンセル
          </button>
        </div>
      </form>

      {/* テンプレート記入は form の外に置く(Modal は非ポータルなので form が入れ子になる)。 */}
      {templateOpen && (
        <TemplateEntryModal
          patientId={patientId}
          draft={values.recordTemplate?.draft ?? null}
          responseId={values.recordTemplate?.responseId ?? null}
          onSubmit={(draft) => {
            const binding: TemplateBinding = { responseId: values.recordTemplate?.responseId ?? null, draft };
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
