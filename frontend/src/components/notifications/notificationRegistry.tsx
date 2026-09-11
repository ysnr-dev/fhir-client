import type { ComponentType } from "react";
import { approvalTransactionEntries } from "../../api/notificationActions";
import { LAB_PANIC_TASK_CODE, panicRowOf, type PanicTaskRow } from "../../fhir/labPanicHelpers";
import {
  buildCompletedNotificationTask,
  completeNotificationEntry,
  notificationCodeOf,
  type NotificationRowBase,
} from "../../fhir/notificationHelpers";
import {
  ORDER_APPROVAL_TASK_CODE,
  orderApprovalRowOf,
  type OrderApprovalRow,
} from "../../fhir/orderApprovalTaskHelpers";
import type { OrderEnterer } from "../../fhir/provenanceHelpers";
import { TASK_CODE_SYSTEM } from "../../fhir/taskHelpers";
import { KARTE_DETAIL_PARAM, KARTE_TAB_PARAM, formatKarteDetail } from "../../karteUrl";
import { LabPanicNotificationCells } from "./LabPanicNotificationCells";
import { OrderApprovalNotificationCells } from "./OrderApprovalNotificationCells";

// 通知の種別ごとの振る舞いをまとめた対応表。通知そのものの形は notificationHelpers、
// ここは「一覧でどう見せて、どう対応済みにするか」だけを持つ。
//
// 新しい通知(読影の重要所見・退院時サマリーの督促など)を足すときは、Task を作る側の
// ヘルパー(fhir/*TaskHelpers.ts)と内容セルを書いて、NOTIFICATION_KINDS に 1 要素足す。
// 一覧・件数・種別フィルタ・一括対応はそれだけで動く。

export interface NotificationKindDef<Row extends NotificationRowBase = NotificationRowBase> {
  /** Task.code のコード(system は TASK_CODE_SYSTEM 固定)。 */
  code: string;
  /** 種別列とフィルタの表示。 */
  label: string;
  toRow(task: fhir4.Task, patient: fhir4.Patient | undefined): Row;
  /** 内容セル。対象日と内容の 2 列を返す(列数は種別をまたいで揃える)。 */
  Cells: ComponentType<{ row: Row }>;
  /** 「カルテ」の遷移先。開けないものは null。 */
  karteLink(row: Row): string | null;
  /** 操作ボタンの文言と、対応済みにしたとき note に残す文。 */
  action: { label: string; noteText: string };
  /** 対応できる人。省略すると誰でも(緊急異常値は見た人が確認する)。 */
  canAct?(row: Row, practitionerId: string | null): boolean;
  /**
   * 対応済みにする transaction entry。省略すると Task を completed にする PUT だけ。
   * オーダー承認は来歴への署名も同じ transaction で送る。
   */
  actionEntries?(rows: Row[], actor: OrderEnterer): Promise<fhir4.BundleEntry[]>;
}

function defineNotificationKind<Row extends NotificationRowBase>(
  def: NotificationKindDef<Row>,
): NotificationKindDef<Row> {
  return def;
}

const labPanicKind = defineNotificationKind<PanicTaskRow>({
  code: LAB_PANIC_TASK_CODE.code,
  label: LAB_PANIC_TASK_CODE.display,
  toRow: panicRowOf,
  Cells: LabPanicNotificationCells,
  karteLink: (row) => {
    const params = new URLSearchParams();
    params.set(KARTE_TAB_PARAM, "lab");
    if (row.reportId) params.set("view", row.reportId);
    return `/patients/${row.patientId}/karte?${params.toString()}`;
  },
  action: { label: "確認", noteText: "緊急異常値を確認しました。" },
});

const orderApprovalKind = defineNotificationKind<OrderApprovalRow>({
  code: ORDER_APPROVAL_TASK_CODE.code,
  label: ORDER_APPROVAL_TASK_CODE.display,
  toRow: orderApprovalRowOf,
  Cells: OrderApprovalNotificationCells,
  // 種別の詳細モーダルを開いた状態で開く(承認ボタンはそこにもある)。
  // 看護指示と化学療法はカルテのカードにならないのでタブへ。
  karteLink: (row) => {
    if (!row.patientId) return null;
    const kind = row.kinds[0];
    const params = new URLSearchParams();
    if (kind === "nursing-order") params.set(KARTE_TAB_PARAM, "nursing");
    else if (kind === "chemo-regimen") params.set(KARTE_TAB_PARAM, "chemo");
    else if (kind && row.orderId) {
      params.set(KARTE_DETAIL_PARAM, formatKarteDetail({ kind, id: row.orderId }));
    }
    const query = params.toString();
    return `/patients/${row.patientId}/karte${query ? `?${query}` : ""}`;
  },
  action: { label: "承認", noteText: "代行入力を承認しました。" },
  // 承認できるのは指示医師(通知の宛先)本人だけ。
  canAct: (row, practitionerId) =>
    Boolean(practitionerId && row.task.owner?.reference === `Practitioner/${practitionerId}`),
  actionEntries: (rows, actor) =>
    approvalTransactionEntries(
      rows.map((row) => row.provenanceId),
      actor,
    ),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const NOTIFICATION_KINDS: NotificationKindDef<any>[] = [labPanicKind, orderApprovalKind];

/** 一覧の検索に渡す `code` の値。種別を全部並べて 1 回で引く(カンマ区切りは OR)。 */
export const NOTIFICATION_CODES = NOTIFICATION_KINDS.map(
  (kind) => `${TASK_CODE_SYSTEM}|${kind.code}`,
).join(",");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function notificationKindOf(task: fhir4.Task): NotificationKindDef<any> | undefined {
  const code = notificationCodeOf(task);
  return NOTIFICATION_KINDS.find((kind) => kind.code === code);
}

/** 一覧の行。どの種別かを添えて、セルの描画と操作をレジストリに振り分ける。 */
export interface NotificationRow {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kind: NotificationKindDef<any>;
  row: NotificationRowBase;
}

/** Task 検索の応答を一覧の行にする。知らない種別の Task は落とす。 */
export function notificationRows(
  tasks: fhir4.Task[],
  patients: Map<string, fhir4.Patient>,
): NotificationRow[] {
  const rows: NotificationRow[] = [];
  for (const task of tasks) {
    const kind = notificationKindOf(task);
    if (!kind) continue;
    const patientId = task.for?.reference?.split("/").pop() ?? "";
    rows.push({ kind, row: kind.toRow(task, patients.get(patientId)) });
  }
  return rows;
}

/**
 * 選んだ行を対応済みにする transaction entry。種別ごとにまとめて組み立てる
 * (オーダー承認は来歴を引き直すので、1 件ずつではなく種別単位で渡す)。
 */
export async function completeNotificationEntries(
  rows: NotificationRow[],
  actor: OrderEnterer,
): Promise<fhir4.BundleEntry[]> {
  const byKind = new Map<string, { kind: NotificationKindDef<any>; rows: NotificationRowBase[] }>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const { kind, row } of rows) {
    const group = byKind.get(kind.code) ?? { kind, rows: [] };
    group.rows.push(row);
    byKind.set(kind.code, group);
  }

  const groups = await Promise.all(
    Array.from(byKind.values()).map(({ kind, rows: kindRows }) =>
      kind.actionEntries
        ? kind.actionEntries(kindRows, actor)
        : Promise.resolve(
            kindRows.map((row) =>
              completeNotificationEntry(
                buildCompletedNotificationTask(row.task, actor, kind.action.noteText),
              ),
            ),
          ),
    ),
  );
  return groups.flat();
}
