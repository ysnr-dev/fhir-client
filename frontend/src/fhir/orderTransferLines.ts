// 部門オーダーの内容を、様式文書の項目に追記する文字列(行ごと)にする。カルテのカードの本文と
// 同じ組み立てで、見出し(GP・検体)の下に項目を字下げして並べる。実施記録は依頼した内容では
// ないので含めない。
//
// 対応表は Record<OrderKind, …> なので、種別を足したときの書き忘れは型エラーになる。
import { summarizeConsultOrder } from "./consultOrderHelpers";
import {
  endoscopyOrderItems,
  entryLabel as endoscopyEntryLabel,
  orderEntries as endoscopyOrderEntries,
} from "./endoscopyOrderHelpers";
import type { KarteOrderItem } from "./karteTimeline";
import {
  groupBySpecimen,
  labOrderComment,
  labOrderItems,
  memberSummary,
  specimenGroupLabel,
} from "./labOrderHelpers";
import { summarizeMealOrder } from "./mealOrderHelpers";
import { summarizeMedicationGuidanceOrder } from "./medicationGuidanceOrderHelpers";
import {
  microOrderComment,
  microOrderContents,
  organismSummary,
  specimenLabel as microSpecimenLabel,
} from "./microOrderHelpers";
import { summarizeNutritionGuidanceOrder } from "./nutritionGuidanceOrderHelpers";
import type { OrderKind } from "./orderKinds";
import {
  organLabel,
  pathoOrderClinicalInfo,
  pathoOrderComment,
  pathoOrderSpecimens,
  specimenTypeDisplay,
} from "./pathoOrderHelpers";
import {
  entryLabel as physioEntryLabel,
  orderEntries as physioOrderEntries,
  physioOrderItems,
} from "./physioOrderHelpers";
import { schemaAnnotatedLines } from "./questionnaireResponseHelpers";
import { summarizeRadiotherapyOrder } from "./radiotherapyOrderHelpers";
import {
  bodySiteLabel,
  entryLabel as radEntryLabel,
  orderEntries as radOrderEntries,
  radOrderItems,
} from "./radOrderHelpers";
import { summarizeRehabOrder } from "./rehabOrderHelpers";
import {
  summarizeSurgeryOrder,
  surgeryAnesthesiaMethodDisplay,
  surgeryApproachDisplay,
  surgeryBodySiteLabel,
  surgeryOrderItems,
} from "./surgeryOrderHelpers";
import { summarizeTeamRequest } from "./teamRequestHelpers";
import {
  productLabel,
  summarizeTransfusionOrder,
  transfusionOrderComment,
  transfusionOrderProducts,
} from "./transfusionOrderHelpers";
import {
  entryLabel as treatmentEntryLabel,
  orderEntries as treatmentOrderEntries,
  treatmentOrderItems,
} from "./treatmentOrderHelpers";

type OrderItem<K extends OrderKind> = Extract<KarteOrderItem, { kind: K }>;

const INDENT = "　";

function indent(line: string): string {
  return `${INDENT}${line}`;
}

/** 「見出し: 本文」の行。本文が複数行なら 2 行目以降は見出しのぶんだけ空ける。 */
function labeled(label: string, text: string): string[] {
  const lines = schemaAnnotatedLines(text);
  if (lines.length === 0) return [];
  return lines.map((line, index) => indent(index === 0 ? `${label}: ${line}` : `${INDENT}${line}`));
}

function noteLines(text: string | undefined): string[] {
  return text ? text.split("\n").map(indent) : [];
}

/** GP(撮影・検査・処置の項目かセット)単位の並び。放射線・生理・内視鏡・処置で同じ形。 */
function groupedEntryLines<Item extends { name: string }>(
  entries: { item: Item; members: Item[] }[],
  label: (entry: { item: Item; members: Item[] }) => string,
  memberLine: (member: Item) => string,
  details: (item: Item) => string[] = () => [],
): string[] {
  const lines: string[] = [];
  entries.forEach((entry, index) => {
    lines.push(`GP${index + 1} ${label(entry)}`);
    const members = entry.members.length > 0 ? entry.members : [entry.item];
    for (const member of members) lines.push(indent(memberLine(member)));
    lines.push(...details(entry.item));
  });
  return lines;
}

type ExamDetailItem = { reasonName: string; purpose: string; remarks: string };

/** 放射線・生理・内視鏡の GP 単位の記入(依頼病名・検査目的・特別指示)。 */
function examDetailLines(item: ExamDetailItem): string[] {
  return [
    ...labeled("依頼病名", item.reasonName),
    ...labeled("検査目的", item.purpose),
    ...labeled("特別指示", item.remarks),
  ];
}

