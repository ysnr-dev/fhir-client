import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  surgeryWorklistQuery,
  useMoveSurgerySchedule,
  useSelfDepartments,
  type SurgeryWorklistResult,
  type SurgeryWorklistRow,
} from "../api/queries";
import { useSurgeryRoomBlocks } from "../api/masterQueries";
import { departmentCode } from "../fhir/departmentHelpers";
import { summarizeSurgeryOrder, surgeryOrderItems } from "../fhir/surgeryOrderHelpers";
import {
  blockLabel,
  blocksOfRoomDay,
  conflictingBlocks,
  conflictingRows,
  rangeLabel,
  roomDayRows,
  timeRange,
} from "../fhir/surgeryConflictHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// カレンダーでカードを掴んで動かしたときの「移動の確認」。
//
// ［提案］ドロップで即書き込みにはしない。日程は手術部・病棟・麻酔科が見ている
// 予定で、手が滑ったドラッグがそのまま他部署に流れると取り返しが面倒になる。
// 変更前 → 後を並べて 1 回確認させる(登録前のダブルブッキング確認と同じ作法。
// docs/surgery-calendar-design.md)。
//
// 移動先の重なりは開いた時点で**引き直す**(キャッシュを見ない)。カレンダーを
// 描いてから掴むまでの間に他の端末が入れたぶんを拾うため。

export interface SurgeryMoveTarget {
  /** 移動先の予定手術日(YYYY-MM-DD)。 */
  date: string;
  /** 移動先の入室予定時刻(HH:mm)。日付だけのオーダーは空のまま。 */
  time: string;
  roomId: string;
  roomName: string;
}

interface Props {
  row: SurgeryWorklistRow;
  target: SurgeryMoveTarget;
  onClose: () => void;
  /** 書き込みが通ったあと。 */
  onMoved?: () => void;
}

