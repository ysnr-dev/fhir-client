import { EARLY_WARNING_BAND_LABEL } from "../../fhir/earlyWarningHelpers";
import type { EwsAlertRow } from "../../fhir/earlyWarningTaskHelpers";
import { dateTimeLabel } from "../../lib/dates";

/** 早期警告の内容セル。測定日時と NEWS2 の点数・区分・点数のある項目。 */
export function EarlyWarningNotificationCells({ row }: { row: EwsAlertRow }) {
  return (
    <>
      <td className="notification__compact">{row.measuredAt ? dateTimeLabel(row.measuredAt) : "-"}</td>
      <td className="notification__content">
        <span className="notification__review-kind">NEWS2</span>
        {row.total}点({EARLY_WARNING_BAND_LABEL[row.band]}){row.missingText ? "・暫定" : ""}
        {row.itemsText && <span className="notification__detail">{row.itemsText}</span>}
        {row.missingText && <span className="notification__detail">欠測: {row.missingText}</span>}
      </td>
    </>
  );
}
