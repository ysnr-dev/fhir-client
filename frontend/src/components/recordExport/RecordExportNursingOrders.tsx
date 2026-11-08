import type { ReactNode } from "react";
import { NURSING_ORDER_STATE_LABELS, nursingOrderState, summarizeNursingOrder } from "../../fhir/nursingOrderHelpers";
import { today } from "../../lib/dates";
import { KartePrintEmptyRow, KartePrintSheet } from "./KartePrintSheet";

// カルテ印刷の指示簿。期間に掛かる看護指示を、中止・終了したものも含めて指示日の順に並べる(指示歴)。

const COLUMNS = ["指示内容", "頻度・条件", "期間", "指示者", "状態"];
const WIDTHS = ["34%", "20%", "22%", "14%", "10%"];

export function RecordExportNursingOrders({ header, orders }: { header: ReactNode; orders: fhir4.ServiceRequest[] }) {
  const at = today();
  return (
    <KartePrintSheet header={header} title="指示簿" columns={COLUMNS} widths={WIDTHS}>
      {orders.length === 0 ? (
        <KartePrintEmptyRow span={COLUMNS.length}>期間内の看護指示はありません。</KartePrintEmptyRow>
      ) : (
        orders.map((order) => {
          const summary = summarizeNursingOrder(order);
          return (
            <tr key={order.id}>
              <td>
                {summary.text}
                {summary.comment && <div className="karte-print__note">{summary.comment}</div>}
              </td>
              <td>{summary.frequency}</td>
              <td>{`${summary.startDate} 〜 ${summary.endDate}`}</td>
              <td>{summary.requesterName}</td>
              <td>{NURSING_ORDER_STATE_LABELS[nursingOrderState(order, at)]}</td>
            </tr>
          );
        })
      )}
    </KartePrintSheet>
  );
}
