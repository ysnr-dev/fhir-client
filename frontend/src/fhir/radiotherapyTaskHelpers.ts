import { createTaskHelpers } from "./taskHelpers";

// 放射線治療の進捗。作りは他部門と同じ「ServiceRequest ← focus ── Task」で、他科依頼と
// 同じく **Task の遷移と同じ transaction で ServiceRequest.status も動かす**
// (docs/radiotherapy-order-design.md §4)。
//
//   Task requested   (処方済)  ↔ SR.status active
//   Task accepted    (計画中)  ↔ SR.status active     計画 CT 〜 治療計画 〜 承認
//   Task in-progress (治療中)  ↔ SR.status active     初回照射から最終照射まで
//   Task on-hold     (休止)    ↔ SR.status on-hold    体調不良・機器故障などで中断
//   Task completed   (終了)    ↔ SR.status completed  + 終了日
//   Task cancelled   (中止)    ↔ SR.status revoked    + 中止日・理由
//
// 治療コースは数週間続き、その間この Task は治療中のまま動かない(リハビリと同じ
// 「部門の受け入れ状態」)。日々の照射は Task を動かさず Procedure を足す(後続。§6)。
//
// 放射線治療は日付軸の検索が使えない(上流の order-period は拡張 URL が固定)ので、
// 部門一覧が「進行中だけ」をサーバー側で絞る手段は status しか無い。
// **表示の正本は Task**、status は検索のための索引。片方だけを動かす実装を書かないこと —
// 書き込みの入口は api/queries.ts の useUpdateRadiotherapyTaskStatus だけにする。

export const RADIOTHERAPY_TASK_CODE = { code: "radiotherapy", display: "放射線治療" };

export type RadiotherapyTaskStatus =
  | "requested"
  | "accepted"
  | "in-progress"
  | "on-hold"
  | "completed"
  | "cancelled";

export const RADIOTHERAPY_TASK_STATUS_OPTIONS: { code: RadiotherapyTaskStatus; display: string }[] = [
  { code: "requested", display: "処方済" },
  { code: "accepted", display: "計画中" },
  { code: "in-progress", display: "治療中" },
  { code: "on-hold", display: "休止" },
  { code: "completed", display: "終了" },
  { code: "cancelled", display: "中止" },
];

const helpers = createTaskHelpers<RadiotherapyTaskStatus>({
  taskCode: RADIOTHERAPY_TASK_CODE,
  statusOptions: RADIOTHERAPY_TASK_STATUS_OPTIONS,
});

export const radiotherapyTaskStatusDisplay = helpers.statusDisplay;

/** ServiceRequest.status のうち、その進捗に対応するもの(§4)。 */
export function radiotherapyOrderStatusFor(
  status: RadiotherapyTaskStatus,
): fhir4.ServiceRequest["status"] {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "revoked";
  if (status === "on-hold") return "on-hold";
  return "active";
}

export interface RadiotherapyTaskAction {
  label: string;
  next: RadiotherapyTaskStatus;
  /** 日常の流れではない操作(押し間違いの訂正・中止)。ケバブメニューに畳む。 */
  secondary?: true;
  /** 日付と理由を聞いてから進める操作(終了・中止・休止)。 */
  asksTermination?: "completed" | "cancelled" | "on-hold";
}

/** 今のステータスから移れる先。 */
export function radiotherapyTaskActions(status: RadiotherapyTaskStatus): RadiotherapyTaskAction[] {
  switch (status) {
    case "requested":
      return [
        { label: "受付", next: "accepted" },
        { label: "中止", next: "cancelled", secondary: true, asksTermination: "cancelled" },
      ];
    case "accepted":
      return [
        { label: "治療開始", next: "in-progress" },
        { label: "受付取消", next: "requested", secondary: true },
        { label: "中止", next: "cancelled", secondary: true, asksTermination: "cancelled" },
      ];
    case "in-progress":
      return [
        { label: "終了", next: "completed", asksTermination: "completed" },
        { label: "休止", next: "on-hold", asksTermination: "on-hold" },
        { label: "治療開始を取消", next: "accepted", secondary: true },
        { label: "中止", next: "cancelled", secondary: true, asksTermination: "cancelled" },
      ];
    // 休止から戻る先は治療中。休止のまま終える(治療をやめる)ときは中止。
    case "on-hold":
      return [
        { label: "再開", next: "in-progress" },
        { label: "中止", next: "cancelled", secondary: true, asksTermination: "cancelled" },
      ];
    case "completed":
      return [{ label: "終了を取消", next: "in-progress", secondary: true }];
    case "cancelled":
      return [{ label: "中止を取消", next: "requested", secondary: true }];
  }
}

export const isRadiotherapyTask = helpers.isTask;
export const radiotherapyTaskStatus = helpers.taskStatus;
export const radiotherapyTasksByOrderId = helpers.tasksByOrderId;
export const buildRadiotherapyTaskUpdate = helpers.buildTaskUpdate;
