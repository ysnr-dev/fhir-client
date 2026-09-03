import {
  flowsheetEventAtLabel,
  flowsheetEventRangeLabel,
  type FlowsheetEvent,
} from "../fhir/flowsheetEventHelpers";
import type { KarteDetailTarget } from "../karteUrl";
import { Modal } from "./Modal";

interface Props {
  /** 選んだ境目のイベント。重い順(手術 → 入退院 → 検査)に並んでいる。 */
  events: FlowsheetEvent[];
  /** 見出し。省略すると「イベント（期間）」。注射欄からは「注射（MM/DD）」で開く。 */
  title?: string;
  /** オーダーの詳細モーダルを開く。渡されなければ「詳細」を出さない。 */
  onOpenDetail?: (target: KarteDetailTarget) => void;
  onClose: () => void;
}

// 経過表のイベントの帯で選んだ境目のイベント一覧。
//
// 帯は列幅(64px)に収まる短いラベルしか置けず、同じ種類の検査は「放射線×7」に
// まとまる。ここでは 1 件ずつ日時つきで並べ、オーダーがあるものはカルテと同じ
// 詳細モーダルへ渡す(経過表に部門ごとの詳細表示を作らないため)。
//
// 入退院・転棟・外出泊はカルテのカードにならないので、詳細への導線を持たない。
export function FlowsheetEventModal({ events, title, onOpenDetail, onClose }: Props) {
  const range = flowsheetEventRangeLabel(events);
  const heading = title ?? (range ? `イベント（${range}）` : "イベント");

  return (
    <Modal title={heading} onClose={onClose}>
      <table className="patient-table flowsheet-event-modal__table">
        <thead>
          <tr>
            <th>日時</th>
            <th>種別</th>
            <th>内容</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {events.map((event, index) => (
            <tr key={`${event.at}/${event.name}/${index}`}>
              <td className="flowsheet-event-modal__at">{flowsheetEventAtLabel(event.at)}</td>
              <td>{event.name}</td>
              <td>{event.detail}</td>
              <td className="patient-table__actions">
                {event.target && onOpenDetail && (
                  <button
                    type="button"
                    onClick={() => {
                      // 詳細はカルテ側のモーダルなので、こちらは閉じてから開く。
                      onClose();
                      onOpenDetail(event.target as KarteDetailTarget);
                    }}
                  >
                    詳細
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
