import {
  flowsheetEventAtLabel,
  flowsheetEventRangeLabel,
  type FlowsheetEvent,
} from "../fhir/flowsheetEventHelpers";
import type { ReactNode } from "react";
import type { KarteDetailTarget } from "../karteUrl";
import { Modal } from "./Modal";

interface Props {
  /** 選んだ日のイベント。重い順(手術 → 入退院)に並んでいる。 */
  events: FlowsheetEvent[];
  /** 見出し。省略すると「イベント（期間）」。注射欄からは「注射（MM/DD HH:mm）」で開く。 */
  title?: string;
  /**
   * 押した 1 件の位置(events の添字)。同じ日に施用が複数あると一覧が同じ内容に
   * なるので、どれを押したかを行の色で示す。
   */
  highlightIndex?: number;
  /** オーダーの詳細モーダルを開く。渡されなければ「詳細」を出さない。 */
  onOpenDetail?: (target: KarteDetailTarget) => void;
  /** 一覧の下に出す操作(注射の実施入力など)。無ければ出さない。 */
  actions?: ReactNode;
  onClose: () => void;
}

// 経過表のイベントの帯で選んだ境目のイベント一覧。
//
// 帯は列幅(64px)に収まる短いラベルしか置けず、同じ種類の検査は「放射線×7」に
// まとまる。ここでは 1 件ずつ日時つきで並べ、オーダーがあるものはカルテと同じ
// 詳細モーダルへ渡す(経過表に部門ごとの詳細表示を作らないため)。
//
// 入退院・転棟・外出泊はカルテのカードにならないので、詳細への導線を持たない。
//
// 注射・検査からは「その日のオーダー」単位で開くので、同じ日に施用が 2 回あると
// どちらの印を押しても同じ一覧になる。押した 1 件は highlightIndex で色を付ける
// (一覧を 1 件に絞らないのは、予定 2 回と実施を並べて突き合わせるため)。
export function FlowsheetEventModal({
  events,
  title,
  highlightIndex,
  onOpenDetail,
  actions,
  onClose,
}: Props) {
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
            <tr
              key={`${event.at}/${event.name}/${index}`}
              className={
                index === highlightIndex ? "flowsheet-event-modal__row--selected" : undefined
              }
            >
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
      {actions && <div className="flowsheet-event-modal__actions">{actions}</div>}
    </Modal>
  );
}
