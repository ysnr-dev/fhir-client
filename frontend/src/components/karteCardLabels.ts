import { KARTE_KIND_LABELS, isOrderItem, type KarteTimelineItem } from "../fhir/karteTimeline";
import { adverseEventLabel, adverseEventTreatmentLabel } from "../fhir/adverseEventHelpers";
import { statusLabel } from "../fhir/clinicalNoteHelpers";
import { injectionSeriesLabel, summarizeInjectionServiceRequest } from "../fhir/injectionHelpers";
import { injectionTaskStatusDisplay } from "../fhir/injectionTaskHelpers";
import { departmentOf, orderContextSummary, orderRequester } from "../fhir/orderHeader";
import { summarizeServiceRequest } from "../fhir/prescriptionHelpers";
import { summarizeQuestionnaireResponse } from "../fhir/questionnaireResponseHelpers";
import { regimenOrderLabel } from "../fhir/regimenOrderHelpers";
import { vitalEntryDepartment } from "../fhir/vitalHelpers";
import { clockTime } from "../lib/dates";
import { orderKindDefOf } from "./orderKindRegistry";

// カルテのカードの見出し(表題・進捗・時刻と記録者などのメタ)。タイムラインのカード、
// 変更履歴の版、カルテ印刷で同じ文言を出す。

/** 注射・部門オーダーの進捗(依頼済・受付済・実施済・中止など)。進捗を持たない種別は undefined。 */
export function cardStatus(item: KarteTimelineItem): { code: string; label: string } | undefined {
  if (item.kind === "injection") {
    // 照会中(on-hold)は、回答待ちか処方の変更待ちかを出し分ける。
    return { code: item.status, label: item.inquiryBadge || injectionTaskStatusDisplay(item.status) };
  }
  return isOrderItem(item) ? orderKindDefOf(item).status?.(item) : undefined;
}

export function cardTitle(item: KarteTimelineItem): string {
  if (item.kind === "note") return item.note.title ?? "";
  // パス評価はどのアウトカムの評価かが見出し(パス名・病日は本文の先頭に出す)。
  if (item.kind === "pathway-evaluation") return item.evaluation.unitName;
  if (item.kind === "adverse-event") return adverseEventLabel(item.record);
  // バイタルは種別バッジだけで内容が分かるので、タイトルは持たない。
  if (item.kind === "vital") return "";
  if (item.kind === "prescription") {
    const summary = summarizeServiceRequest(item.serviceRequest);
    return [summary.settingDisplay, summary.categoryDisplay].filter(Boolean).join(" | ");
  }
  // 注射も処方と同じく区分をタイトルにする(用法種別は本文の用法行に出る)。
  if (item.kind === "injection") {
    const summary = summarizeInjectionServiceRequest(item.serviceRequest);
    return [summary.settingDisplay, summary.categoryDisplay].filter(Boolean).join(" | ");
  }
  if (isOrderItem(item)) return orderKindDefOf(item).title(item);
  return item.label;
}

export function cardMeta(item: KarteTimelineItem): string {
  const time = clockTime(item.dateTime);
  // 記録系のカードも、オーダーの「依頼科 | 依頼医師」と同じ並びで診療科・記入者を出す。
  if (item.kind === "note") {
    return [
      time,
      statusLabel(item.note.status),
      departmentOf(item.note).departmentName,
      item.note.author?.[0]?.display,
    ]
      .filter(Boolean)
      .join(" | ");
  }
  if (item.kind === "qr") {
    const summary = summarizeQuestionnaireResponse(item.response);
    return [time, summary.statusLabel, departmentOf(item.response).departmentName, summary.authorName]
      .filter(Boolean)
      .join(" | ");
  }
  // バイタルは測定時刻と診療科(誰が測ったかは Observation に持たせていない)。
  if (item.kind === "vital") {
    return [time, vitalEntryDepartment(item.entry).departmentName].filter(Boolean).join(" | ");
  }
  if (item.kind === "pathway-evaluation") {
    return [
      time,
      item.evaluation.achievementLabel,
      departmentOf(item.evaluation.observation).departmentName,
      item.evaluation.performerName,
    ]
      .filter(Boolean)
      .join(" | ");
  }
  // 有害事象は日付だけで時刻を持たない。原因の治療と記録者を出す。
  if (item.kind === "adverse-event") {
    return [adverseEventTreatmentLabel(item.record), item.record.performer?.display].filter(Boolean).join(" | ");
  }
  const requesterSummary = orderContextSummary(orderRequester(item.serviceRequest));
  if (isOrderItem(item)) {
    return [...(orderKindDefOf(item).metaLead?.(item) ?? []), requesterSummary].filter(Boolean).join(" | ");
  }
  // 連日オーダーの注射は「何日目」かを添える(単日のオーダーでは出ない)。レジメンから
  // 出た注射・処方は「レジメン名 C1 Day8」を添え、種別バッジが「化学療法」になるぶん
  // どちらのオーダーかもここに出す。
  if (item.kind === "injection") {
    const regimen = regimenOrderLabel(item.serviceRequest);
    return [
      regimen,
      regimen ? KARTE_KIND_LABELS[item.kind] : "",
      injectionSeriesLabel(item.serviceRequest),
      requesterSummary,
    ]
      .filter(Boolean)
      .join(" | ");
  }
  if (item.kind === "prescription") {
    const regimen = regimenOrderLabel(item.serviceRequest);
    return [regimen, regimen ? KARTE_KIND_LABELS[item.kind] : "", requesterSummary]
      .filter(Boolean)
      .join(" | ");
  }
  // 処方・注射は診療記録の作成者と同じ位置に、依頼科・依頼医師を出す。登録日時
  // (authoredOn)はカードには出さない(カードの日はオーダー開始日で、いつ登録したかは
  // 詳細の「登録日時」で見る)。
  return requesterSummary;
}
