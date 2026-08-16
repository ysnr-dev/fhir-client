import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useDeleteSlots, useSchedule, useSlotWeek, useUpdateSlotStatus } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { SlotCalendar } from "../components/SlotCalendar";
import { SlotGenerateModal } from "../components/SlotGenerateModal";
import {
  addDays,
  buildSlotCalendar,
  isBookedSlot,
  scheduleSummary,
  schedulePeriodLabel,
  today,
  weekStart,
} from "../fhir/scheduleHelpers";

// 枠(Slot)の週カレンダー。枠表 1 件ぶんの時間枠を 1 週間単位で並べ、
// 一括生成・停止・再開・削除を行う。
//
// 列が 7 日ぶんあり既定の幅では詰まるので、この画面だけ幅を広げる
// (放射線検査一覧と同じやり方)。

export function ScheduleSlotCalendarPage() {
  const { id } = useParams<{ id: string }>();
  const [week, setWeek] = useState(() => weekStart(today()));
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const { data: scheduleResult, isLoading: loadingSchedule, error: scheduleError } = useSchedule(id);
  const schedule = scheduleResult?.data;
  const { slots, isLoading: loadingSlots, isFetching, error: slotsError } = useSlotWeek(id, week);

  const updateStatus = useUpdateSlotStatus();
  const deleteSlots = useDeleteSlots();

  const rows = useMemo(() => buildSlotCalendar(slots, week), [slots, week]);
  const selectedSlots = slots.filter((slot) => slot.id && selectedIds.has(slot.id));
  const counts = {
    free: slots.filter((s) => s.status === "free").length,
    booked: slots.filter(isBookedSlot).length,
    unavailable: slots.filter((s) => s.status === "busy-unavailable").length,
  };

  function moveWeek(days: number) {
    setWeek((current) => addDays(current, days));
    setSelectedIds(new Set());
    setMessage(null);
  }

  function toggleSlot(slot: fhir4.Slot) {
    if (!slot.id) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(slot.id as string)) next.delete(slot.id as string);
      else next.add(slot.id as string);
      return next;
    });
  }

  function selectAllFree() {
    setSelectedIds(new Set(slots.filter((s) => !isBookedSlot(s) && s.id).map((s) => s.id as string)));
  }

  function handleStatusChange(status: "free" | "busy-unavailable") {
    if (selectedSlots.length === 0) return;
    setMessage(null);
    updateStatus.mutate(
      { slots: selectedSlots, status },
      {
        onSuccess: () => {
          setMessage(
            `${selectedSlots.length} 件の枠を${status === "free" ? "空きに戻しました" : "停止しました"}。`,
          );
          setSelectedIds(new Set());
        },
      },
    );
  }

  function handleDelete() {
    if (selectedSlots.length === 0) return;
    if (!window.confirm(`選択した ${selectedSlots.length} 件の枠を削除します。よろしいですか?`)) {
      return;
    }
    setMessage(null);
    deleteSlots.mutate(selectedSlots, {
      onSuccess: () => {
        setMessage(`${selectedSlots.length} 件の枠を削除しました。`);
        setSelectedIds(new Set());
      },
    });
  }

  if (loadingSchedule) return <div className="page">読み込み中...</div>;

  if (scheduleError || !schedule) {
    return (
      <div className="page">
        <div className="page__header">
          <h1>枠カレンダー</h1>
          <Link to="/schedules" className="button">
            ← 一覧に戻る
          </Link>
        </div>
        <ErrorBanner error={scheduleError} />
      </div>
    );
  }

  const busy = updateStatus.isPending || deleteSlots.isPending;

  return (
    <div className="page">
      <div className="page__header">
        <h1>枠カレンダー</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setGenerating(true)}>
            枠を一括生成
          </button>
          <Link to={`/schedules/${schedule.id}/edit`} className="button">
            枠表を編集
          </Link>
          <Link to="/schedules" className="button">
            ← 一覧に戻る
          </Link>
        </div>
      </div>

      <p className="slot-calendar__schedule">
        {scheduleSummary(schedule)} / 有効期間 {schedulePeriodLabel(schedule)}
        {schedule.active === false && " / この枠表は無効です"}
      </p>

      <div className="slot-calendar__toolbar">
        <div className="slot-calendar__week">
          <button type="button" onClick={() => moveWeek(-7)}>
            ← 前の週
          </button>
          <input
            type="date"
            value={week}
            onChange={(e) => {
              if (!e.target.value) return;
              setWeek(weekStart(e.target.value));
              setSelectedIds(new Set());
            }}
          />
          <button type="button" onClick={() => moveWeek(7)}>
            次の週 →
          </button>
          <button type="button" onClick={() => setWeek(weekStart(today()))}>
            今週
          </button>
        </div>
        <div className="slot-calendar__counts">
          空き {counts.free} / 予約 {counts.booked} / 停止 {counts.unavailable}
          {isFetching && " (更新中...)"}
        </div>
      </div>

      <div className="slot-calendar__actions">
        <span>選択 {selectedSlots.length} 件</span>
        <button type="button" onClick={selectAllFree} disabled={slots.length === 0}>
          予約以外を全選択
        </button>
        <button type="button" onClick={() => setSelectedIds(new Set())} disabled={!selectedSlots.length}>
          選択解除
        </button>
        <button
          type="button"
          onClick={() => handleStatusChange("busy-unavailable")}
          disabled={busy || !selectedSlots.length}
        >
          停止にする
        </button>
        <button
          type="button"
          onClick={() => handleStatusChange("free")}
          disabled={busy || !selectedSlots.length}
        >
          空きに戻す
        </button>
        <button
          type="button"
          className="slot-calendar__delete"
          onClick={handleDelete}
          disabled={busy || !selectedSlots.length}
        >
          削除
        </button>
      </div>

      {message && <p className="slot-calendar__message">{message}</p>}
      <ErrorBanner error={slotsError} />
      <ErrorBanner error={updateStatus.error} />
      <ErrorBanner error={deleteSlots.error} />

      {loadingSlots ? (
        <p>読み込み中...</p>
      ) : (
        <SlotCalendar
          rows={rows}
          weekStartISO={week}
          selectedIds={selectedIds}
          onToggle={toggleSlot}
        />
      )}

      {generating && (
        <SlotGenerateModal
          schedule={schedule}
          onClose={() => setGenerating(false)}
          onGenerated={(created) => {
            setGenerating(false);
            setMessage(`${created} 件の枠を生成しました。`);
          }}
        />
      )}
    </div>
  );
}
