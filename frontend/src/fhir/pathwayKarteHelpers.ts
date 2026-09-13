import {
  PATHWAY_EXT,
  PATHWAY_LEVEL_SYSTEM,
  pathwayCodeOf,
} from "./pathwayApplyHelpers";
import {
  ACHIEVEMENT_SYSTEM,
  EVALUATION_ITEM_SYSTEM,
  FREE_TEXT_CODE,
  achievementLabel,
  type Achievement,
} from "./pathwayEvaluationHelpers";
import { eventDayStepLabel } from "./pathwayHelpers";

// カルテのタイムラインに出す「パス評価」のカード。記載(S/O/A/P・自由記載・コメント)のある
// アウトカムの評価だけを、どのパスのどの病日のどのアウトカムかと一緒にカードの形にする。
// React に依存しない。設計は docs/clinical-pathway-design.md §6(カルテのカード)。

export interface PathwayEvaluationCard {
  observation: fhir4.Observation;
  /** 適用(木の根)の CarePlan の id と、パスのコード・名前。 */
  applyId: string;
  pathwayCode: string;
  pathwayTitle: string;
  /** 病日の CarePlan の id・見出し(「病日 3 術後1日目」)・日付。 */
  eventId: string;
  eventLabel: string;
  eventDate: string;
  unitName: string;
  achievement: Achievement | "";
  achievementLabel: string;
  /** SOAP のうち書いた欄(書いていない欄は含まない)。 */
  soap: { code: "S" | "O" | "A" | "P"; text: string }[];
  freeText: string;
  comment: string;
  performerName: string;
  recordedAt: string;
}

function levelOf(carePlan: fhir4.CarePlan): string {
  return (
    carePlan.category?.flatMap((c) => c.coding ?? []).find((c) => c.system === PATHWAY_LEVEL_SYSTEM)?.code ?? ""
  );
}

function refId(reference: string | undefined): string {
  return reference?.split("/").pop() ?? "";
}

/**
 * 評価の Observation(判定)と、その OAT ユニット・祖先(病日・適用)の CarePlan からカードを組む。
 * ［決定］記載の無い評価(達成状態だけ)は出さない。達成状態の推移はパスタブで読むもので、カルテに
 * 1 件ずつ並べると診療記録が埋もれるため。
 */
export function buildPathwayEvaluationCards(
  observations: fhir4.Observation[],
  carePlans: fhir4.CarePlan[],
): PathwayEvaluationCard[] {
  const byId = new Map(carePlans.filter((cp) => cp.id).map((cp) => [cp.id as string, cp]));
  const cards: PathwayEvaluationCard[] = [];
  for (const observation of observations) {
    const soap: PathwayEvaluationCard["soap"] = [];
    let freeText = "";
    for (const component of observation.component ?? []) {
      const code = component.code?.coding?.find((c) => c.system === EVALUATION_ITEM_SYSTEM)?.code;
      const text = component.valueString?.trim() ?? "";
      if (!text) continue;
      if (code === "S" || code === "O" || code === "A" || code === "P") soap.push({ code, text });
      if (code === FREE_TEXT_CODE) freeText = text;
    }
    const comment = observation.note?.[0]?.text?.trim() ?? "";
    if (soap.length === 0 && !freeText && !comment) continue;

    const unit = byId.get(refId(observation.basedOn?.[0]?.reference));
    if (!unit || levelOf(unit) !== "oat-unit") continue;
    const apply = byId.get(refId(unit.partOf?.[0]?.reference));
    const event = byId.get(refId(unit.partOf?.at(-1)?.reference));
    if (!apply || !event) continue;

    const elapsedDays = event.extension?.find((e) => e.url === PATHWAY_EXT.eventElapsedDays)?.valueInteger ?? 0;
    const pathStep = event.extension?.find((e) => e.url === PATHWAY_EXT.pathStep)?.valueInteger ?? 1;
    const pathStepName = event.extension?.find((e) => e.url === PATHWAY_EXT.pathStepName)?.valueString ?? "";
    const achievement = (observation.valueCodeableConcept?.coding?.find((c) => c.system === ACHIEVEMENT_SYSTEM)?.code ??
      "") as Achievement | "";
    const order = { S: 0, O: 1, A: 2, P: 3 };
    cards.push({
      observation,
      applyId: apply.id ?? "",
      pathwayCode: pathwayCodeOf(apply),
      pathwayTitle: apply.title ?? "",
      eventId: event.id ?? "",
      eventLabel: `病日 ${elapsedDays} ${eventDayStepLabel(elapsedDays, event.title, pathStep, pathStepName)}`,
      eventDate: event.period?.start ?? "",
      unitName: unit.title ?? observation.code?.text ?? "",
      achievement,
      achievementLabel: achievementLabel(achievement),
      soap: soap.sort((a, b) => order[a.code] - order[b.code]),
      freeText,
      comment,
      performerName: observation.performer?.[0]?.display ?? "",
      recordedAt: observation.effectiveDateTime ?? "",
    });
  }
  return cards;
}
