import { useState } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useDecideBroughtMedications } from "../api/queries";
import {
  broughtMedicationEntry,
  buildDecidedMedication,
  isAwaitingDecision,
  summarizeBroughtMedication,
} from "../fhir/broughtMedicationHelpers";
import { completeBroughtMedIdentifiedEntries } from "../fhir/broughtMedTaskHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 持参薬の休止・中止。理由を 1 つ入れて、選んだ持参薬にまとめて付ける。
// 継続していた持参薬を止めるときは、起こした処方の進捗も中止にする。
// 判断が出揃ったら、同じ transaction で鑑別済の通知を閉じる。

const TITLES = { hold: "持参薬の休止", stop: "持参薬の中止" };

interface BroughtMedicationDecisionModalProps {
  decision: "hold" | "stop";
  statements: fhir4.MedicationStatement[];
  /** 同じ入院の持参薬すべて(判断が出揃ったかを見る)。 */
  encounterStatements: fhir4.MedicationStatement[];
  /** 同じ入院の鑑別依頼・鑑別済の通知。 */
  tasks: fhir4.Task[];
  onClose: () => void;
}

export function BroughtMedicationDecisionModal({
  decision,
  statements,
  encounterStatements,
  tasks,
  onClose,
}: BroughtMedicationDecisionModalProps) {
  const [reason, setReason] = useState("");
  const decide = useDecideBroughtMedications();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const actor =
    practitionerId && practitioner
      ? { practitionerId, display: practitionerDisplayName(practitioner) }
      : null;

  function handleSave() {
    if (!actor) return;
    const entries = statements.map((statement) =>
      broughtMedicationEntry(buildDecidedMedication(statement, decision, reason, actor)),
    );
    const decidedIds = new Set(statements.map((s) => s.id));
    const stillAwaiting = encounterStatements.some(
      (s) => isAwaitingDecision(s) && !decidedIds.has(s.id),
    );
    if (!stillAwaiting) entries.push(...completeBroughtMedIdentifiedEntries(tasks, actor));
    const stopOrderIds = statements
      .map((s) => summarizeBroughtMedication(s))
      .filter((summary) => summary.state === "continued" && summary.convertedOrderId)
      .map((summary) => summary.convertedOrderId as string);
    decide.mutate({ entries, stopOrderIds }, { onSuccess: onClose });
  }

  return (
    <Modal title={TITLES[decision]} onClose={onClose}>
      {!actor && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            判断は医療従事者に紐付いたアカウントで登録してください。
          </p>
        </div>
      )}
      <ErrorBanner error={decide.error} />
      <ul className="brought-med__decision-list">
        {statements.map((statement) => (
          <li key={statement.id}>{summarizeBroughtMedication(statement).name}</li>
        ))}
      </ul>
      <label className="brought-med__reason">
        理由
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="brought-med__actions">
        <button type="button" onClick={onClose}>
          キャンセル
        </button>
        <button type="button" onClick={handleSave} disabled={!actor || decide.isPending}>
          {decide.isPending ? "保存中..." : decision === "hold" ? "休止" : "中止"}
        </button>
      </div>
    </Modal>
  );
}
