import { ANTIMICROBIAL_CATEGORY_LABEL } from "../../fhir/antimicrobialHelpers";
import {
  ANTIMICROBIAL_NOTIFICATION_STATE_LABEL,
  type AntimicrobialNotificationRow,
} from "../../fhir/antimicrobialNotificationHelpers";

/** 特定抗菌薬の届出の内容セル。開始日と、区分・薬剤・届出の状態。 */
export function AntimicrobialNotificationCells({ row }: { row: AntimicrobialNotificationRow }) {
  return (
    <>
      <td className="notification__compact">{row.startDate || "-"}</td>
      <td className="notification__content">
        <span className="notification__review-kind">{ANTIMICROBIAL_CATEGORY_LABEL[row.category]}</span>
        {row.kind && `${row.kind} `}
        {row.medicines}
        <span className="notification__detail">{ANTIMICROBIAL_NOTIFICATION_STATE_LABEL[row.state]}</span>
      </td>
    </>
  );
}
