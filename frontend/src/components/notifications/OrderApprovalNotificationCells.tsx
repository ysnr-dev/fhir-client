import { kindLabel, type OrderApprovalRow } from "../../fhir/orderApprovalTaskHelpers";
import { orderActivityLabel } from "../../fhir/provenanceHelpers";

/**
 * オーダー承認の内容セル。行の単位はオーダーではなく**活動**(登録・編集・中止・完了…)で、
 * 承認済みのオーダーを代行者が編集すると、その編集ぶんがまた並ぶ。
 *
 * 内容の確認はカルテの詳細モーダルで行うので、ここには「何のオーダーの、どの活動を、
 * 誰が入力したか」だけを出す(種別ごとの詳細表示をここに複製しない)。
 */
export function OrderApprovalNotificationCells({ row }: { row: OrderApprovalRow }) {
  return (
    <>
      <td className="notification__compact">{row.dayLabel || "-"}</td>
      <td>
        <span className="notification__approval-kind">
          {row.kinds.map(kindLabel).join(" / ")}
          {row.orderSetName && (
            <span className="order-select__muted">{` セット「${row.orderSetName}」`}</span>
          )}
        </span>
        <span className="notification__approval-activity">{orderActivityLabel(row.activity)}</span>
        <span className="order-select__muted notification__approval-context">
          {[row.contextLabel, row.entererName && `入力: ${row.entererName}`]
            .filter(Boolean)
            .join(" / ")}
        </span>
      </td>
    </>
  );
}
