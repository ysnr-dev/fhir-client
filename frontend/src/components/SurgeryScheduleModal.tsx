import { useState, type FormEvent } from "react";
import { useConfirmSurgerySchedule, useLocationOptions, type SurgeryWorklistRow } from "../api/queries";
import { locationDisplayName, locationTypeCode } from "../fhir/locationHelpers";
import {
  summarizeSurgeryOrder,
  surgeryOrderItems,
  type SurgeryScheduleValues,
} from "../fhir/surgeryOrderHelpers";
import { useSurgeryConflictCheck } from "../hooks/useSurgeryConflictCheck";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { SurgeryConflictConfirmModal } from "./SurgeryConflictConfirmModal";
import { SurgeryRoomDaySchedule } from "./SurgeryRoomDaySchedule";

// 手術部が日程未定の申込に日程を入れて確定する。オーダーの日程と進捗(受付済 =
// 日程確定)を 1 transaction で書く(useConfirmSurgerySchedule)。
//
// 「未定 → 確定」の一方向だけを扱う。確定後の日程変更は編集フォーム(カルテカード、
// または手術室カレンダーのカードのケバブ)から行う —— 申込の中身と一緒に直せる方が
// 自然なため。
//
// 手術は予約枠を持たないので、部屋のダブルブッキングが生まれるのはこの確定の瞬間
// だけ。入力の下に同じ日・同じ部屋の予定を出して、重なりをその場で見せる
// (SurgeryRoomDaySchedule)。さらに確定を押した時点で一覧を引き直し、重なっていれば
// 「承知で登録」の確認を挟む(useSurgeryConflictCheck)。

interface Props {
  row: SurgeryWorklistRow;
  onClose: () => void;
}

export function SurgeryScheduleModal({ row, onClose }: Props) {
  const confirm = useConfirmSurgerySchedule();
  const summary = summarizeSurgeryOrder(row.order);
  const items = surgeryOrderItems(row.order, row.itemRequests);

  // 手術室。院内の部屋(Location)のうち種別が手術室のものだけを出す。
  const locations = useLocationOptions();
  const rooms = locations.locations.filter((location) => locationTypeCode(location) === "SU");

  // 所要時間は申込時に術式マスタの既定値が入っているので、その値から始める。
  const [values, setValues] = useState<SurgeryScheduleValues>({
    scheduledDate: "",
    scheduledTime: "",
    durationMinutes: summary.durationMinutes != null ? String(summary.durationMinutes) : "",
    roomId: summary.roomId,
    roomName: summary.roomName,
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const conflictCheck = useSurgeryConflictCheck();

  function save() {
    confirm.mutate({ order: row.order, task: row.task, values }, { onSuccess: onClose });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values.scheduledDate) {
      setValidationError("予定手術日を入力してください。");
      return;
    }
    setValidationError(null);

    // 重なりがあれば確認モーダルへ。無ければそのまま確定する。
    const clear = await conflictCheck.check({
      date: values.scheduledDate,
      time: values.scheduledTime,
      durationMinutes: values.durationMinutes,
      roomId: values.roomId,
      roomName: values.roomName,
      excludeOrderId: row.order.id,
    });
    if (clear) save();
  }

  const title = items[0] ? `日程を確定: ${items[0].name}` : "日程を確定";

  return (
    <Modal title={title} onClose={onClose} className="modal--lab-order-item">
      <form onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={locations.error} />
        <ErrorBanner error={confirm.error} />

        <div className="lab-order-item__fields">
          <label>
            予定手術日
            <input
              type="date"
              value={values.scheduledDate}
              onChange={(e) => setValues({ ...values, scheduledDate: e.target.value })}
              required
            />
          </label>
          <label>
            入室予定時刻
            <input
              type="time"
              value={values.scheduledTime}
              onChange={(e) => setValues({ ...values, scheduledTime: e.target.value })}
            />
          </label>
          <label>
            予定所要時間(分)
            <input
              type="number"
              min={1}
              step={1}
              value={values.durationMinutes}
              onChange={(e) => setValues({ ...values, durationMinutes: e.target.value })}
            />
          </label>
          <label>
            手術室
            <select
              value={values.roomId}
              onChange={(e) => {
                const room = rooms.find((location) => location.id === e.target.value);
                setValues({
                  ...values,
                  roomId: e.target.value,
                  roomName: room ? locationDisplayName(room) : "",
                });
              }}
            >
              <option value="">未定</option>
              {/* 申込時に希望した手術室が候補に無い(削除・種別変更)ときも表示は残す。 */}
              {values.roomId && !rooms.some((room) => room.id === values.roomId) && (
                <option value={values.roomId}>{values.roomName || values.roomId}</option>
              )}
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {locationDisplayName(room)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <SurgeryRoomDaySchedule
          date={values.scheduledDate}
          roomId={values.roomId}
          roomName={values.roomName}
          time={values.scheduledTime}
          durationMinutes={values.durationMinutes}
          excludeOrderId={row.order.id}
          departmentId={summary.surgicalDepartmentId}
        />

        <p className="rad-code__summary">確定すると受付済になり、予定日別の一覧に並びます。</p>

        <div className="lab-order-item__actions">
          <button type="submit" disabled={confirm.isPending || conflictCheck.checking}>
            {confirm.isPending ? "送信中..." : conflictCheck.checking ? "確認中..." : "確定する"}
          </button>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </form>

      {conflictCheck.conflict && (
        <SurgeryConflictConfirmModal
          rows={conflictCheck.conflict.rows}
          plannedLabel={conflictCheck.conflict.plannedLabel}
          truncated={conflictCheck.conflict.truncated}
          unknown={conflictCheck.conflict.unknown}
          submitting={confirm.isPending}
          onConfirm={() => {
            conflictCheck.dismiss();
            save();
          }}
          onCancel={conflictCheck.dismiss}
        />
      )}
    </Modal>
  );
}
