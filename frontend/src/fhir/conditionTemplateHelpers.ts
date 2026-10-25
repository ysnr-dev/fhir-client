import { summarizeCondition } from "./conditionHelpers";
import { questionnaireResponseProblem } from "./questionnaireResponseHelpers";

// 「病名 1 件につきテンプレートの回答 1 件」で記録する業務(院内がん登録・感染症の発生届)の共通部分。
// 回答の対象プロブレムが病名を指していればその病名の記録、対象を持たない回答(手で書いたもの)は
// その患者の病名のうち開始日が最も古いものに当てる。

export type TemplateRecordState = "missing" | "draft" | "done";

export function templateRecordState(response: fhir4.QuestionnaireResponse | undefined): TemplateRecordState {
  if (!response) return "missing";
  return response.status === "completed" || response.status === "amended" ? "done" : "draft";
}

/** 回答の中の linkId の最初の答え。 */
export function responseAnswer(
  response: fhir4.QuestionnaireResponse | undefined,
  linkId: string,
): fhir4.QuestionnaireResponseItemAnswer | undefined {
  const walk = (items: fhir4.QuestionnaireResponseItem[] | undefined): fhir4.QuestionnaireResponseItemAnswer | undefined => {
    for (const item of items ?? []) {
      if (item.linkId === linkId) return item.answer?.[0];
      const found = walk(item.item) ?? walk(item.answer?.flatMap((a) => a.item ?? []));
      if (found) return found;
    }
    return undefined;
  };
  return walk(response?.item);
}

/** 同じ病名に当たる回答のうち採るもの。確定を優先し、同じ状態なら新しい方。 */
function pickResponse(responses: fhir4.QuestionnaireResponse[]): fhir4.QuestionnaireResponse | undefined {
  return [...responses].sort((a, b) => {
    const rank = (r: fhir4.QuestionnaireResponse) => (templateRecordState(r) === "done" ? 0 : 1);
    return rank(a) - rank(b) || (b.authored ?? "").localeCompare(a.authored ?? "");
  })[0];
}

export function conditionPatientId(condition: fhir4.Condition): string {
  return condition.subject?.reference?.split("/").pop() ?? "";
}

/**
 * 病名と回答を突き合わせる。返す配列は患者 → 開始日の順に並ぶ。誤記・中止の回答は数えない。
 */
export function matchConditionResponses(
  conditions: fhir4.Condition[],
  responses: fhir4.QuestionnaireResponse[],
): { condition: fhir4.Condition; patientId: string; response?: fhir4.QuestionnaireResponse }[] {
  const live = responses.filter((r) => r.status !== "entered-in-error" && r.status !== "stopped");
  const byCondition = new Map<string, fhir4.QuestionnaireResponse[]>();
  const unlinkedByPatient = new Map<string, fhir4.QuestionnaireResponse[]>();
  for (const response of live) {
    const conditionId = questionnaireResponseProblem(response)?.conditionId;
    const patientId = response.subject?.reference?.split("/").pop() ?? "";
    const key = conditionId && conditions.some((c) => c.id === conditionId) ? conditionId : "";
    const map = key ? byCondition : unlinkedByPatient;
    const id = key || patientId;
    map.set(id, [...(map.get(id) ?? []), response]);
  }

  const sorted = [...conditions].sort(
    (a, b) =>
      conditionPatientId(a).localeCompare(conditionPatientId(b)) ||
      summarizeCondition(a).startDate.localeCompare(summarizeCondition(b).startDate),
  );
  const firstRowOfPatient = new Set<string>();
  return sorted.map((condition) => {
    const patientId = conditionPatientId(condition);
    const candidates = [...(byCondition.get(condition.id ?? "") ?? [])];
    if (!firstRowOfPatient.has(patientId)) {
      firstRowOfPatient.add(patientId);
      candidates.push(...(unlinkedByPatient.get(patientId) ?? []));
    }
    return { condition, patientId, response: pickResponse(candidates) };
  });
}
