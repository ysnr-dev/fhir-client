import type { DpcRecodingDueRow } from "../../fhir/dpcRecodingDueHelpers";

/** DPC 再判定の督促の内容セル。いつ、どの病棟からどの病棟へ転棟したか。 */
export function DpcRecodingDueNotificationCells({ row }: { row: DpcRecodingDueRow }) {
  return (
    <>
      <td className="notification__compact">{row.transferDate}</td>
      <td>
        <span className="notification__review-kind">転棟</span>
        {row.fromWard || "-"} → {row.toWard || "-"} の診断群分類が未判定
      </td>
    </>
  );
}
