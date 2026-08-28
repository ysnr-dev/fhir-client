import { useMemo } from "react";
import { useSurgeryWorklist, useSelfDepartments } from "../api/queries";
import { useSurgeryRoomBlocks } from "../api/masterQueries";
import { departmentCode } from "../fhir/departmentHelpers";
import { summarizeSurgeryOrder, surgeryOrderItems } from "../fhir/surgeryOrderHelpers";
import { surgeryTaskStatus, surgeryTaskStatusDisplay } from "../fhir/surgeryTaskHelpers";
import {
  blockLabel,
  blocksOfRoomDay,
  conflictingBlocks,
  conflictingRows,
  rangeLabel,
  roomDayRows,
  rowIdSet,
  timeRange,
} from "../fhir/surgeryConflictHelpers";
import { ErrorBanner } from "./ErrorBanner";

// 日程を入れている手術室の、その日の予定。
//
// 手術は予約枠(Slot)を持たず、部屋の取り合いは手術一覧の目視で確かめる設計
// (docs/surgery-order-design.md §1)。ただし**日程を入れる瞬間だけは一覧が見えない**
// ので、そこで作った重なりは後から一覧で気づくまで残る。同じ日・同じ部屋の予定を
// 入力の隣に出して、入れようとしている時間帯と重なるものに印を付ける。
//
// 判定そのものは fhir/surgeryConflictHelpers に置いてある(登録前の確認ダイアログ・
// 手術室カレンダーと同じ判定を使うため)。ここはその表示。
//
// 重なりがあっても登録は止めない。止めるのは登録の瞬間で、そこでは
// 「重なりを承知で登録」の確認を挟む(docs/surgery-calendar-design.md)。
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
  /**
   * 執刀科(Organization の id)。ブロックスケジュールの割当科と突き合わせて
   * 「割当外の科です」を出すのに使う。未指定なら割当の警告は出さない。
   */
  departmentId?: string;
}

export function SurgeryRoomDaySchedule({
  date,
  roomId,
  roomName,
  time,
  durationMinutes,
  excludeOrderId,
  departmentId,
}: Props) {
  const worklist = useSurgeryWorklist(date);
  const blocks = useSurgeryRoomBlocks(date || undefined);
  const { departments } = useSelfDepartments();

  const rows = useMemo(
    () => roomDayRows(worklist.data?.rows ?? [], { roomId, excludeOrderId }),
    [worklist.data, roomId, excludeOrderId],
  );

  // 入れようとしている時間帯。部屋が未定なら取り合う相手がいないので判定しない。
  const planned = roomId ? timeRange(time, durationMinutes) : null;
  const conflictIds = rowIdSet(conflictingRows(rows, planned));

  // その部屋のその曜日の割当と、執刀科がそこから外れているか。
  const dayBlocks = blocksOfRoomDay(blocks.data ?? [], roomId, date);
  const plannedDepartment = departmentId
    ? departments.find((d) => d.id === departmentId)
    : undefined;
  const plannedDepartmentCode = plannedDepartment ? departmentCode(plannedDepartment) : "";
  const outsideBlocks = conflictingBlocks(dayBlocks, planned, plannedDepartmentCode);

  return (
    <div className="surgery-day-schedule">
      <div className="surgery-day-schedule__head">
        <span className="surgery-day-schedule__title">
          {roomId ? `${roomName || "選んだ手術室"} の予定` : "その日の予定(全手術室)"}
        </span>
        {date && <span className="order-select__muted">{date}</span>}
      </div>

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={blocks.error} />

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

          {/* 曜日ごとの科割り当て。割当外でも登録は止めない(警告まで)。 */}
          {roomId && dayBlocks.length > 0 && (
            <p className="surgery-day-schedule__blocks">
              <span className="surgery-day-schedule__blocks-label">割当</span>
              {dayBlocks.map((block) => (
                <span
                  key={block.id}
                  className={
                    outsideBlocks.some((b) => b.id === block.id)
                      ? "surgery-day-schedule__block surgery-day-schedule__block--outside"
                      : "surgery-day-schedule__block"
                  }
                >
                  {blockLabel(block)}
                </span>
              ))}
            </p>
          )}
          {outsideBlocks.length > 0 && (
            <p className="surgery-day-schedule__warn" role="status">
              この時間帯は{" "}
              {outsideBlocks
                .map((block) => block.department_name || block.department_code)
                .join(" / ")}{" "}
              の割当です。運用上問題なければそのまま登録できます。
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
                        {rangeLabel(summary.scheduledTime, summary.durationMinutes)}
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
