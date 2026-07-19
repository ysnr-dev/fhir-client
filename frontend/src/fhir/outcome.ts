import { FhirError } from "../api/fhirClient";

export interface OutcomeMessage {
  severity: string;
  text: string;
}

export function outcomeMessages(outcome?: fhir4.OperationOutcome): OutcomeMessage[] {
  if (!outcome?.issue?.length) return [];
  return outcome.issue.map((issue) => ({
    severity: issue.severity,
    text: issue.diagnostics ?? issue.details?.text ?? issue.code,
  }));
}

export function errorMessages(error: unknown): OutcomeMessage[] {
  if (error instanceof FhirError) {
    const messages = outcomeMessages(error.outcome);
    if (messages.length) return messages;
    return [{ severity: "error", text: `サーバーエラーが発生しました (HTTP ${error.status})` }];
  }
  if (error instanceof Error) {
    return [{ severity: "error", text: error.message }];
  }
  return [{ severity: "error", text: "不明なエラーが発生しました" }];
}
