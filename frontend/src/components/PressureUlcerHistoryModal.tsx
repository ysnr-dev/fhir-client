import { DESIGNR_ITEMS, isSevereDesignrCode, type PressureUlcerEvaluation } from "../fhir/pressureUlcerHelpers";
import { clockTime, shortDate } from "../lib/dates";
import { LabTimelineChart } from "./LabTimelineChart";
import { Modal } from "./Modal";

// 褥瘡 1 創の DESIGN-R の経過(docs/care-team-design.md §6)。上に合計の推移のグラフ、下に評価日を列・項目を行にした表
// (検査結果の時系列と同じ向き)。重い側の記号(大文字)と重症の評価は強調する。

interface Props {
  title: string;
  /** その創の評価(古い順)。 */
  evaluations: PressureUlcerEvaluation[];
  onClose: () => void;
}

export function PressureUlcerHistoryModal({ title, evaluations, onClose }: Props) {
  const points = evaluations
    .filter((e) => e.total !== null)
    .map((e) => ({ date: e.authoredAt ? e.authoredAt.slice(0, 16) : e.authored, value: e.total as number }));

  // 同じ日に複数の評価があれば時刻も添えて見分ける。
  const sameDay = (day: string) => evaluations.filter((e) => e.authored === day).length > 1;
  const columnLabel = (e: PressureUlcerEvaluation) =>
    sameDay(e.authored) && e.authoredAt ? `${shortDate(e.authored)} ${clockTime(e.authoredAt)}` : shortDate(e.authored);

  return (
    <Modal title={title} onClose={onClose} className="modal--wide">
      {points.length > 0 && (
        <div className="pressure-ulcer-history__chart">
          <LabTimelineChart series={[{ key: "total", name: "DESIGN-R 合計(深さを除く)", unit: "点", integer: true, points }]} />
        </div>
      )}
      <div className="lab-worklist-wrap">
        <table className="lab-worklist pressure-ulcer-history">
          <thead>
            <tr>
              <th className="pressure-ulcer-history__label">項目</th>
              {evaluations.map((e) => (
                <th key={e.responseId} className="pressure-ulcer-history__cell">
                  {columnLabel(e)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DESIGNR_ITEMS.map((item) => (
              <tr key={item.key}>
                <th className="pressure-ulcer-history__label">{item.label}</th>
                {evaluations.map((e) => {
                  const code = e.codes[item.key];
                  return (
                    <td
                      key={e.responseId}
                      className={`pressure-ulcer-history__cell${isSevereDesignrCode(code) ? " pressure-ulcer-history__severe" : ""}`}
                    >
                      {code || "-"}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="pressure-ulcer-history__total">
              <th className="pressure-ulcer-history__label">合計</th>
              {evaluations.map((e) => (
                <td key={e.responseId} className="pressure-ulcer-history__cell">
                  {e.total ?? "-"}
                </td>
              ))}
            </tr>
            <tr>
              <th className="pressure-ulcer-history__label">重症度</th>
              {evaluations.map((e) => (
                <td key={e.responseId} className="pressure-ulcer-history__cell">
                  {e.severity === "重症" ? <span className="micro-result__badge">重症</span> : e.severity || "-"}
                </td>
              ))}
            </tr>
            <tr>
              <th className="pressure-ulcer-history__label">状態</th>
              {evaluations.map((e) => (
                <td key={e.responseId} className="pressure-ulcer-history__cell">
                  {e.state === "healed" ? "治癒" : e.state === "open" ? "継続" : "-"}
                </td>
              ))}
            </tr>
            <tr>
              <th className="pressure-ulcer-history__label">評価者</th>
              {evaluations.map((e) => (
                <td key={e.responseId} className="pressure-ulcer-history__cell pressure-ulcer-history__author">
                  {e.authorName || "-"}
                </td>
              ))}
            </tr>
            <tr>
              <th className="pressure-ulcer-history__label">所見・処置</th>
              {evaluations.map((e) => (
                <td key={e.responseId} className="pressure-ulcer-history__note">
                  {e.note || "-"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
