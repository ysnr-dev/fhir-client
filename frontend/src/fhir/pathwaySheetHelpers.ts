import type { PathwayApplicationRecord, PathwayEventRecord } from "./pathwayApplyHelpers";
import { achievementLabel, resultValueLabel, type Achievement, type PathwayEvaluationState } from "./pathwayEvaluationHelpers";
import { TASK_CATEGORY_LV1_OPTIONS, displayOfOption } from "./pathwayHelpers";
import { isNursingServiceRequest } from "./nursingOrderHelpers";
import type { OrderProgress } from "./orderProgressHelpers";

// パスシート(病日 × OAT ユニット)の行と列。適用 1 件の木(parsePathwayApplication)を、
// 紙のパスシートと同じ「行 = アウトカム・観察項目・タスク、列 = 病日」に組み直す。
// React に依存しない。設計は docs/clinical-pathway-design.md §6。

export interface SheetDay {
  eventId: string;
  elapsedDays: number;
  /** 同じ病日を分けたときのステップ。分けていなければ 1。 */
  pathStep: number;
  pathStepName: string;
  title: string;
  date: string;
}

/** シートの見出しで病日をまとめる単位(同じ病日のステップを 1 つにする)。 */
export interface SheetDayGroup {
  elapsedDays: number;
  title: string;
  date: string;
  days: SheetDay[];
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
   * 適正値(assessment 行だけ)。載っている病日すべてで同じときだけ入る。日によって違えば空で、
   * 各セルの properValue を見る。
   */
  properValue: string;
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
  /** その病日の適正値。無ければ空。 */
  properValue: string;
  /** 記録済みの実績値の表示。無ければ空。 */
  value: string;
}

export interface PathwaySheet {
  days: SheetDay[];
  /** 病日ごとのまとまり。どれかの病日を分けていれば、見出しにステップの段を出す。 */
  dayGroups: SheetDayGroup[];
  split: boolean;
  rows: SheetRow[];
}

/**
 * ［決定］行は識別子でまとめる(定義の概要表と同じまとめ方)。同じ unit_key のアウトカムが複数の
 * 病日にあれば 1 行(= 日をまたぐアウトカム)、その下の観察項目・タスクも識別子で 1 行にする。
 * 名前が同じでも識別子が違えば別の行。行の見出しは初出の病日の名前、並びは初出の病日順。
 */
export function buildPathwaySheet(
  application: PathwayApplicationRecord,
  evaluation: PathwayEvaluationState | null = null,
): PathwaySheet {
  const days: SheetDay[] = application.events.map((event) => ({
    eventId: event.id,
    elapsedDays: event.elapsedDays,
    pathStep: event.pathStep,
    pathStepName: event.pathStepName,
    title: event.title,
    date: event.date,
  }));
  const dayGroups: SheetDayGroup[] = [];
  for (const day of days) {
    const last = dayGroups[dayGroups.length - 1];
    if (last && last.elapsedDays === day.elapsedDays) last.days.push(day);
    else dayGroups.push({ elapsedDays: day.elapsedDays, title: day.title, date: day.date, days: [day] });
  }

  const unitRows = new Map<string, { row: SheetRow; children: Map<string, SheetRow> }>();
  for (const event of application.events) {
    for (const unit of event.units) {
      const unitKey = `u:${unit.unitKey}`;
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
            properValue: "",
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
          const key = `${unitKey}/a:${assessment.assessmentKey}`;
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
              properValue: "",
              evaluated: false,
              cells: new Map(),
            };
            group.children.set(key, row);
          }
          row.cells.set(event.id, {
            assessmentId: assessment.id,
            properValue: assessment.properValue,
            value: resultValueLabel(evaluation?.results.get(assessment.id)),
          });
        }
        for (const task of assessment.tasks) {
          const key = `${unitKey}/t:${task.taskKey}`;
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
              properValue: "",
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
    for (const row of children) {
      if (row.kind !== "assessment") continue;
      const values = new Set([...row.cells.values()].map((cell) => (cell as SheetAssessmentCell).properValue));
      row.properValue = values.size === 1 ? [...values][0] : "";
    }
    rows.push(...children.filter((r) => r.kind === "assessment"), ...children.filter((r) => r.kind === "task"));
  }
  return { days, dayGroups, split: dayGroups.some((g) => g.days.length > 1), rows };
}

// ---- タスクの実施 ----

/** 看護指示の実施記録を、指示の id → 記録のある日付(YYYY-MM-DD)にまとめる。 */
export function nursingPerformDates(
  byOrderId: Map<string, { at: string }[]> | undefined,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [orderId, rows] of byOrderId ?? []) {
    map.set(orderId, new Set(rows.map((row) => row.at.slice(0, 10))));
  }
  return map;
}

/** タスクが看護指示を結んでいるか(実施はタスクの Procedure ではなく、指示の実施記録で表す)。 */
export function isNursingLinkedTask(
  task: { orderIds: string[] },
  orders: Map<string, fhir4.ServiceRequest> | undefined,
): boolean {
  return task.orderIds.some((id) => {
    const sr = orders?.get(id);
    return Boolean(sr && isNursingServiceRequest(sr));
  });
}

