import { interpretationClass } from "../../fhir/labResultHelpers";
import type { PanicTaskRow } from "../../fhir/labPanicHelpers";

/**
 * 緊急異常値の内容セル。項目・値・判定を分けて出す(1 件の通知に複数の項目が入る)。
 * 構造化した input を持たない古い通知は本文をそのまま出す。
 */
export function LabPanicNotificationCells({ row }: { row: PanicTaskRow }) {
  return (
    <>
      <td className="notification__compact">{row.specimenDate}</td>
      <td className="notification__items">
        {row.items.length > 0
          ? row.items.map((item, index) => (
              <span className="notification__item" key={index}>
                <span className="notification__item-name">{item.name}</span>
                <span className="notification__item-value">{item.value}</span>
                <span className="notification__item-unit">{item.unit}</span>
                <span className={interpretationClass(item.interpretation, "notification__flag")}>
                  {item.interpretation}
                </span>
              </span>
            ))
          : row.summary}
      </td>
    </>
  );
}
