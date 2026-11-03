// 未完了記録一覧(docs/features/notifications.md「未完了記録一覧」)。
//
// 承認待ち・差戻し・作成待ちの文書・未確認の結果などの未対応の Task と、下書きのままの診療記録(Composition)を
// 種別 × 担当者で数える。担当者は Task.owner、診療記録は記載者(author)。種別はここに 1 要素足せば画面と
// ホームのカードに乗る。緊急異常値・早期警告のような臨床の警報は記録の不備ではないので入れない。
import { localDay, today as todayString, diffDays } from "../lib/dates";
import { ANTIMICROBIAL_NOTIFICATION_TASK_CODE } from "./antimicrobialNotificationHelpers";
import { CONSULT_NOTE_TYPE, PROGRESS_NOTE_TYPE } from "./clinicalNoteHelpers";
import { NOTE_COUNTERSIGN_TASK_CODE, NOTE_RETURNED_TASK_CODE } from "./countersignHelpers";
import { DOCUMENT_DUE_TASK_CODE } from "./documentDueHelpers";
import { DPC_RECODING_DUE_TASK_CODE } from "./dpcRecodingDueHelpers";
import { FOLLOW_UP_TASK_CODE } from "./followUpHelpers";
import { notificationCodeOf, taskInputOf } from "./notificationHelpers";
import { NURSING_SUMMARY_RETURNED_TASK_CODE } from "./nursingSummaryTaskHelpers";
import { ORDER_APPROVAL_TASK_CODE } from "./orderApprovalTaskHelpers";
import { RADIOTHERAPY_REVIEW_DUE_TASK_CODE } from "./radiotherapyReviewHelpers";
import { RESULT_EXPLANATION_TASK_CODE } from "./resultExplanationHelpers";
import { RESULT_REVIEW_TASK_CODE } from "./resultReviewHelpers";
import { RX_INQUIRY_TASK_CODE } from "./rxInquiryHelpers";
import { referenceId } from "./shared";
import { TASK_CODE_SYSTEM } from "./taskHelpers";

export type RecordDeficiencyGroup = "記録" | "結果" | "照会・届出";

/** 数える元。task は Task.code の種別、draft-note は下書きの診療記録。 */
export type RecordDeficiencySource = "task" | "draft-note";

export interface RecordDeficiencyKind {
  /** 種別のキー。task は Task.code のコード(system は TASK_CODE_SYSTEM)。 */
  code: string;
  source: RecordDeficiencySource;
  /** 列見出し。 */
  label: string;
  group: RecordDeficiencyGroup;
  /** 対応する一覧の画面。無いものはモーダルの行からカルテへ移るだけ。 */
  link: string | null;
  /**
   * 期限を過ぎたものだけを数える(期限が先の Task は不備ではない)。期限は restriction.period.end。
   * フォロー推奨は数か月先の期限で作るので、期限前は数えない。
   */
  overdueOnly?: boolean;
}

/** 下書きの診療記録の種別キー(Task.code とは重ならない)。 */
export const DRAFT_NOTE_KIND_CODE = "draft-note";

export const RECORD_DEFICIENCY_KINDS: RecordDeficiencyKind[] = [
  { code: DRAFT_NOTE_KIND_CODE, source: "draft-note", label: "記録の下書き", group: "記録", link: null },
  { code: NOTE_COUNTERSIGN_TASK_CODE.code, source: "task", label: "カルテ承認", group: "記録", link: "/countersigns" },
  { code: ORDER_APPROVAL_TASK_CODE.code, source: "task", label: "オーダー承認", group: "記録", link: "/countersigns" },
  { code: NOTE_RETURNED_TASK_CODE.code, source: "task", label: "カルテ差戻し", group: "記録", link: "/notifications" },
  {
    code: NURSING_SUMMARY_RETURNED_TASK_CODE.code,
    source: "task",
    label: "看護サマリー差戻し",
    group: "記録",
    link: "/notifications",
  },
  { code: DOCUMENT_DUE_TASK_CODE.code, source: "task", label: "文書作成", group: "記録", link: "/admission-documents" },
  { code: DPC_RECODING_DUE_TASK_CODE.code, source: "task", label: "DPC再判定", group: "記録", link: "/notifications" },
  {
    code: RADIOTHERAPY_REVIEW_DUE_TASK_CODE.code,
    source: "task",
    label: "放射線治療レビュー",
    group: "記録",
    link: "/notifications",
  },
  { code: RESULT_REVIEW_TASK_CODE.code, source: "task", label: "検査結果確認", group: "結果", link: "/notifications" },
  {
    code: FOLLOW_UP_TASK_CODE.code,
    source: "task",
    label: "フォロー推奨(期限超過)",
    group: "結果",
    link: "/result-followup",
    overdueOnly: true,
  },
  { code: RESULT_EXPLANATION_TASK_CODE.code, source: "task", label: "患者説明", group: "結果", link: "/result-followup" },
  { code: RX_INQUIRY_TASK_CODE.code, source: "task", label: "疑義照会", group: "照会・届出", link: "/notifications" },
  {
    code: ANTIMICROBIAL_NOTIFICATION_TASK_CODE.code,
    source: "task",
    label: "特定抗菌薬の届出",
    group: "照会・届出",
    link: "/ast-worklist?tab=notify",
  },
];

