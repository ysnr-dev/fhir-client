import { useState } from "react";
import { useGenerateSlots, useSlotsInRange } from "../api/queries";
import {
  buildSlotsAt,
  scheduleTypeOf,
  emptySlotPattern,
  isWithinHorizon,
  schedulePeriodLabel,
  slotPatternOf,
  slotsAt,
  validateSlotAdd,
  type SlotAddValues,
} from "../fhir/scheduleHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 枠(Slot)の個別追加。曜日パターンから外れた臨時の枠を足すためのもので、
// 一括生成と違って既存の枠は見ない —— 同じ日時に足せばその時間の席が増える
// (「この時間だけもう 1 人受ける」)。
//
// 枠表の有効期間の外でも作れるようにしてある(臨時枠は期間外に立てたいことが
// あるため)。ただし気づかず外に作ってしまわないよう注意書きは出す。

interface SlotAddModalProps {
  schedule: fhir4.Schedule;
  /** カレンダーの空きマスから開いたときの初期値。 */
  defaultDate: string;
  defaultTime: string;
  onClose: () => void;
  onAdded: (created: number) => void;
}

export function SlotAddModal({
  schedule,
  defaultDate,
  defaultTime,
  onClose,
  onAdded,
}: SlotAddModalProps) {
  const pattern = slotPatternOf(schedule) ?? emptySlotPattern;
  // 検査予約は 1 枠 1 予約なので、同じ時間に席を重ねる「追加する人数」は出さない。
  const fixedCount = scheduleTypeOf(schedule) === "exam";

  const [values, setValues] = useState<SlotAddValues>({
    date: defaultDate,
    time: defaultTime || pattern.blocks[0]?.start || "09:00",
    durationMinutes: pattern.durationMinutes,
    count: 1,
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  // その日の枠を引いて、同じ日時に何件あるかを知らせる(足すか止めるかの判断材料)。
  const sameDay = useSlotsInRange(
    schedule.id,
    { from: values.date, to: values.date },
    Boolean(values.date),
  );
  const existing = values.time ? slotsAt(sameDay.slots, values.date, values.time) : [];
  const addSlots = useGenerateSlots();

  function update<K extends keyof SlotAddValues>(key: K, value: SlotAddValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleAdd() {
    const error = validateSlotAdd(values);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);

    const slots = buildSlotsAt(
      schedule.id as string,
      values.date,
      values.time,
      values.durationMinutes,
      values.count,
    );
    addSlots.mutate(slots, { onSuccess: () => onAdded(slots.length) });
  }

  const outsideHorizon = Boolean(values.date) && !isWithinHorizon(schedule, values.date);

  return (
    <Modal title="枠を追加" onClose={onClose} className="slot-add-modal">
      <div className="slot-generate">
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={sameDay.error} />
        <ErrorBanner error={addSlots.error} />

        <div className="slot-generate__range">
          <label>
            日付
            <input
              type="date"
              value={values.date}
              onChange={(e) => update("date", e.target.value)}
            />
          </label>
          <label>
            開始時刻
            <input
              type="time"
              value={values.time}
              onChange={(e) => update("time", e.target.value)}
            />
          </label>
        </div>

        <div className="slot-pattern__row">
          <label>
            枠の長さ(分)
            <input
              type="number"
              min={1}
              step={1}
              value={values.durationMinutes}
              onChange={(e) => update("durationMinutes", Number(e.target.value))}
            />
          </label>
          {!fixedCount && (
            <label>
              追加する人数
              <input
                type="number"
                min={1}
                step={1}
                value={values.count}
                onChange={(e) => update("count", Number(e.target.value))}
              />
            </label>
          )}
        </div>

        {outsideHorizon && (
          <p className="slot-add__warning">
            この日付は枠表の有効期間({schedulePeriodLabel(schedule)})の外です。作成はできますが、
            期間を直すか日付を選び直すか確認してください。
          </p>
        )}

        <p className="slot-generate__preview">
          {sameDay.isLoading
            ? "この日の枠を確認しています..."
            : existing.length > 0
              ? `この日時には既に ${existing.length} 件の枠があります(追加すると ${existing.length + Math.max(1, values.count)} 件になります)。`
              : "この日時にはまだ枠がありません。"}
        </p>

        <div className="slot-generate__actions">
          <button type="button" onClick={handleAdd} disabled={addSlots.isPending}>
            {addSlots.isPending ? "追加中..." : "追加"}
          </button>
          <button type="button" onClick={onClose} disabled={addSlots.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
