import type { ReactNode } from "react";
import { encounterAdmissionDate, encounterDischargeDate } from "../../fhir/encounterHelpers";
import type { NursingProblemView } from "../../fhir/nursingCarePlanHelpers";
import { nursingProfileSections, type NursingProfileSettings } from "../../fhir/nursingProfileHelpers";
import { questionnaireCanonical, questionnaireResponsePlainText } from "../../fhir/questionnaireResponseHelpers";
import { ClinicalNoteDetailPanel } from "../ClinicalNoteDetailPanel";
import { NursingProblemTree } from "../NursingProblemTree";
import { KartePrintEmptyRow, KartePrintGroupRow, KartePrintSheet } from "./KartePrintSheet";

// カルテ印刷の看護。期間に掛かる看護問題(計画・評価)、期間に重なる入院の看護サマリーと看護プロファイル。
// 看護問題は看護計画タブのカードと同じツリーで、終了日(今日より後なら今日)時点の目標を出す。

interface RecordExportNursingProps {
  header: ReactNode;
  problems: NursingProblemView[];
  summaries: fhir4.Composition[];
  admissions: fhir4.Encounter[];
  profileResponses: fhir4.QuestionnaireResponse[];
  profileQuestionnaires: fhir4.Questionnaire[];
  profileSettings: NursingProfileSettings;
  at: string;
}

export function RecordExportNursing({
  header,
  problems,
  summaries,
  admissions,
  profileResponses,
  profileQuestionnaires,
  profileSettings,
  at,
}: RecordExportNursingProps) {
  const profiles = admissions.flatMap((admission) => {
    const responses = profileResponses.filter(
      (response) => response.encounter?.reference === `Encounter/${admission.id}`,
    );
    const sections = nursingProfileSections(profileSettings, [], responses, profileQuestionnaires).flatMap(
      (section) => {
        const { response } = section;
        const written = response
          ? profileQuestionnaires.find((q) => questionnaireCanonical(q) === response.questionnaire)
          : undefined;
        const text = response && written ? questionnaireResponsePlainText(written, response) : "";
        return text ? [{ title: section.title, text }] : [];
      },
    );
    return sections.length > 0 ? [{ admission, sections }] : [];
  });

  return (
    <KartePrintSheet header={header} title="看護">
      <KartePrintGroupRow span={1}>看護問題</KartePrintGroupRow>
      {problems.length === 0 ? (
        <KartePrintEmptyRow span={1}>期間内の看護問題はありません。</KartePrintEmptyRow>
      ) : (
        problems.map((view) => (
          <tr key={view.condition.id}>
            <td>
              <div className="karte-print__item-head">
                <span className="karte-print__title">
                  {view.active ? `#${view.priority} ` : ""}
                  {view.name}
                </span>
                <span className="karte-print__meta">
                  立案 {view.onsetDate}
                  {view.abatementDate && ` / 解決 ${view.abatementDate}`}
                </span>
              </div>
              <NursingProblemTree view={view} at={at} />
            </td>
          </tr>
        ))
      )}

      <KartePrintGroupRow span={1}>看護サマリー</KartePrintGroupRow>
      {summaries.length === 0 ? (
        <KartePrintEmptyRow span={1}>期間内の看護サマリーはありません。</KartePrintEmptyRow>
      ) : (
        summaries.map((summary) => (
          <tr key={summary.id} className="karte-print__summary">
            <td>
              <ClinicalNoteDetailPanel note={summary} hideCountersign />
            </td>
          </tr>
        ))
      )}

      <KartePrintGroupRow span={1}>看護プロファイル</KartePrintGroupRow>
      {profiles.length === 0 ? (
        <KartePrintEmptyRow span={1}>期間内の看護プロファイルはありません。</KartePrintEmptyRow>
      ) : (
        profiles.map(({ admission, sections }) => (
          <tr key={admission.id}>
            <td>
              <div className="karte-print__item-head">
                <span className="karte-print__title">{admissionLabel(admission)}</span>
              </div>
              {sections.map((section) => (
                <div key={section.title} className="karte-print__profile">
                  <div className="karte-print__profile-title">{section.title}</div>
                  <div className="nursing-profile__text">{section.text}</div>
                </div>
              ))}
            </td>
          </tr>
        ))
      )}
    </KartePrintSheet>
  );
}

function admissionLabel(admission: fhir4.Encounter): string {
  const discharge = encounterDischargeDate(admission);
  return `入院 ${encounterAdmissionDate(admission)} 〜 ${discharge === "-" ? "" : discharge}`;
}