/** Task の検索の `code`。Task の種別を全部並べて 1 回で引く(カンマ区切りは OR)。 */
export const RECORD_DEFICIENCY_CODES = RECORD_DEFICIENCY_KINDS.filter((kind) => kind.source === "task")
  .map((kind) => `${TASK_CODE_SYSTEM}|${kind.code}`)
  .join(",");

/** 集計に要る要素だけを読む(_elements は JSON キー完全一致)。 */
export const RECORD_DEFICIENCY_ELEMENTS = "code,owner,authoredOn,restriction,input,focus";

/**
 * 下書きを数える診療記録の種別(経過記録と他科依頼の回答。看護記録・チーム回診記録も経過記録の type)。
 * 退院時サマリーの下書きは「文書作成」の Task で数えるので入れない。
 */
const codingOf = (concept: fhir4.CodeableConcept) => concept.coding![0];
export const DRAFT_NOTE_TYPE_SEARCH = [PROGRESS_NOTE_TYPE, CONSULT_NOTE_TYPE]
  .map((type) => `${codingOf(type).system}|${codingOf(type).code}`)
  .join(",");
export const DRAFT_NOTE_ELEMENTS = "author,date";

export function recordDeficiencyKindOf(code: string): RecordDeficiencyKind | undefined {
  return RECORD_DEFICIENCY_KINDS.find((kind) => kind.code === code);
}

/** 期限。文書作成は input「期限」、ほかは restriction.period.end。無ければ空。 */
export function taskDueDateOf(task: fhir4.Task): string {
  return (taskInputOf(task, "期限")?.valueDate ?? task.restriction?.period?.end ?? "").slice(0, 10);
}

/** 宛先の決まっていない Task(記載者の無い記録)の担当者キー。 */
export const NO_OWNER = "";

/** 数える 1 件。Task と下書きの診療記録をこの形にそろえてから数える。 */
export interface DeficiencyItem {
  kindCode: string;
  ownerId: string;
  /** 発生日(YYYY-MM-DD)。Task は authoredOn、診療記録は記録日。 */
  since: string;
  /** 期限(YYYY-MM-DD)。無ければ空。 */
  due: string;
  /** 診療記録の id。下書きは自身、カルテ差戻しは差し戻した記録(Task.focus)。他は空。 */
  noteId: string;
}

/** Task を数える形にする。数える種別でなければ null。 */
export function taskDeficiencyItem(task: fhir4.Task): DeficiencyItem | null {
  const kind = recordDeficiencyKindOf(notificationCodeOf(task) ?? "");
  if (!kind || kind.source !== "task") return null;
  return {
    kindCode: kind.code,
    ownerId: referenceId(task.owner?.reference) ?? NO_OWNER,
    since: task.authoredOn ? localDay(task.authoredOn) : "",
    due: taskDueDateOf(task),
    noteId: kind.code === NOTE_RETURNED_TASK_CODE.code ? returnedNoteIdOf(task) : "",
  };
}

/** カルテ差戻しの Task が指す診療記録の id。 */
export function returnedNoteIdOf(task: fhir4.Task): string {
  return task.focus?.reference?.match(/^Composition\/(.+)$/)?.[1] ?? "";
}

/** 下書きの診療記録の記載者(最初の Practitioner)。 */
export function draftNoteOwnerId(composition: fhir4.Composition): string {
  const author = composition.author?.find((a) => a.reference?.startsWith("Practitioner/"));
  return referenceId(author?.reference) ?? NO_OWNER;
}

