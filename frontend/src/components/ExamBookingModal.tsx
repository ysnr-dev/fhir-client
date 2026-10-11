import { useState } from "react";
import type { SlotSelection } from "../fhir/appointmentHelpers";
import { AppointmentSlotPicker } from "./AppointmentSlotPicker";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

/**
 * 日付未定の検査オーダーに部門一覧から予約を取るモーダル(放射線・生理・内視鏡で共用)。
 * 枠を選んで「予約」を押すと onBook に渡す。書き込みは呼ぶ側(useScheduleExamOrder)。
 */
export function ExamBookingModal({
  title,
  defaultScheduleId,
  requiredMinutes,
  pending,
  error,
  onBook,
  onClose,
}: {
  title: string;
  /** 項目マスタに紐づけた枠表(CT なら CT 室の枠、など)。 */
  defaultScheduleId?: string;
  /** 所要時間(分)。未設定は 1 枠ぶん。 */
  requiredMinutes?: number;
  pending: boolean;
  error: unknown;
  onBook: (selection: SlotSelection) => void;
  onClose: () => void;
}) {
  const [selection, setSelection] = useState<SlotSelection | null>(null);

  return (
    <Modal title={title} onClose={onClose} className="rad-booking-modal">
      <div className="rad-booking">
        <ErrorBanner error={error} />
        <AppointmentSlotPicker
          scheduleType="exam"
          requiredMinutes={requiredMinutes}
          defaultScheduleId={defaultScheduleId}
          selected={selection}
          onSelect={setSelection}
        />
        <div className="rad-booking__actions">
          <button
            type="button"
            onClick={() => selection && onBook(selection)}
            disabled={!selection || pending}
          >
            予約
          </button>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
