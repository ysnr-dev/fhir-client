import { addDays, dateTimeLabel } from "../lib/dates";
import type { FlowsheetMarkRow } from "./flowsheetEventHelpers";
import { daysInsertedLabel, lineDrainLabel, removalReasonLabel, type LineDrainRecord } from "./lineDrainHelpers";

/**
 * 経過表の「留置物」の欄(docs/line-drain-design.md §4.7)。1 留置 = 1 行で、挿入から抜去までを
 * バーで出す。留置中は表示範囲の翌日 0 時まで伸ばして右端まで描く。
 */
export function buildLineDrainRows(records: LineDrainRecord[], rangeEnd: string, today: string): FlowsheetMarkRow[] {
  return records
    .filter((r) => r.status !== "entered-in-error" && r.insertedAt)
    .sort((a, b) => (a.insertedAt < b.insertedAt ? -1 : 1))
    .map((record) => {
      const detail = [
        record.deviceLabel,
        record.performer?.display,
        daysInsertedLabel(record, today),
        record.removalReason ? removalReasonLabel(record.removalReason) : "",
      ]
        .filter(Boolean)
        .join(" / ");
      return {
        key: record.id,
        label: record.typeName,
        title: `${lineDrainLabel(record)} ${detail}`.trim(),
        marks: [
          {
            at: record.insertedAt,
            end: record.removedAt || `${addDays(rangeEnd, 1)}T00:00`,
            kind: record.status === "completed" ? "performed" : "planned",
            groupId: record.id,
            title: `${lineDrainLabel(record)} ${dateTimeLabel(record.insertedAt)}〜${
              record.removedAt ? dateTimeLabel(record.removedAt) : ""
            }`,
            event: {
              at: record.insertedAt,
              kind: "device",
              label: record.typeName,
              name: lineDrainLabel(record),
              detail,
            },
          },
        ],
      };
    });
}