/** 下書きの診療記録を数える形にする。 */
export function draftNoteDeficiencyItem(composition: fhir4.Composition): DeficiencyItem {
  return {
    kindCode: DRAFT_NOTE_KIND_CODE,
    ownerId: draftNoteOwnerId(composition),
    since: composition.date ? localDay(composition.date) : "",
    due: "",
    noteId: composition.id ?? "",
  };
}

export interface DeficiencyCell {
  count: number;
  /** 期限を過ぎた件数。 */
  overdue: number;
  /** 最も古いものの発生からの日数。 */
  oldestDays: number;
}

export interface DeficiencyOwnerRow {
  /** Practitioner.id。宛先なしは NO_OWNER。 */
  ownerId: string;
  /** 種別コード → 件数。 */
  cells: Map<string, DeficiencyCell>;
  total: number;
  overdue: number;
  oldestDays: number;
}

function addTo(cell: DeficiencyCell | undefined, overdue: boolean, days: number): DeficiencyCell {
  return {
    count: (cell?.count ?? 0) + 1,
    overdue: (cell?.overdue ?? 0) + (overdue ? 1 : 0),
    oldestDays: Math.max(cell?.oldestDays ?? 0, days),
  };
}

/**
 * 担当者ごとに数える。期限を過ぎたものだけを数える種別は、期限前と期限なしを落とす。
 * 並びは合計の多い順(同数なら滞留の長い順)。
 */
export function aggregateRecordDeficiencies(
  items: readonly DeficiencyItem[],
  today: string = todayString(),
): DeficiencyOwnerRow[] {
  const rows = new Map<string, DeficiencyOwnerRow>();
  // 差し戻された記録は下書きに戻っているが、「カルテ差戻し」で数えるので下書きでは数えない(同じ記録を 2 度数えない)。
  const returned = new Set(
    items.filter((item) => item.kindCode === NOTE_RETURNED_TASK_CODE.code && item.noteId).map((item) => item.noteId),
  );
  for (const item of items) {
    if (item.kindCode === DRAFT_NOTE_KIND_CODE && returned.has(item.noteId)) continue;
    const kind = recordDeficiencyKindOf(item.kindCode);
    if (!kind) continue;
    const overdue = Boolean(item.due) && item.due < today;
    if (kind.overdueOnly && !overdue) continue;
    const days = item.since ? Math.max(0, diffDays(item.since, today)) : 0;
    const row = rows.get(item.ownerId) ?? { ownerId: item.ownerId, cells: new Map(), total: 0, overdue: 0, oldestDays: 0 };
    row.cells.set(kind.code, addTo(row.cells.get(kind.code), overdue, days));
    row.total += 1;
    row.overdue += overdue ? 1 : 0;
    row.oldestDays = Math.max(row.oldestDays, days);
    rows.set(item.ownerId, row);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || b.oldestDays - a.oldestDays);
}

/** 担当者の行をまとめた合計の行(表の先頭に出す)。 */
export function sumDeficiencyRows(rows: readonly DeficiencyOwnerRow[]): DeficiencyOwnerRow {
  const cells = new Map<string, DeficiencyCell>();
  for (const row of rows) {
    for (const [code, cell] of row.cells) {
      const current = cells.get(code);
      cells.set(code, {
        count: (current?.count ?? 0) + cell.count,
        overdue: (current?.overdue ?? 0) + cell.overdue,
        oldestDays: Math.max(current?.oldestDays ?? 0, cell.oldestDays),
      });
    }
  }
  return {
    ownerId: NO_OWNER,
    cells,
    total: rows.reduce((sum, row) => sum + row.total, 0),
    overdue: rows.reduce((sum, row) => sum + row.overdue, 0),
    oldestDays: rows.reduce((max, row) => Math.max(max, row.oldestDays), 0),
  };
}

/** 一覧のモーダルで、期限を過ぎたものだけを数える種別の行を落とす(集計と揃える)。 */
export function deficiencyTasksOfKind(
  tasks: readonly fhir4.Task[],
  kind: RecordDeficiencyKind,
  today: string = todayString(),
): fhir4.Task[] {
  if (!kind.overdueOnly) return [...tasks];
  return tasks.filter((task) => {
    const due = taskDueDateOf(task);
    return Boolean(due) && due < today;
  });
}