export const ORDER_TRANSFER_LINES: { [K in OrderKind]: (item: OrderItem<K>) => string[] } = {
  "lab-order": ({ serviceRequest, itemRequests }) => {
    const lines: string[] = [];
    groupBySpecimen(labOrderItems(serviceRequest, itemRequests)).forEach((group, index) => {
      lines.push(`GP${index + 1} ${specimenGroupLabel(group)}`);
      for (const entry of group.entries) {
        const members = entry.members.length > 0 ? `（${memberSummary(entry.members)}）` : "";
        lines.push(indent(`${entry.item.name}${members}`));
      }
    });
    return [...lines, ...noteLines(labOrderComment(serviceRequest))];
  },
  "micro-order": ({ serviceRequest, itemRequests }) => {
    const { specimen, items } = microOrderContents(itemRequests);
    if (items.length === 0) return [];
    return [
      `GP1 ${microSpecimenLabel(specimen)}`,
      ...items.map((item) => indent(item.name)),
      ...labeled("目的菌", organismSummary(specimen.organisms)),
      ...labeled("疑い病名", specimen.reasonName),
      ...noteLines(microOrderComment(serviceRequest)),
    ];
  },
  "patho-order": ({ serviceRequest, itemRequests }) => {
    const specimens = pathoOrderSpecimens(itemRequests).map((specimen, index) => {
      const detail = [specimen.typeName || specimenTypeDisplay(specimen.typeCode), specimen.methodName]
        .filter(Boolean)
        .join("・");
      return [`${index + 1}. ${organLabel(specimen) || "臓器未設定"}`, detail && `（${detail}）`, specimen.note]
        .filter(Boolean)
        .join(" ");
    });
    return [
      ...specimens,
      ...labeled("臨床経過", pathoOrderClinicalInfo(serviceRequest)),
      ...noteLines(pathoOrderComment(serviceRequest)),
    ];
  },
  "rad-order": ({ serviceRequest, itemRequests }) =>
    groupedEntryLines(
      radOrderEntries(radOrderItems(serviceRequest, itemRequests)),
      radEntryLabel,
      (shot) => [shot.name, bodySiteLabel(shot)].filter(Boolean).join(" "),
      examDetailLines,
    ),
  "physio-order": ({ serviceRequest, itemRequests }) =>
    groupedEntryLines(
      physioOrderEntries(physioOrderItems(serviceRequest, itemRequests)),
      physioEntryLabel,
      (exam) => exam.name,
      examDetailLines,
    ),
  "endoscopy-order": ({ serviceRequest, itemRequests }) =>
    groupedEntryLines(
      endoscopyOrderEntries(endoscopyOrderItems(serviceRequest, itemRequests)),
      endoscopyEntryLabel,
      (exam) => exam.name,
      examDetailLines,
    ),
  "treatment-order": ({ serviceRequest, itemRequests }) => {
    // 処置の見出しは項目名そのものなので、セットのときだけ構成する処置を並べる。
    const lines: string[] = [];
    treatmentOrderEntries(treatmentOrderItems(serviceRequest, itemRequests)).forEach((entry, index) => {
      lines.push(`GP${index + 1} ${treatmentEntryLabel(entry)}`);
      for (const member of entry.members) lines.push(indent(member.name));
    });
    return lines;
  },
  "surgery-order": ({ serviceRequest, itemRequests }) => {
    const summary = summarizeSurgeryOrder(serviceRequest);
    const items = surgeryOrderItems(serviceRequest, itemRequests).map((item, index) =>
      [
        `${index === 0 ? "主" : "副"} ${item.name}`,
        surgeryBodySiteLabel(item),
        item.approach && surgeryApproachDisplay(item.approach),
      ]
        .filter(Boolean)
        .join(" "),
    );
    const surgeon = summary.staff.find((line) => line.role === "surgeon");
    const anesthesia = summary.anesthesiaMethods.map(surgeryAnesthesiaMethodDisplay).join("・");
    return [
      ...items,
      ...(surgeon ? [indent(`執刀: ${surgeon.practitionerName}`)] : []),
      ...(anesthesia ? [indent(`麻酔: ${anesthesia}`)] : []),
    ];
  },
  "meal-order": ({ serviceRequest }) => {
    const summary = summarizeMealOrder(serviceRequest);
    if (!summary.dietName) return [];
    return [
      summary.dietName,
      ...(summary.stapleName ? [indent(`主食: ${summary.stapleName}`)] : []),
      ...summary.stapleLines.map((line) => indent(`${line.timingDisplay}: ${line.text}`)),
      ...(summary.sideDishFormName ? [indent(`副食形態: ${summary.sideDishFormName}`)] : []),
      ...(summary.saltLimitLabel ? [indent(`塩分制限: ${summary.saltLimitLabel}`)] : []),
      ...(summary.allergyLabel ? [indent(`アレルギー: ${summary.allergyLabel}`)] : []),
      ...noteLines(summary.comment),
    ];
  },
  "transfusion-order": ({ serviceRequest, itemRequests }) => {
    const summary = summarizeTransfusionOrder(serviceRequest);
    return [
      ...(summary.bloodTypeDisplay ? [`血液型: ${summary.bloodTypeDisplay}`] : []),
      ...transfusionOrderProducts(itemRequests).map((product, index) =>
        [`${index + 1}. ${productLabel(product)}`, product.note].filter(Boolean).join(" "),
      ),
      ...noteLines(transfusionOrderComment(serviceRequest)),
    ];
  },
  "rehab-order": ({ serviceRequest }) => {
    const summary = summarizeRehabOrder(serviceRequest);
    if (!summary.diseaseCategoryDisplay) return [];
    return [
      [summary.diseaseCategoryDisplay, summary.therapyTypesLabel].filter(Boolean).join(" "),
      indent([summary.periodLabel, summary.scheduleLabel].filter(Boolean).join(" / ")),
      ...(summary.targetDisease ? [indent(`対象: ${summary.targetDisease}`)] : []),
      ...noteLines(summary.comment),
    ];
  },
  "radiotherapy-order": ({ serviceRequest }) => {
    const summary = summarizeRadiotherapyOrder(serviceRequest);
    const ended = summary.endedOn
      ? [[serviceRequest.status === "revoked" ? "中止" : "終了", summary.endedOn, summary.terminationReason]]
      : [];
    const suspended = summary.suspendedOn ? [["休止", summary.suspendedOn, summary.suspensionReason]] : [];
    return [
      [summary.siteLabel || "(部位の記載なし)", summary.techniqueLabel, summary.concurrentTherapyDisplay]
        .filter(Boolean)
        .join(" "),
      ...summary.volumes
        .filter((volume) => volume.doseLabel)
        .map((volume) => indent(`${volume.label} ${volume.doseLabel}`)),
      ...[...suspended, ...ended].map((parts) => indent(parts.filter(Boolean).join(" "))),
      ...noteLines(summary.comment),
    ];
  },
  "nutrition-guidance-order": ({ serviceRequest }) => {
    const summary = summarizeNutritionGuidanceOrder(serviceRequest);
    if (!summary.formatDisplay) return [];
    const target = [summary.targetDisease, summary.targetDiet].filter(Boolean).join(" / ");
    return [
      summary.formatDisplay,
      indent(summary.periodLabel),
      ...(target ? [indent(`対象: ${target}`)] : []),
      ...noteLines(summary.purpose),
      ...noteLines(summary.comment),
    ];
  },
  "medication-guidance-order": ({ serviceRequest }) => {
    const summary = summarizeMedicationGuidanceOrder(serviceRequest);
    if (!summary.kindDisplay) return [];
    return [
      summary.kindDisplay,
      indent(summary.periodLabel),
      ...(summary.conditionsLabel ? [indent(`条件: ${summary.conditionsLabel}`)] : []),
      ...(summary.targetDrugs ? [indent(`対象薬剤: ${summary.targetDrugs}`)] : []),
      ...noteLines(summary.purpose),
      ...noteLines(summary.comment),
    ];
  },
  "consult-order": ({ serviceRequest }) => {
    const summary = summarizeConsultOrder(serviceRequest);
    return [
      [summary.requestTypeDisplay, summary.urgent && "至急"].filter(Boolean).join(" "),
      ...noteLines(summary.purpose),
      ...noteLines(summary.comment),
    ];
  },
  "team-request": ({ serviceRequest }) => {
    const summary = summarizeTeamRequest(serviceRequest);
    return [
      [summary.teamKindDisplay, summary.urgent && "至急"].filter(Boolean).join(" "),
      ...noteLines(summary.purpose),
      ...noteLines(summary.comment),
    ];
  },
};

/** 部門オーダーの内容(行ごと)。種別と項目の型の対応は kind で決まるので、ここで 1 回だけ型を緩める。 */
export function orderTransferLines(item: KarteOrderItem): string[] {
  return (ORDER_TRANSFER_LINES[item.kind] as (item: KarteOrderItem) => string[])(item);
}
