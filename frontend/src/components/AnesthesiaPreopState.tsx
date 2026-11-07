import { ANESTHESIA_PREOP_STATE_LABELS, summarizeAnesthesiaPreop } from "../fhir/anesthesiaPreopHelpers";

/** 手術の行に出す術前診察の状況。確定していれば ASA-PS を添える。 */
export function AnesthesiaPreopState({ response }: { response?: fhir4.QuestionnaireResponse }) {
  const preop = summarizeAnesthesiaPreop(response);

  return (
    <span className={`admission-documents__cell--${preop.state}`}>
      {preop.state === "done" && preop.asa ? `ASA ${preop.asa}` : ANESTHESIA_PREOP_STATE_LABELS[preop.state]}
    </span>
  );
}
