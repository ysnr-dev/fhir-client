import type { PathwayApplicationRecord, PathwayEventRecord } from "./pathwayApplyHelpers";
import { TASK_CATEGORY_LV1_OPTIONS, displayOfOption } from "./pathwayHelpers";

// パスシート(病日 × OAT ユニット)の行と列。適用 1 件の木(parsePathwayApplication)を、
// 紙のパスシートと同じ「行 = アウトカム・観察項目・タスク、列 = 病日」に組み直す。
// React に依存しない。設計は docs/clinical-pathway-design.md §6。

export interface SheetDay {
  eventId: string;
  elapsedDays: number;
  title: string;
  date: string;
}

export interface SheetTaskCell {
  procedureId: string;
  done: boolean;
  /** 雛形から出したオーダー(ServiceRequest)の id。 */
  orderIds: string[];
}

export interface SheetRow {
  key: string;
  kind: "unit" | "assessment" | "task";
  label: string;
  /** 重要アウトカム(unit 行だけ)。 */
  critical: boolean;
  /** タスク分類(大)の表示(task 行だけ)。 */
  categoryLabel: string;
  /** 病日 → セル。その病日に載らない行は undefined。 */
  cells: Map<string, SheetUnitCell | SheetAssessmentCell | SheetTaskCell>;
}

export interface SheetUnitCell {
  unitId: string;
  unplanned: boolean;
}

export interface SheetAssessmentCell {
  assessmentId: string;
}

export interface PathwaySheet {
  days: SheetDay[];
  rows: SheetRow[];
}

/**
 * 同じ名前のアウトカムが複数の病日にあれば 1 行にまとめる(定義の概要表と同じまとめ方)。
 * 観察項目とタスクはアウトカムの下に、名前でまとめて並べる。行の並びは初出の病日順。
 */
export function buildPathwaySheet(application: PathwayApplicationRecord): PathwaySheet {
  const days: SheetDay[] = application.events.map((event) => ({
    eventId: event.id,
    elapsedDays: event.elapsedDays,
    title: event.title,
    date: event.date,
  }));

  const unitRows = new Map<string, { row: SheetRow; children: Map<string, SheetRow> }>();
  for (const event of application.events) {
    for (const unit of event.units) {
      const unitKey = `u:${unit.name}`;
      let group = unitRows.get(unitKey);
      if (!group) {
        group = {
          row: { key: unitKey, kind: "unit", label: unit.name, critical: false, categoryLabel: "", cells: new Map() },
          children: new Map(),
        };
        unitRows.set(unitKey, group);
      }
      group.row.critical = group.row.critical || unit.critical;
      group.row.cells.set(event.id, { unitId: unit.id, unplanned: unit.unplanned });

      for (const assessment of unit.assessments) {
        // 「観察項目なし」で包んだだけの観察項目は行にしない(タスクだけを出す)。
        if (assessment.name) {
          const key = `${unitKey}/a:${assessment.name}`;
          let row = group.children.get(key);
          if (!row) {
            row = { key, kind: "assessment", label: assessment.name, critical: false, categoryLabel: "", cells: new Map() };
            group.children.set(key, row);
          }
          row.cells.set(event.id, { assessmentId: assessment.id });
        }
        for (const task of assessment.tasks) {
          const key = `${unitKey}/t:${task.categoryLv1}:${task.name}`;
          let row = group.children.get(key);
          if (!row) {
            row = {
              key,
              kind: "task",
              label: task.name,
              critical: false,
              categoryLabel: displayOfOption(TASK_CATEGORY_LV1_OPTIONS, task.categoryLv1),
              cells: new Map(),
            };
            group.children.set(key, row);
          }
          row.cells.set(event.id, { procedureId: task.id, done: task.done, orderIds: task.orderIds });
        }
      }
    }
  }

  const rows: SheetRow[] = [];
  for (const group of unitRows.values()) {
    rows.push(group.row);
    // 観察項目を先に、タスクを後に(紙のパスシートの並び)。
    const children = [...group.children.values()];
    rows.push(...children.filter((r) => r.kind === "assessment"), ...children.filter((r) => r.kind === "task"));
  }
  return { days, rows };
}

/** 今日が何病日目か(パスの病日に無ければ null)。 */
export function todayEventOf(events: PathwayEventRecord[], today: string): PathwayEventRecord | null {
  return events.find((event) => event.date === today) ?? null;
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: "下書き",
  active: "依頼済",
  "on-hold": "保留",
  revoked: "中止",
  completed: "実施済",
  "entered-in-error": "誤登録",
};

export function orderStatusLabel(status: string | undefined): string {
  return status ? (ORDER_STATUS_LABELS[status] ?? status) : "";
}

export function pathwayStatusLabel(status: string): string {
  if (status === "active") return "進行中";
  if (status === "completed") return "終了";
  if (status === "revoked") return "中止";
  return status;
}