export function SurgeryMoveConfirmModal({ row, target, onClose, onMoved }: Props) {
  const move = useMoveSurgerySchedule();
  const summary = summarizeSurgeryOrder(row.order);
  const items = surgeryOrderItems(row.order, row.itemRequests);

  const conflict = useTargetConflicts(row, target);

  // 割当科の食い違い。移動先の日・部屋の割当と、このオーダーの執刀科を突き合わせる。
  const blocks = useSurgeryRoomBlocks(target.date || undefined);
  const { departments } = useSelfDepartments();
  const orderDepartment = summary.surgicalDepartmentId
    ? departments.find((d) => d.id === summary.surgicalDepartmentId)
    : undefined;
  const outsideBlocks = conflictingBlocks(
    blocksOfRoomDay(blocks.data ?? [], target.roomId, target.date),
    timeRange(target.time, summary.durationMinutes),
    orderDepartment ? departmentCode(orderDepartment) : "",
  );

  function handleMove() {
    move.mutate(
      {
        order: row.order,
        values: {
          scheduledDate: target.date,
          scheduledTime: target.time,
          // 所要時間と術式は動かさない。動かすのは「いつ・どこで」だけ。
          durationMinutes: summary.durationMinutes != null ? String(summary.durationMinutes) : "",
          roomId: target.roomId,
          roomName: target.roomName,
        },
      },
      {
        onSuccess: () => {
          onMoved?.();
          onClose();
        },
      },
    );
  }

  const blocked = conflict.loading || move.isPending;

  return (
    <Modal title="手術の日程を移動" onClose={onClose} className="modal--lab-order-item">
      <div className="surgery-conflict">
        <p className="surgery-move__subject">{items[0]?.name ?? "術式なし"}</p>

        <div className="surgery-move__diff">
          <div className="surgery-move__side">
            <span className="surgery-move__label">変更前</span>
            <span>{summary.scheduledDate || "日付未定"}</span>
            <span>{rangeLabel(summary.scheduledTime, summary.durationMinutes)}</span>
            <span>{summary.roomName || "部屋未定"}</span>
          </div>
          <span className="surgery-move__arrow" aria-hidden="true">
            →
          </span>
          <div className="surgery-move__side surgery-move__side--next">
            <span className="surgery-move__label">変更後</span>
            <span>{target.date || "日付未定"}</span>
            <span>{rangeLabel(target.time, summary.durationMinutes)}</span>
            <span>{target.roomName || "部屋未定"}</span>
          </div>
        </div>

        <ErrorBanner error={move.error} />

        {/* 割当外は警告まで(移動は止めない)。 */}
        {outsideBlocks.length > 0 && (
          <p className="surgery-day-schedule__warn" role="status">
            移動先は {outsideBlocks.map((b) => b.department_name || b.department_code).join(" / ")}{" "}
            の割当です({outsideBlocks.map(blockLabel).join(" / ")})。
          </p>
        )}

        {conflict.loading ? (
          <p className="order-select__muted">移動先の予定を確認しています...</p>
        ) : conflict.unknown ? (
          <p className="surgery-day-schedule__warn" role="alert">
            移動先の予定を読めなかったため、重なりを確かめられませんでした。
          </p>
        ) : conflict.truncated ? (
          <p className="surgery-day-schedule__warn" role="alert">
            移動先の日はオーダーが多く一部しか読めていません。ここに出ていない重なりがある
            可能性があります。
          </p>
        ) : conflict.rows.length > 0 ? (
          <p className="surgery-day-schedule__warn" role="alert">
            移動先で、同じ手術室の次の {conflict.rows.length} 件と時間帯が重なります。
          </p>
        ) : (
          <p className="order-select__muted">移動先の手術室での時間の重なりはありません。</p>
        )}

        {conflict.rows.length > 0 && (
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
                {conflict.rows.map((other) => {
                  const otherSummary = summarizeSurgeryOrder(other.order);
                  const otherItems = surgeryOrderItems(other.order, other.itemRequests);
                  const surgeon = otherSummary.staff.find((line) => line.role === "surgeon");
                  return (
                    <tr key={other.order.id} className="surgery-day-schedule__row--conflict">
                      <td>{rangeLabel(otherSummary.scheduledTime, otherSummary.durationMinutes)}</td>
                      <td>
                        {otherItems[0]?.name ?? "術式なし"}
                        {otherItems.length > 1 && (
                          <span className="order-select__muted"> 他 {otherItems.length - 1} 件</span>
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

        {/* Modal は非ポータル。type="button" を必ず付ける(外側フォームの送信を防ぐ)。 */}
        <div className="lab-order-item__actions">
          <button type="button" onClick={handleMove} disabled={blocked}>
            {move.isPending
              ? "送信中..."
              : conflict.rows.length > 0 || conflict.truncated || conflict.unknown
                ? "重なりを承知で移動"
                : "移動する"}
          </button>
          <button type="button" onClick={onClose} disabled={move.isPending}>
            戻る
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface TargetConflicts {
  loading: boolean;
  rows: SurgeryWorklistRow[];
  truncated: boolean;
  unknown: boolean;
}

/**
 * 移動先の日を引き直して重なりを出す。
 *
 * キャッシュを見ない(staleTime: 0)。カレンダーを描いた後に他端末が入れたぶんを
 * 拾うのがこの確認の目的なので、描画に使ったキャッシュを読み返しても意味がない。
 */
function useTargetConflicts(row: SurgeryWorklistRow, target: SurgeryMoveTarget): TargetConflicts {
  const queryClient = useQueryClient();
  const [state, setState] = useState<TargetConflicts>({
    loading: true,
    rows: [],
    truncated: false,
    unknown: false,
  });

  const summary = summarizeSurgeryOrder(row.order);
  const durationMinutes = summary.durationMinutes;

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const planned = timeRange(target.time, durationMinutes);
      // 部屋・時刻が決まっていなければ取り合う相手が定まらない。
      if (!target.date || !target.roomId || !planned) {
        if (!cancelled) setState({ loading: false, rows: [], truncated: false, unknown: false });
        return;
      }

      let result: SurgeryWorklistResult | null = null;
      try {
        result = await queryClient.fetchQuery({
          ...surgeryWorklistQuery(target.date),
          staleTime: 0,
        });
      } catch {
        result = null;
      }
      if (cancelled) return;

      if (!result) {
        setState({ loading: false, rows: [], truncated: false, unknown: true });
        return;
      }

      setState({
        loading: false,
        rows: conflictingRows(
          roomDayRows(result.rows, {
            roomId: target.roomId,
            excludeOrderId: row.order.id,
          }),
          planned,
        ),
        truncated: result.truncated,
        unknown: false,
      });
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [queryClient, target.date, target.time, target.roomId, durationMinutes, row.order.id]);

  return state;
}
