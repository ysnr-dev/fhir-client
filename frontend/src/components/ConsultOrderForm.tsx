import { useMemo, useState, type FormEvent } from "react";
import { useDepartmentDoctors, useSelfDepartments, useSelfOrganization } from "../api/queries";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import {
  CONSULT_PRIORITY_OPTIONS,
  REQUEST_TYPE_OPTIONS,
  emptyConsultOrderForm,
  validateConsultOrderForm,
  type ConsultOrderFormValues,
  type ConsultPriority,
  type ConsultRequestType,
} from "../fhir/consultOrderHelpers";
import { departmentDisplayName, sortDepartmentsByCode } from "../fhir/departmentHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import {
  questionnaireResponsePlainText,
  type TemplateBinding,
} from "../fhir/questionnaireResponseHelpers";
import { makeFieldUpdater } from "../lib/form";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import { ErrorBanner } from "./ErrorBanner";
import { ProblemSelect } from "./ProblemSelect";
import { TemplateEntryModal } from "./TemplateEntryModal";

// 他科依頼の入力フォーム。明細も伝票レイアウトも無いので 1 枚で完結する。
//
// 他のオーダーと違うのは **依頼先を選ぶ欄がある**こと(docs/consult-order-design.md §2.1)。
// 依頼先の科は必須で、その科の医師の指名は任意。科を選び直したら指名は外す
// (別の科の医師が残ると、宛先の科とちぐはぐな依頼になる)。
//
// 依頼種別・緊急度は診療報酬や施設運用で増減する分類ではないので、DB マスタを持たず
// フロントの定数から選択肢を出す(§2.2)。
//
// 依頼目的はテンプレート(Questionnaire)からも書ける。病理の臨床経過・放射線の特別指示と
// 同じ作りで、記入した回答は平文になって欄に入り、回答そのものも
// QuestionnaireResponse として残る(§2.4)。科ごとに「何を書いてほしいか」が決まって
// いる依頼(術前評価・造影の可否など)で、訊く項目を揃えるために使う。

