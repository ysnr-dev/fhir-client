import type { PathwayVarianceRow } from "../../fhir/pathwayVarianceHelpers";

/**
 * パスのバリアンスの内容セル。どのパスの、どの病日の、どのアウトカムが未達成かを出す。
 * 評価の記載はカルテのパスタブ(日めくり)で読む。
 */
export function PathwayVarianceNotificationCells({ row }: { row: PathwayVarianceRow }) {
  return (
    <>
      <td className="notification__compact">{row.date}</td>
      <td>
        <span className="notification__review-kind">{row.pathwayTitle}</span>
        <span className="notification__review-kind">{row.eventLabel}</span>
        {row.unitName}
      </td>
    </>
  );
}
