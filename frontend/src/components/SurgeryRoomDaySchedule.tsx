import { useMemo } from "react";
import { useSurgeryWorklist } from "../api/queries";
import { summarizeSurgeryOrder, surgeryOrderItems } from "../fhir/surgeryOrderHelpers";
import { surgeryTaskStatus, surgeryTaskStatusDisplay } from "../fhir/surgeryTaskHelpers";
import { ErrorBanner } from "./ErrorBanner";

// 日程を入れている手術室の、その日の予定。
//
// 手術は予約枠(Slot)を持たず、部屋の取り合いは手術一覧の目視で確かめる設計
// (docs/surgery-order-design.md §1)。ただし**日程を入れる瞬間だけは一覧が見えない**
// ので、そこで作った重なりは後から一覧で気づくまで残る。同じ日・同じ部屋の予定を
// 入力の隣に出して、入れようとしている時間帯と重なるものに印を付ける。
//
// 手術室カレンダー(申し送り §7-3)が入れば競合するオーダーを作れなくなるが、それまでの
// 間、競合が生まれる唯一の瞬間をふさぐのがこの表示。
//
// 患者名は出さない。ここで知りたいのは「その部屋のその時間が空いているか」であって、
// 別の患者が誰かではない(カルテの申込フォームからも開くので、無関係な患者の氏名を
// 並べないで済ませる)。

interface Props {
  /** 見ようとしている日(YYYY-MM-DD)。空なら読みに行かない。 */
  date: string;
  /** 手術室。空(部屋未定)ならその日の全部屋を並べ、重なりの判定はしない。 */
  roomId: string;
  roomName: string;
  /** 入室予定時刻(HH:mm)。空なら重なりの判定はしない。 */
  time: string;
  /** 予定所要時間(分)。入力欄の値なので文字列。 */
  durationMinutes: string;
  /**
   * 一覧から外すオーダーの id。編集で開いているとき、自分自身が「重なる予定」として
   * 出てしまうのを防ぐ。
   */
  excludeOrderId?: string;
}

export function SurgeryRoomDaySchedule({
  date,
  roomId,
  roomName,
  time,
  durationMinutes,
  excludeOrderId,
}: Props) {
  const worklist = useSurgeryWorklist(date);

  const rows = useMemo(
    () =>
      (worklist.data?.rows ?? [])
        .filter((row) => row.order.id !== excludeOrderId)
        // 中止した手術は部屋を空けるので、重なりにも一覧にも数えない。
        .filter((row) => surgeryTaskStatus(row.task) !== "cancelled")
        .filter((row) => !roomId || summarizeSurgeryOrder(row.order).roomId === roomId),
    [worklist.data, roomId, excludeOrderId],
  );

  // 入れようとしている時間帯。部屋が未定なら取り合う相手がいないので判定しない。
  const planned = roomId ? timeRange(time, durationMinutes) : null;
  const conflictIds = new Set(
    planned
      ? rows
          .filter((row) => {
            const summary = summarizeSurgeryOrder(row.order);
            const other = timeRange(summary.scheduledTime, summary.durationMinutes);
            return other != null && overlaps(planned, other);
          })
          // id で照合するので、id の無いものは入れない(空文字が全行に当たってしまう)。
          .map((row) => row.order.id)
          .filter((id): id is string => Boolean(id))
      : [],
  );

  return (
    <div className="surgery-day-schedule">
      <div className="surgery-day-schedule__head">
        <span className="surgery-day-schedule__title">
          {roomId ? `${roomName || "選んだ手術室"} の予定` : "その日の予定(全手術室)"}
        </span>
        {date && <span className="order-select__muted">{date}</span>}
      </div>

      <ErrorBanner error={worklist.error} />

      {!date ? (
        <p className="order-select__muted">予定手術日を入れると、その日の予定が出ます。</p>
      ) : worklist.isLoading ? (
        <p className="order-select__muted">読み込み中...</p>
      ) : (
        <>
          {/* 読み切れていないと「重なりなし」が嘘になるので、その旨を必ず出す。 */}
          {worklist.data?.truncated && (
            <p className="surgery-day-schedule__warn" role="status">
              オーダーが多いため一部しか読めていません。重なりは手術一覧で確かめてください。
            </p>
          )}
          {planned &&
            (conflictIds.size > 0 ? (
              <p className="surgery-day-schedule__warn" role="status">
                入室予定時刻が、同じ手術室の {conflictIds.size} 件と重なっています。
              </p>
            ) : (
              <p className="order-select__muted">同じ手術室での時間の重なりはありません。</p>
            ))}

          <div className="surgery-day-schedule__table-wrap">
            <table className="master-search__table surgery-day-schedule__table">
              <thead>
                <tr>
                  {!roomId && <th>手術室</th>}
                  <th>入室〜退室(予定)</th>
                  <th>術式</th>
                  <th>執刀医</th>
                  <th>ステータス</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const summary = summarizeSurgeryOrder(row.order);
                  const items = surgeryOrderItems(row.order, row.itemRequests);
                  const surgeon = summary.staff.find((line) => line.role === "surgeon");
                  const status = surgeryTaskStatus(row.task);
                  const conflict = row.order.id != null && conflictIds.has(row.order.id);
                  return (
                    <tr
                      key={row.order.id}
                      className={conflict ? "surgery-day-schedule__row--conflict" : undefined}
                    >
                      {!roomId && <td>{summary.roomName || "部屋未定"}</td>}
                      <td>
                        {timeLabel(summary.scheduledTime, summary.durationMinutes)}
                        {conflict && <span className="surgery-day-schedule__flag">重なり</span>}
                      </td>
                      <td>
                        {items[0]?.name ?? "術式なし"}
                        {items.length > 1 && (
                          <span className="order-select__muted"> 他 {items.length - 1} 件</span>
                        )}
                      </td>
                      <td>{surgeon?.practitionerName || "-"}</td>
                      <td>{surgeryTaskStatusDisplay(status)}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={roomId ? 4 : 5} className="master-search__empty">
                      {roomId ? "この手術室のその日の予定はありません" : "その日の手術はありません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** その日の何分目から何分目か。時刻が無ければ判定できないので null。 */
function timeRange(
  time: string,
  durationMinutes: number | string | null | undefined,
): { start: number; end: number } | null {
  if (!/^\d{1,2}:\d{2}$/.test(time)) return null;
  const [hours, minutes] = time.split(":").map(Number);
  const start = hours * 60 + minutes;
  const duration = Number(durationMinutes);
  // 所要時間が分からないものは入室時刻の一点として扱う(1 分幅にすると、他方の
  // 時間帯の中に落ちたときだけ重なりとして拾える)。
  return {
    start,
    end: start + (Number.isFinite(duration) && duration > 0 ? duration : 1),
  };
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

function timeLabel(time: string, durationMinutes: number | null): string {
  if (!time) return "時刻未定";
  const range = timeRange(time, durationMinutes);
  if (durationMinutes == null || !range) return time;
  const pad = (n: number) => String(n).padStart(2, "0");
  const end = range.end % (24 * 60);
  return `${time}〜${pad(Math.floor(end / 60))}:${pad(end % 60)}`;
}
