import type { SurgeryWorklistRow } from "../api/queries";
import { summarizeSurgeryOrder, surgeryOrderItems } from "../fhir/surgeryOrderHelpers";
import { rangeLabel } from "../fhir/surgeryConflictHelpers";
import { Modal } from "./Modal";

// 「同じ手術室の同じ時間帯に、もう手術が入っています」の確認。
//
// 手術室カレンダー(docs/surgery-calendar-design.md)の一部。重なりを検知したら
// 登録を一旦止め、**承知していることを明示したときだけ**通す。
//
// ［導出］止め切らないのは、緊急の割り込みや「前の手術が早く終わる読みでわざと
// 詰める」が実運用で起きるため(surgery-order-design §5.5)。逆に何も挟まないと
// うっかりの二重予約がそのまま残るので、確認 1 回ぶんの手数を取る。
//
// window.confirm は使わない(ブラウザ自動化で操作が詰まるのと、重なっている相手を
// 一覧で見せられないため)。Modal は非ポータルで、申込フォームの中に出るときは
// 外側の <form> の内側に描かれる。**ここに <form> を置いたりボタンの type を
// 省いたりすると、外側のフォームがネイティブ送信される**ので注意。

interface Props {
  /** 重なっている既存の手術。 */
  rows: SurgeryWorklistRow[];
  /** 入れようとしている時間帯の見出し(「第1手術室 9:00〜10:30」)。 */
  plannedLabel: string;
  /**
   * 一覧を読み切れなかった。この場合 rows は「見えた範囲の重なり」でしかないので、
   * 重なりゼロでもこのモーダルを出す(確認できなかったことを伝える)。
   */
  truncated?: boolean;
  /** 重なりを確かめられなかった(読み込みに失敗した)。 */
  unknown?: boolean;
  submitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SurgeryConflictConfirmModal({
  rows,
  plannedLabel,
  truncated,
  unknown,
  submitting,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal title="手術室の予定が重なっています" onClose={onCancel} className="modal--lab-order-item">
      <div className="surgery-conflict">
        <p className="surgery-conflict__planned">{plannedLabel}</p>

        {unknown ? (
          <p className="surgery-day-schedule__warn" role="alert">
            その日の予定を読めなかったため、重なりを確かめられませんでした。
          </p>
        ) : truncated ? (
          <p className="surgery-day-schedule__warn" role="alert">
            その日のオーダーが多く一部しか読めていません。ここに出ていない重なりがある
            可能性があります。
          </p>
        ) : (
          <p className="surgery-day-schedule__warn" role="alert">
            同じ手術室の次の {rows.length} 件と時間帯が重なります。
          </p>
        )}

        {rows.length > 0 && (
          <div className="surgery-day-schedule__table-wrap">
            <table className="master-search__table surgery-day-schedule__table">
              <thead>
                <tr>
                  <th>入室〜退室(予定)</th>
                  <th>術式</th>
                  <th>執刀医</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const summary = summarizeSurgeryOrder(row.order);
                  const items = surgeryOrderItems(row.order, row.itemRequests);
                  const surgeon = summary.staff.find((line) => line.role === "surgeon");
                  return (
                    <tr key={row.order.id} className="surgery-day-schedule__row--conflict">
                      <td>{rangeLabel(summary.scheduledTime, summary.durationMinutes)}</td>
                      <td>
                        {items[0]?.name ?? "術式なし"}
                        {items.length > 1 && (
                          <span className="order-select__muted"> 他 {items.length - 1} 件</span>
                        )}
                      </td>
                      <td>{surgeon?.practitionerName || "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="rad-code__summary">
          緊急の割り込みや、前の手術が早く終わる読みで詰める場合はそのまま登録できます。
          日程を見直す場合は「戻る」で入力に戻ってください。
        </p>

        {/* 外側フォームの送信を起こさないよう type="button" を必ず付ける。 */}
        <div className="lab-order-item__actions">
          <button type="button" onClick={onConfirm} disabled={submitting}>
            {submitting ? "送信中..." : "重なりを承知で登録"}
          </button>
          <button type="button" onClick={onCancel} disabled={submitting}>
            戻る
          </button>
        </div>
      </div>
    </Modal>
  );
}
