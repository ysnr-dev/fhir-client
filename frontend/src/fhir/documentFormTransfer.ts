// 様式文書の「転記」モーダルに出す行。カルテのカードと同じ単位(KarteTimelineItem)・病名・検査結果を、
// 項目へ追記する文字列(複数行)にする。
import { cardTitle } from "../components/karteCardLabels";
import { problemLabel, summarizeCondition } from "./conditionHelpers";
import type { TransferKind } from "./documentFormLayout";
import { groupInjectionByRp, injectionUsageSummary } from "./injectionHelpers";
import {
  KARTE_KIND_LABELS,
  isKarteRecordItem,
  isOrderItem,
  karteDayLabel,
  type KarteTimelineItem,
} from "./karteTimeline";
import { observationLineDisplay } from "./labResultHelpers";
import { orderTransferLines } from "./orderTransferLines";
import { prescriptionRpLines } from "./populateContext";

export interface TransferRow {
  id: string;
  /** 一覧に出す 1 行。 */
  label: string;
  /** 転記する文字列(行ごと)。 */
  lines: string[];
}

function slashDay(day: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.replaceAll("-", "/") : karteDayLabel(day);
}

function injectionRpLines(medicationRequests: fhir4.MedicationRequest[]): string[] {
  const lines: string[] = [];
  for (const rp of groupInjectionByRp(medicationRequests)) {
    lines.push(`Rp${rp.rpNumber}`);
    for (const medicine of rp.medicines) {
      const dose = medicine.dose !== undefined ? ` ${medicine.dose}${medicine.unit ?? ""}` : "";
      const comment = medicine.comment ? `（${medicine.comment}）` : "";
      lines.push(`　${medicine.name}${dose}${comment}`);
    }
    const usage = injectionUsageSummary(rp);
    const usageComment = rp.usageComment ? `（${rp.usageComment}）` : "";
    if (usage || usageComment) lines.push(`　用法: ${usage}${usageComment}`);
  }
  return lines;
}

/** オーダー(カード)を転記の種別で振り分ける。 */
export function transferKindOfItem(item: KarteTimelineItem): TransferKind | null {
  if (item.kind === "prescription") return "prescription";
  if (item.kind === "injection") return "injection";
  return isKarteRecordItem(item) ? null : "order";
}

export function transferRowOfItem(day: string, item: KarteTimelineItem): TransferRow {
  const date = slashDay(day);
  const title = cardTitle(item);
  const kindLabel = KARTE_KIND_LABELS[item.kind];
  if (item.kind === "prescription") {
    return {
      id: item.id,
      label: `${date} ${kindLabel} ${title}`.trim(),
      lines: [`【処方 ${date}】`, ...prescriptionRpLines(item.medicationRequests)],
    };
  }
  if (item.kind === "injection") {
    return {
      id: item.id,
      label: `${date} ${kindLabel} ${title}`.trim(),
      lines: [`【注射 ${date}】`, ...injectionRpLines(item.medicationRequests)],
    };
  }
  const label = [date, kindLabel, title].filter(Boolean).join(" ");
  if (!isOrderItem(item)) return { id: item.id, label, lines: [label] };
  // 部門オーダーは処方・注射と同じく見出しの下に内容(項目・検体・指示)を字下げして並べる。
  const header = `【${kindLabel} ${date}】${title}`.trim();
  return { id: item.id, label, lines: [header, ...orderTransferLines(item)] };
}

export function transferRowsOfConditions(conditions: fhir4.Condition[]): TransferRow[] {
  return conditions
    .map((condition) => {
      const summary = summarizeCondition(condition);
      if (!summary.name) return null;
      const period = summary.startDate
        ? `(${summary.startDate.replaceAll("-", "/")}〜${summary.endDate ? summary.endDate.replaceAll("-", "/") : ""})`
        : "";
      const outcome = summary.outcomeDisplay ? ` ${summary.outcomeDisplay}` : "";
      const line = `${problemLabel(condition)}${period}${outcome}`;
      return { id: summary.id || line, label: line, lines: [line] };
    })
    .filter((row): row is TransferRow => row !== null);
}

export function transferRowsOfLabResults(observations: fhir4.Observation[]): TransferRow[] {
  return observations
    .map((obs) => {
      const line = observationLineDisplay(obs);
      if (!line.name) return null;
      const day = (obs.effectiveDateTime ?? obs.issued ?? "").slice(0, 10).replaceAll("-", "/");
      const value = [line.value, line.unit].filter(Boolean).join(" ");
      const flag = line.interpretation ? ` (${line.interpretation})` : "";
      const text = `${day ? `${day} ` : ""}${line.name}: ${value}${flag}`;
      return { id: line.id || text, label: text, lines: [text] };
    })
    .filter((row): row is TransferRow => row !== null);
}
