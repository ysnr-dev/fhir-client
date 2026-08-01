import { FhirError } from "../api/fhirClient";

export interface OutcomeMessage {
  severity: string;
  text: string;
}

// issue.code 単位の和訳(上流の diagnostics は英語のため)。現状 duplicate を返すのは
// Questionnaire の canonical (url, version) 一意制約のみ。
const CODE_MESSAGES: Record<string, string> = {
  duplicate:
    "この URL・バージョンの組み合わせは既に別のテンプレートで使われています。URL かバージョンを変更してください。",
};

export function outcomeMessages(outcome?: fhir4.OperationOutcome): OutcomeMessage[] {
  if (!outcome?.issue?.length) return [];
  return outcome.issue.map((issue) => ({
    severity: issue.severity,
    text: CODE_MESSAGES[issue.code] ?? issue.diagnostics ?? issue.details?.text ?? issue.code,
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
