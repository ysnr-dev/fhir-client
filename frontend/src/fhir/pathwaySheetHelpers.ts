import type { PathwayApplicationRecord, PathwayEventRecord } from "./pathwayApplyHelpers";
import { achievementLabel, resultValueLabel, type Achievement, type PathwayEvaluationState } from "./pathwayEvaluationHelpers";
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
  /** 属するアウトカム(unit 行の key)。開閉の単位になる。 */
  unitKey: string;
  label: string;
  /** 重要アウトカム(unit 行だけ)。 */
  critical: boolean;
  /** タスク分類(大)の表示(task 行だけ)。 */
  categoryLabel: string;
  /** ぶら下がる観察項目・タスクの行数(unit 行だけ)。 */
  childCount: number;
  /**
   * 載っている病日すべてで評価が入っているか(unit 行だけ)。シートは評価済みの
   * アウトカムを畳んで開く。
   */
  evaluated: boolean;
  /** 病日 → セル。その病日に載らない行は undefined。 */
  cells: Map<string, SheetUnitCell | SheetAssessmentCell | SheetTaskCell>;
}

export interface SheetUnitCell {
  unitId: string;
  unplanned: boolean;
  /** 評価済みなら達成状態(1 達成 / 2 未達成 / 3 未評価)。 */
  achievement: Achievement | "";
  achievementLabel: string;
}

export interface SheetAssessmentCell {
  assessmentId: string;
  /** 記録済みの実績値の表示。無ければ空。 */
  value: string;
}

export interface PathwaySheet {
  days: SheetDay[];
  rows: SheetRow[];
}

/**
 * 同じ名前のアウトカムが複数の病日にあれば 1 行にまとめる(定義の概要表と同じまとめ方)。
 * 観察項目とタスクはアウトカムの下に、名前でまとめて並べる。行の並びは初出の病日順。
 */
export function buildPathwaySheet(
  application: PathwayApplicationRecord,
  evaluation: PathwayEvaluationState | null = null,
): PathwaySheet {
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
          row: {
            key: unitKey,
            kind: "unit",
            unitKey,
            label: unit.name,
            critical: false,
            categoryLabel: "",
            childCount: 0,
            evaluated: false,
            cells: new Map(),
          },
          children: new Map(),
        };
        unitRows.set(unitKey, group);
      }
      group.row.critical = group.row.critical || unit.critical;
      const achievement = evaluation?.units.get(unit.id)?.achievement ?? "";
      group.row.cells.set(event.id, {
        unitId: unit.id,
        unplanned: unit.unplanned,
        achievement,
        achievementLabel: achievementLabel(achievement),
      });

      for (const assessment of unit.assessments) {
        // 「観察項目なし」で包んだだけの観察項目は行にしない(タスクだけを出す)。
        if (assessment.name) {
          const key = `${unitKey}/a:${assessment.name}`;
          let row = group.children.get(key);
          if (!row) {
            row = {
              key,
              kind: "assessment",
              unitKey,
              label: assessment.name,
              critical: false,
              categoryLabel: "",
              childCount: 0,
              evaluated: false,
              cells: new Map(),
            };
            group.children.set(key, row);
          }
          row.cells.set(event.id, {
            assessmentId: assessment.id,
            value: resultValueLabel(evaluation?.results.get(assessment.id)),
          });
        }
        for (const task of assessment.tasks) {
          const key = `${unitKey}/t:${task.categoryLv1}:${task.name}`;
          let row = group.children.get(key);
          if (!row) {
            row = {
              key,
              kind: "task",
              unitKey,
              label: task.name,
              critical: false,
              categoryLabel: displayOfOption(TASK_CATEGORY_LV1_OPTIONS, task.categoryLv1),
              childCount: 0,
              evaluated: false,
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
    const cells = [...group.row.cells.values()] as SheetUnitCell[];
    group.row.childCount = group.children.size;
    // 載っている病日が全部評価済みのときだけ「評価済み」とする(1 日でも残っていれば開く)。
    group.row.evaluated = cells.length > 0 && cells.every((cell) => Boolean(cell.achievement));
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
