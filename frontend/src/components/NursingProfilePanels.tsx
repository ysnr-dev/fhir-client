import { useEffect, useMemo, useState } from "react";
import {
  useNursingProfileResponses,
  useNursingProfileSettings,
  usePatientAdmissions,
  useQuestionnaireOptions,
} from "../api/queries";
import { ADMISSION_STATUS, admissionLabel } from "../fhir/encounterHelpers";
import { nursingProfileSections } from "../fhir/nursingProfileHelpers";
import { ErrorBanner } from "./ErrorBanner";
import {
  QuestionnaireResponseCreatePanel,
  QuestionnaireResponseEditPanel,
} from "./QuestionnaireResponsePanels";

// 看護プロファイルの記入(カルテ右ペイン。docs/nursing-profile-design.md)。
//
// 対象の入院と区画を選び、その入院でその区画に回答があれば編集、無ければ区画のテンプレートで
// 新規に書く(1 入院 1 区画 1 件)。区画は施設設定で並べたテンプレート。

interface NursingProfilePanelProps {
  patientId: string;
  /** タブから開いたときの対象の入院。無ければ今の入院(無ければ最新の退院)。 */
  defaultEncounterId?: string;
  /** タブから開いたときの区画(テンプレートの url)。無ければ先頭の区画。 */
  defaultTemplateUrl?: string;
  onSaved: () => void;
}

export function NursingProfilePanel({
  patientId,
  defaultEncounterId,
  defaultTemplateUrl,
  onSaved,
}: NursingProfilePanelProps) {
  const admissions = usePatientAdmissions(patientId);
  const [encounterId, setEncounterId] = useState(defaultEncounterId ?? "");
  useEffect(() => {
    if (encounterId || !admissions.data?.length) return;
    const current = admissions.data.find((e) => e.status === ADMISSION_STATUS);
    setEncounterId((current ?? admissions.data[0]).id ?? "");
  }, [admissions.data, encounterId]);

  const profile = useNursingProfileSettings();
  const options = useQuestionnaireOptions({ status: "active" });
  const answered = useNursingProfileResponses(encounterId || undefined);
  const sections = useMemo(
    () =>
      nursingProfileSections(
        profile.settings,
        options.questionnaires,
        answered.data?.responses ?? [],
        answered.data?.questionnaires,
      ),
    [profile.settings, options.questionnaires, answered.data],
  );
  const [templateUrl, setTemplateUrl] = useState(defaultTemplateUrl ?? "");
  const section = sections.find((s) => s.url === templateUrl) ?? sections[0];

  const loading = admissions.isLoading || profile.isLoading || options.isLoading;

  return (
    <>
      <ErrorBanner error={admissions.error} />
      <ErrorBanner error={profile.error} />
      <ErrorBanner error={options.error} />
      <ErrorBanner error={answered.error} />
      {loading ? (
        <p>読み込み中...</p>
      ) : !admissions.data?.length ? (
        <p className="patient-table__empty">この患者に入院の記録がありません。</p>
      ) : sections.length === 0 ? (
        <p className="patient-table__empty">
          看護プロファイルの区画が設定されていません。管理の施設設定で区画のテンプレートを選んでください。
        </p>
      ) : (
        <>
          <div className="patient-form nursing-profile__target">
            <label>
              対象の入院
              <select value={encounterId} onChange={(e) => setEncounterId(e.target.value)}>
                {admissions.data.map((e) => (
                  <option key={e.id} value={e.id}>
                    {admissionLabel(e)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="nursing-profile__sections" role="group" aria-label="区画">
            {sections.map((s) => (
              <button
                key={s.url}
                type="button"
                aria-pressed={s === section}
                className={`nursing-profile__section-button${
                  s === section ? " nursing-profile__section-button--selected" : ""
                }`}
                onClick={() => setTemplateUrl(s.url)}
              >
                {s.title}
                {s.response && <span className="nursing-profile__done">済</span>}
              </button>
            ))}
          </div>
          {!answered.isSuccess || !section ? (
            <p>読み込み中...</p>
          ) : section.response?.id ? (
            <QuestionnaireResponseEditPanel
              key={section.response.id}
              patientId={patientId}
              qrId={section.response.id}
              showProblem={false}
              onSaved={onSaved}
            />
          ) : section.questionnaire ? (
            <QuestionnaireResponseCreatePanel
              key={`${encounterId}:${section.url}`}
              patientId={patientId}
              fixedQuestionnaire={section.questionnaire}
              encounterId={encounterId}
              showProblem={false}
              onSaved={onSaved}
            />
          ) : (
            <p className="patient-table__empty">
              この区画のテンプレート({section.url})に有効な版がありません。
            </p>
          )}
        </>
      )}
    </>
  );
}