interface ConsultOrderFormProps {
  patientId: string;
  initialValues?: ConsultOrderFormValues;
  onSubmit: (values: ConsultOrderFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
}

export function ConsultOrderForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: ConsultOrderFormProps) {
  const [values, setValues] = useState<ConsultOrderFormValues>(
    initialValues ?? emptyConsultOrderForm(""),
  );
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));
  const [templateOpen, setTemplateOpen] = useState(false);
  const fromTemplate = Boolean(values.purposeTemplate);

  const problemOptions = useProblemOptions(patientId);
  const update = makeFieldUpdater(setValues);

  // 依頼先の候補は自院の診療科(部門ワークリストの絞り込みと同じ母集団)。
  const departments = useSelfDepartments();
  const departmentOptions = useMemo(
    () =>
      sortDepartmentsByCode(departments.departments)
        .filter((organization) => Boolean(organization.id))
        .map((organization) => ({
          id: organization.id as string,
          name: departmentDisplayName(organization),
        })),
    [departments.departments],
  );

  // 指名医師の候補。科を選ぶまでは引かない(依頼科 → 依頼医師の階層選択と同じ作り)。
  const { selfOrganizationId } = useSelfOrganization();
  const doctors = useDepartmentDoctors(
    values.targetDepartmentId || undefined,
    selfOrganizationId || undefined,
  );

  function changeDepartment(departmentId: string) {
    const option = departmentOptions.find((d) => d.id === departmentId);
    setValues((v) => ({
      ...v,
      targetDepartmentId: departmentId,
      targetDepartmentName: option?.name ?? "",
      // 科が変われば指名も外す(前の科の医師が残らないように)。
      targetPractitionerId: "",
      targetPractitionerName: "",
    }));
  }

  function changePractitioner(practitionerId: string) {
    const doctor = doctors.doctors.find((p) => p.id === practitionerId);
    setValues((v) => ({
      ...v,
      targetPractitionerId: practitionerId,
      targetPractitionerName: doctor ? practitionerDisplayName(doctor) : "",
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateConsultOrderForm(values);
    setValidationError(error);
    if (error) return;

    onSubmit({ ...values, problem: refreshProblemDisplay(values.problem, problemOptions) });
  }

  return (
    <>
      <form className="prescription-form consult-form" onSubmit={handleSubmit}>
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />
      <ErrorBanner error={departments.error} />

      {/* 依頼先。科は必須、医師の指名は任意(一覧の軸は科なので、指名しても
          その医師にだけ出るわけではない)。 */}
      <fieldset>
        <legend>依頼先</legend>
        <label>
          診療科 *
          <select
            value={values.targetDepartmentId}
            onChange={(e) => changeDepartment(e.target.value)}
            required
          >
            <option value="">選択してください</option>
            {departmentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          医師(指名)
          <select
            value={values.targetPractitionerId}
            onChange={(e) => changePractitioner(e.target.value)}
            disabled={!values.targetDepartmentId || doctors.isPending}
          >
            <option value="">指名しない</option>
            {doctors.doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {practitionerDisplayName(doctor)}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {/* 何をどれくらい急いで聞きたいか。具体的な内容は依頼目的の自由記載に書く。 */}
      <fieldset>
        <legend>依頼内容</legend>
        <label>
          依頼種別 *
          <select
            value={values.requestType}
            onChange={(e) => update("requestType", e.target.value as ConsultRequestType)}
            required
          >
            <option value="">選択してください</option>
            {REQUEST_TYPE_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          緊急度
          <select
            value={values.priority}
            onChange={(e) => update("priority", e.target.value as ConsultPriority)}
          >
            {CONSULT_PRIORITY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          希望日
          <input
            type="date"
            required
            value={values.desiredDate}
            onChange={(e) => update("desiredDate", e.target.value)}
          />
        </label>
        {/* テンプレート紐付き中は直接編集させない(回答と本文が食い違うため)。
            「解除」は紐付けだけ外し、記載された文言は残す。 */}
        <div className="consult-form__wide">
          <span className="consult-form__field-label">依頼目的 *</span>
          <div className="rad-gp__template-field">
            <textarea
              rows={4}
              value={values.purpose}
              onChange={(e) => update("purpose", e.target.value)}
              readOnly={fromTemplate}
              aria-label="依頼目的"
              placeholder={
                fromTemplate ? undefined : "心電図で ST 変化あり。虚血性心疾患の評価をお願いします。"
              }
              title={
                fromTemplate
                  ? "テンプレートから記載した内容です。テンプレート編集から直します"
                  : undefined
              }
              required
            />
            <div className="rad-gp__template-actions">
              <button
                type="button"
                onClick={() => setTemplateOpen(true)}
                title={
                  fromTemplate ? "依頼目的をテンプレートから直す" : "依頼目的をテンプレートから記入"
                }
              >
                {fromTemplate ? "テンプレート編集" : "テンプレート"}
              </button>
              {fromTemplate && (
                <button
                  type="button"
                  onClick={() => update("purposeTemplate", null)}
                  title="テンプレートとの紐付けを外して直接入力に戻す(記載された文言は残る)"
                >
                  解除
                </button>
              )}
            </div>
          </div>
        </div>
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
        {commentOpen ? (
          <div className="prescription-form__comment-field">
            <label>
              補足
              <input
                type="text"
                value={values.comment}
                onChange={(e) => update("comment", e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rp-card__icon-button"
              title="補足を削除"
              aria-label="補足を削除"
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
              ＋補足
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

      {/* モーダルは独自の入力(form)を持つため、外側フォームの子孫に置かない
          — form の入れ子は不正で、送信が外へ漏れる。 */}
      {templateOpen && (
        <TemplateEntryModal
          patientId={patientId}
          draft={values.purposeTemplate?.draft ?? null}
          responseId={values.purposeTemplate?.responseId ?? null}
          onSubmit={(draft) => {
            // 保存済みの回答を再編集した場合は同じ id へ書き戻す(id は保存時に使う)。
            const binding: TemplateBinding = {
              responseId: values.purposeTemplate?.responseId ?? null,
              draft,
            };
            setValues((current) => ({
              ...current,
              purpose: questionnaireResponsePlainText(draft.questionnaire, draft.response),
              purposeTemplate: binding,
            }));
            setTemplateOpen(false);
          }}
          onClose={() => setTemplateOpen(false)}
        />
      )}
    </>
  );
}
