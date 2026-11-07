import { localDay } from "../lib/dates";
import { responseAnswer, templateRecordState, type TemplateRecordState } from "./conditionTemplateHelpers";
import {
  containedPractitionerName,
  plainAnswerText,
  questionnaireResponsePlainText,
} from "./questionnaireResponseHelpers";

// 麻酔科術前診察(docs/anesthesia-preop-design.md)。手術オーダー 1 件につきテンプレートの回答 1 件で、
// 回答は `basedOn` で手術オーダーを指す。ここでは回答の突き合わせと、一覧・手術カード・麻酔チャートに
// 出す要点を組み立てる。読む側は basedOn で引くので、テンプレートを差し替えても過去の回答は読める。

/** 施設設定 anesthesia_preop(backend の DEFAULT_ANESTHESIA_PREOP と同じ形)。 */
export interface AnesthesiaPreopSettings {
  /** 術前診察のテンプレートの url(版を問わない)。 */
  template: string;
}

export const DEFAULT_ANESTHESIA_PREOP: AnesthesiaPreopSettings = {
  template: "http://fhir-client.local/Questionnaire/sur-anes-preop-01",
};

// ---- 回答の linkId ----

const ASA_LINK_ID = "anes_asa";
const ASA_EMERGENCY_LINK_ID = "anes_asa-e";
const NYHA_LINK_ID = "anes_nyha";
const MALLAMPATI_LINK_ID = "anes_mallampati";
const DIFFICULT_AIRWAY_LINK_ID = "anes_difficult-airway";
const ROOM_GROUP_LINK_ID = "grp-room";
const WARD_GROUP_LINK_ID = "grp-ward";

export const ANESTHESIA_PREOP_STATE_LABELS: Record<TemplateRecordState, string> = {
  missing: "未",
  draft: "記入中",
  done: "済",
};

/** 回答が指す手術オーダーの id。無ければ空。 */
export function anesthesiaPreopOrderIdOf(response: fhir4.QuestionnaireResponse): string {
  return (
    response.basedOn
      ?.map((reference) => reference.reference?.match(/^ServiceRequest\/(.+)$/)?.[1] ?? "")
      .find(Boolean) ?? ""
  );
}

/** オーダー id → 術前診察の回答。同じオーダーに複数あれば確定を優先し、同じ状態なら新しい方。 */
export function anesthesiaPreopsByOrderId(
  responses: fhir4.QuestionnaireResponse[],
): Map<string, fhir4.QuestionnaireResponse> {
  const byOrder = new Map<string, fhir4.QuestionnaireResponse>();
  const rank = (response: fhir4.QuestionnaireResponse) =>
    templateRecordState(response) === "done" ? 0 : 1;
  for (const response of responses) {
    if (response.status === "entered-in-error" || response.status === "stopped") continue;
    const orderId = anesthesiaPreopOrderIdOf(response);
    if (!orderId) continue;
    const current = byOrder.get(orderId);
    const isBetter =
      !current ||
      rank(response) - rank(current) < 0 ||
      (rank(response) === rank(current) && (response.authored ?? "") > (current.authored ?? ""));
    if (isBetter) byOrder.set(orderId, response);
  }
  return byOrder;
}

/** 回答のうち、指定のグループの中身を平文の行にする。 */
function groupLines(response: fhir4.QuestionnaireResponse, linkId: string): string[] {
  const group = response.item?.find((item) => item.linkId === linkId);
  if (!group?.item?.length) return [];
  const text = questionnaireResponsePlainText(
    { resourceType: "Questionnaire", status: "active" },
    { ...response, item: group.item },
  );
  return text ? text.split("\n") : [];
}

export interface AnesthesiaPreopSummary {
  state: TemplateRecordState;
  responseId: string;
  /** ASA-PS。緊急なら「2E」のように E を添える。未入力は空。 */
  asa: string;
  nyha: string;
  mallampati: string;
  /** 予測困難気道。なし / あり。未入力は空。 */
  difficultAirway: string;
  isDifficultAirway: boolean;
  /** 一覧の外(手術カード・麻酔チャート)で 1 行に並べる要点。 */
  highlights: string[];
  roomLines: string[];
  wardLines: string[];
  authorName: string;
  authoredOn: string;
}

function answerDisplay(response: fhir4.QuestionnaireResponse | undefined, linkId: string): string {
  const answer = responseAnswer(response, linkId);
  return answer ? plainAnswerText(answer) : "";
}

export function summarizeAnesthesiaPreop(
  response: fhir4.QuestionnaireResponse | undefined,
): AnesthesiaPreopSummary {
  const asaValue = answerDisplay(response, ASA_LINK_ID);
  const emergency = responseAnswer(response, ASA_EMERGENCY_LINK_ID)?.valueCoding?.code === "yes";
  const asa = asaValue ? `${asaValue}${emergency ? "E" : ""}` : "";
  const nyha = answerDisplay(response, NYHA_LINK_ID);
  const mallampati = answerDisplay(response, MALLAMPATI_LINK_ID);
  const difficultAirway = answerDisplay(response, DIFFICULT_AIRWAY_LINK_ID);
  const isDifficultAirway = responseAnswer(response, DIFFICULT_AIRWAY_LINK_ID)?.valueCoding?.code === "yes";
  return {
    state: templateRecordState(response),
    responseId: response?.id ?? "",
    asa,
    nyha,
    mallampati,
    difficultAirway,
    isDifficultAirway,
    highlights: [
      asa && `ASA ${asa}`,
      nyha && `NYHA ${nyha}`,
      mallampati && `Mallampati ${mallampati}`,
      difficultAirway && `予測困難気道 ${difficultAirway}`,
    ].filter(Boolean),
    roomLines: response ? groupLines(response, ROOM_GROUP_LINK_ID) : [],
    wardLines: response ? groupLines(response, WARD_GROUP_LINK_ID) : [],
    authorName: response ? containedPractitionerName(response) : "",
    authoredOn: response?.authored ? localDay(response.authored) : "",
  };
}

/** 記入済みの回答から、麻酔記録・症例登録の初期値に渡す ASA-PS のコード。 */
export function anesthesiaPreopAsaCodes(response: fhir4.QuestionnaireResponse | undefined): {
  asa: string;
  emergency: string;
} {
  return {
    asa: responseAnswer(response, ASA_LINK_ID)?.valueCoding?.code ?? "",
    emergency: responseAnswer(response, ASA_EMERGENCY_LINK_ID)?.valueCoding?.code ?? "",
  };
}
