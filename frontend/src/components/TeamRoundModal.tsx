import { useState } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useSaveTeamRound, useTeamRounds } from "../api/queries";
import { careTeamRoundTemplate } from "../fhir/careTeamHelpers";
import {
  FREE_TEXT_SECTION_CODE,
  buildClinicalNote,
  emptyClinicalNoteForm,
  newSectionDraft,
  validateClinicalNote,
  type ClinicalNoteFormValues,
} from "../fhir/clinicalNoteHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { summarizeTeamRequest, teamRequestProblem } from "../fhir/teamRequestHelpers";
import { useOrderContext } from "../hooks/useOrderContext";
import { dateTimeLabel } from "../lib/dates";
import { ClinicalNoteForm } from "./ClinicalNoteForm";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { TeamRequestDetailPanel } from "./TeamRequestDetailPanel";

// チーム依頼の回診記録(docs/care-team-design.md §3)。他科依頼の回答モーダルと同じく、登録するのは
// 診療記録(経過記録 + category team-round、event.detail = 依頼)。何度書いても依頼は終了しない。
// 上に依頼内容と過去の回診記録、下に診療記録フォームと次回回診日。保存は 1 つの transaction で
// 「診療記録 + 依頼側の最後の回診・次回回診日(依頼済なら介入中)」を書く(useSaveTeamRound)。

interface Props {
  order: fhir4.ServiceRequest;
  task: fhir4.Task | undefined;
  /** 宛先のチーム(回診記録の既定テンプレートを引く)。 */
  team?: fhir4.CareTeam;
  patientId: string;
  patientName?: string;
  onClose: () => void;
}

export function TeamRoundModal({ order, task, team, patientId, patientName, onClose }: Props) {
  const summary = summarizeTeamRequest(order);
  const saveRound = useSaveTeamRound();
  const rounds = useTeamRounds(patientId, order.id);
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const orderContext = useOrderContext();
  const [validationError, setValidationError] = useState<string | null>(null);
  const [nextRoundDate, setNextRoundDate] = useState(summary.nextRoundDate);
  const roundTemplate = team ? careTeamRoundTemplate(team) : "";

  // 既定テンプレートがあればテンプレートの記載形式で開き、無ければ自由記載。
  const [initialValues] = useState<ClinicalNoteFormValues>(() => ({
    ...emptyClinicalNoteForm(teamRequestProblem(order)),
    mode: roundTemplate ? "template" : "free",
    sections: [newSectionDraft(FREE_TEXT_SECTION_CODE)],
    title: `${summary.teamName || "チーム"} 回診記録`,
  }));

  function handleSubmit(values: ClinicalNoteFormValues) {
    const error = validateClinicalNote(values, practitionerId);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    const { composition, entries } = buildClinicalNote(values, {
      patientId,
      practitioner,
      teamRequestId: order.id,
      department: orderContext,
    });
    saveRound.mutate(
      {
        order,
        task,
        composition,
        entries,
        roundDate: values.date.slice(0, 10),
        recorderName: practitioner ? practitionerDisplayName(practitioner) : "",
        nextRoundDate,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title={`回診記録${patientName ? ` - ${patientName}` : ""}`} onClose={onClose} className="modal--wide">
      <ErrorBanner error={saveRound.error} />
      <ErrorBanner error={rounds.error} />

      <TeamRequestDetailPanel serviceRequest={order} task={task} />

      {(rounds.data?.length ?? 0) > 0 && (
        <div className="prescription-detail">
          <fieldset>
            <legend>これまでの回診記録</legend>
            <ul className="team-round__list">
              {rounds.data?.map((round) => (
                <li key={round.id}>
                  <span className="team-round__date">{dateTimeLabel(round.date)}</span>
                  <span>{round.title}</span>
                  <span className="order-select__muted">{round.author?.[0]?.display}</span>
                </li>
              ))}
            </ul>
          </fieldset>
        </div>
      )}

      <div className="prescription-form team-round__next">
        <label>
          次回回診日
          <input type="date" value={nextRoundDate} onChange={(e) => setNextRoundDate(e.target.value)} />
        </label>
      </div>

      <ClinicalNoteForm
        patientId={patientId}
        initialValues={initialValues}
        onSubmit={handleSubmit}
        submitting={saveRound.isPending}
        validationError={validationError}
        submitLabel="回診記録登録"
        defaultTemplateCanonical={roundTemplate || undefined}
      />
    </Modal>
  );
}
