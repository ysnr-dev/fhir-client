import { useState, type FormEvent } from "react";
import { useCareTeams } from "../api/queries";
import { careTeamKind, careTeamName } from "../fhir/careTeamHelpers";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import { questionnaireResponsePlainText, type TemplateBinding } from "../fhir/questionnaireResponseHelpers";
import {
  TEAM_REQUEST_PRIORITY_OPTIONS,
  emptyTeamRequestForm,
  validateTeamRequestForm,
  type TeamRequestFormValues,
  type TeamRequestPriority,
} from "../fhir/teamRequestHelpers";
import { makeFieldUpdater } from "../lib/form";
import { useBulkStartDate } from "../hooks/useBulkStartDate";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import { ErrorBanner } from "./ErrorBanner";
import { ProblemSelect } from "./ProblemSelect";
import { TemplateEntryModal } from "./TemplateEntryModal";

// チーム依頼の入力フォーム(docs/care-team-design.md §2)。他科依頼のフォームと同じ 1 枚で、
// 宛先が診療科ではなくチーム(CareTeam)になる。依頼目的はテンプレートからも書ける。

interface TeamRequestFormProps {
  patientId: string;
  initialValues?: TeamRequestFormValues;
  onSubmit: (values: TeamRequestFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
  bulkStartDate?: string;
  setMode?: boolean;
  hideSubmit?: boolean;
}

export function TeamRequestForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
  bulkStartDate,
  setMode = false,
  hideSubmit = false,
}: TeamRequestFormProps) {
  const [values, setValues] = useState<TeamRequestFormValues>(initialValues ?? emptyTeamRequestForm(""));
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));
  const [templateOpen, setTemplateOpen] = useState(false);
  const fromTemplate = Boolean(values.purposeTemplate);

  const problemOptions = useProblemOptions(patientId);
  useBulkStartDate(bulkStartDate, (date) => setValues((v) => ({ ...v, desiredDate: date })));
  const update = makeFieldUpdater(setValues);
  const teams = useCareTeams();

  function changeTeam(teamId: string) {
    const team = teams.data?.find((t) => t.id === teamId);
    setValues((v) => ({
      ...v,
      teamId,
      teamName: team ? careTeamName(team) : "",
      teamKind: team ? careTeamKind(team) : "",
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateTeamRequestForm(values, { requireDates: !setMode });
    setValidationError(error);
    if (error) return;
    onSubmit({ ...values, problem: refreshProblemDisplay(values.problem, problemOptions) });
  }

  return (
    <>
      <form className="prescription-form consult-form" onSubmit={handleSubmit} noValidate={hideSubmit}>
        {validationError && (
          <div className="error-banner" role="alert" ref={validationErrorRef}>
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={submitError} />
        <ErrorBanner error={teams.error} />

        <fieldset>
          <legend>依頼先</legend>
          <label>
            チーム *
            <select value={values.teamId} onChange={(e) => changeTeam(e.target.value)} required>
              <option value="">選択してください</option>
              {(teams.data ?? []).map((team) => (
                <option key={team.id} value={team.id}>
                  {careTeamName(team)}
                </option>
              ))}
              {values.teamId && !teams.data?.some((t) => t.id === values.teamId) && (
                <option value={values.teamId}>{values.teamName || values.teamId}</option>
              )}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>依頼内容</legend>
          <label>
            緊急度
            <select value={values.priority} onChange={(e) => update("priority", e.target.value as TeamRequestPriority)}>
              {TEAM_REQUEST_PRIORITY_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            希望日
            <input type="date" required value={values.desiredDate} onChange={(e) => update("desiredDate", e.target.value)} />
          </label>
          <div className="consult-form__wide">
            <span className="consult-form__field-label">依頼目的 *</span>
            <div className="rad-gp__template-field">
              <textarea
                rows={4}
                value={values.purpose}
                onChange={(e) => update("purpose", e.target.value)}
                readOnly={fromTemplate}
                aria-label="依頼目的"
                title={fromTemplate ? "テンプレートから記載した内容です。テンプレート編集から直します" : undefined}
                required
              />
              <div className="rad-gp__template-actions">
                <button
                  type="button"
                  onClick={() => setTemplateOpen(true)}
                  title={fromTemplate ? "依頼目的をテンプレートから直す" : "依頼目的をテンプレートから記入"}
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
          {!setMode && (
            <label>
              対象プロブレム
              <ProblemSelect value={values.problem} options={problemOptions} onChange={(problem) => update("problem", problem)} />
            </label>
          )}
        </fieldset>

        <fieldset>
          <legend>依頼共通</legend>
          <label>
            入外区分
            <select value={values.setting} onChange={(e) => update("setting", e.target.value as PrescriptionSetting)}>
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
                <input type="text" value={values.comment} onChange={(e) => update("comment", e.target.value)} />
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
              <button type="button" className="comment-add-button" onClick={() => setCommentOpen(true)}>
                ＋補足
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

      {templateOpen && (
        <TemplateEntryModal
          patientId={patientId}
          draft={values.purposeTemplate?.draft ?? null}
          responseId={values.purposeTemplate?.responseId ?? null}
          onSubmit={(draft) => {
            const binding: TemplateBinding = { responseId: values.purposeTemplate?.responseId ?? null, draft };
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