/**
 * その病日にタスクを実施したか。［決定］看護指示を結んだタスクは、その日の実施記録があれば実施とみなす
 * (続く病日にまたがる 1 件の指示を日ごとに記録するため)。その他のオーダーを結んだタスクは、オーダーが
 * 実施済みになれば実施(部門・病棟が実施を記録すると進捗の Task が completed になる。orderProgress)。
 * どれでもなければタスクの Procedure の状態。
 * パスシートのセル・評価パネル・日めくりのチェック・進み具合の集計が同じ判定を使う。
 */
export function pathwayTaskPerformedOn(
  task: { orderIds: string[]; done: boolean },
  date: string,
  orders: Map<string, fhir4.ServiceRequest> | undefined,
  performDates: Map<string, Set<string>>,
  orderProgress: Map<string, OrderProgress> | undefined,
): boolean {
  if (task.done) return true;
  return task.orderIds.some((id) => {
    const sr = orders?.get(id);
    if (!sr) return false;
    if (isNursingServiceRequest(sr)) return Boolean(performDates.get(id)?.has(date));
    return orderProgress?.get(id)?.completed ?? sr.status === "completed";
  });
}

/**
 * タスクの実施がオーダーの側で決まるか(看護指示を結んでいる、またはオーダーが実施済み)。
 * そのときは評価パネル・日めくりのチェックを押せなくする(実施は実施入力・部門で記録する)。
 */
export function isOrderDrivenTask(
  task: { orderIds: string[] },
  orders: Map<string, fhir4.ServiceRequest> | undefined,
  orderProgress: Map<string, OrderProgress> | undefined,
): boolean {
  return task.orderIds.some((id) => {
    const sr = orders?.get(id);
    if (!sr) return false;
    return isNursingServiceRequest(sr) || (orderProgress?.get(id)?.completed ?? sr.status === "completed");
  });
}

// ---- 進み具合 ----

/** 見出し帯の集計の区分。未評価(今日まで)・バリアンス・未実施(今日まで)。 */
export type SheetIssue = "pending" | "variance" | "undone";

export interface SheetProgress {
  counts: Record<SheetIssue, number>;
  /** 区分ごとに、該当するセルを持つ行の key。 */
  rowKeys: Record<SheetIssue, Set<string>>;
}

/**
 * 進み具合の集計。［決定］未評価と未実施は今日までの病日だけを数える(先の病日はまだ評価・実施しないので)。
 * 未評価は達成状態が無いか「未評価」を記録したアウトカムのセル、バリアンスは「未達成」のセル(期間を問わない)、
 * 未実施はタスクのセルで pathwayTaskPerformedOn が偽のもの。数はセルの数。
 */
export function sheetProgress(
  sheet: PathwaySheet,
  today: string,
  orders: Map<string, fhir4.ServiceRequest> | undefined,
  performDates: Map<string, Set<string>>,
  orderProgress: Map<string, OrderProgress> | undefined,
): SheetProgress {
  const counts: Record<SheetIssue, number> = { pending: 0, variance: 0, undone: 0 };
  const rowKeys: Record<SheetIssue, Set<string>> = { pending: new Set(), variance: new Set(), undone: new Set() };
  const dateOf = new Map(sheet.days.map((d) => [d.eventId, d.date]));
  for (const row of sheet.rows) {
    for (const [eventId, cell] of row.cells) {
      const date = dateOf.get(eventId) ?? "";
      if (row.kind === "unit") {
        const achievement = (cell as SheetUnitCell).achievement;
        if (achievement === "2") {
          counts.variance++;
          rowKeys.variance.add(row.key);
        } else if ((!achievement || achievement === "3") && date <= today) {
          counts.pending++;
          rowKeys.pending.add(row.key);
        }
      } else if (row.kind === "task" && date <= today) {
        if (!pathwayTaskPerformedOn(cell as SheetTaskCell, date, orders, performDates, orderProgress)) {
          counts.undone++;
          rowKeys.undone.add(row.key);
        }
      }
    }
  }
  return { counts, rowKeys };
}

/**
 * 集計の区分で行を絞る。未評価・バリアンスはそのアウトカムの行と配下の行、未実施はそのタスクの行と
 * 属するアウトカムの行を出す(畳んだアウトカムも開いて出す)。
 */
export function filterSheetRows(rows: SheetRow[], issue: SheetIssue, progress: SheetProgress): SheetRow[] {
  const keys = progress.rowKeys[issue];
  if (issue === "undone") {
    const units = new Set(rows.filter((r) => keys.has(r.key)).map((r) => r.unitKey));
    return rows.filter((r) => (r.kind === "unit" ? units.has(r.key) : r.kind === "task" && keys.has(r.key)));
  }
  return rows.filter((r) => keys.has(r.unitKey));
}

/** 今日が何病日目か(パスの病日に無ければ null)。 */
export function todayEventOf(events: PathwayEventRecord[], today: string): PathwayEventRecord | null {
  return events.find((event) => event.date === today) ?? null;
}

export function pathwayStatusLabel(status: string): string {
  if (status === "active") return "進行中";
  if (status === "completed") return "終了";
  if (status === "revoked") return "中止";
  return status;
}
