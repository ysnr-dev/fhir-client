import type { BroughtMedIdentifiedRow } from "../../fhir/broughtMedTaskHelpers";

/** 持参薬鑑別済の内容セル。何剤の鑑別が済み、何剤の判断を待っているか。 */
export function BroughtMedIdentifiedNotificationCells({ row }: { row: BroughtMedIdentifiedRow }) {
  return (
    <>
      <td className="notification__compact">{row.admissionDate || "-"}</td>
      <td>
        <span className="notification__review-kind">持参薬</span>
        {row.total} 剤の鑑別が済みました(判断待ち {row.undecided} 剤)
      </td>
    </>
  );
}
