import { useMemo, useState } from "react";
import { useGenerateSlots, useSlotsInRange } from "../api/queries";
import {
  emptySlotPattern,
  generateSlots,
  slotPatternOf,
  validateSlotPattern,
  type SlotPattern,
} from "../fhir/scheduleHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { SlotPatternFields } from "./SlotPatternFields";

// 曜日パターンから枠(Slot)をまとめて作るモーダル。
//
// 期間の既定は枠表の planningHorizon。既に同じ開始時刻の枠がある日時は作らないので、
// 同じ条件で二度実行しても枠は増えない(月の途中で時間帯を足したときの差分追加に使える)。
//
// Modal は非ポータルで、この画面のフォームの外に置く前提。中に <form> は書かない
// (外側のフォームが submit されてしまうため)。

interface SlotGenerateModalProps {
  schedule: fhir4.Schedule;
  onClose: () => void;
  onGenerated: (created: number) => void;
}

export function SlotGenerateModal({ schedule, onClose, onGenerated }: SlotGenerateModalProps) {
  const horizon = {
    from: schedule.planningHorizon?.start?.slice(0, 10) ?? "",
    to: schedule.planningHorizon?.end?.slice(0, 10) ?? "",
  };

  const [range, setRange] = useState(horizon);
  const [pattern, setPattern] = useState<SlotPattern>(
    slotPatternOf(schedule) ?? emptySlotPattern,
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const rangeValid = Boolean(range.from && range.to && range.from <= range.to);
  // カレンダーは 1 週間しか読んでいないので、重複判定用に生成期間ぶんを引き直す。
  const existing = useSlotsInRange(schedule.id, range, rangeValid);
  const generateSlotsMutation = useGenerateSlots();

  const preview = useMemo(() => {
    if (!schedule.id || !rangeValid || existing.isLoading) return [];
    if (validateSlotPattern(pattern)) return [];
    return generateSlots(schedule.id, pattern, range, existing.slots);
  }, [schedule.id, pattern, range, rangeValid, existing.slots, existing.isLoading]);

  function handleGenerate() {
    const error = !rangeValid
      ? "生成する期間を正しく入力してください。"
      : validateSlotPattern(pattern);
    if (error) {
      setValidationError(error);
      return;
    }
    if (preview.length === 0) {
      setValidationError("新しく作る枠がありません(この期間の枠はすべて作成済みです)。");
      return;
    }
    setValidationError(null);
    generateSlotsMutation.mutate(preview, {
      onSuccess: () => onGenerated(preview.length),
    });
  }

  return (
    <Modal title="枠を一括生成" onClose={onClose} className="slot-generate-modal">
      <div className="slot-generate">
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={existing.error} />
        <ErrorBanner error={generateSlotsMutation.error} />

        <div className="slot-generate__range">
          <label>
            生成する期間(開始)
            <input
              type="date"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </label>
          <label>
            生成する期間(終了)
            <input
              type="date"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </label>
        </div>
        <p className="organization-form__hint">
          既定はこの枠表の有効期間({horizon.from || "-"} 〜 {horizon.to || "-"})です。
        </p>

        <SlotPatternFields value={pattern} onChange={setPattern} />

        <p className="slot-generate__preview">
          {existing.isLoading
            ? "既存の枠を確認しています..."
            : `新しく作る枠: ${preview.length} 件(既存 ${existing.slots.length} 件はそのまま)`}
        </p>

        <div className="slot-generate__actions">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generateSlotsMutation.isPending || existing.isLoading}
          >
            {generateSlotsMutation.isPending ? "生成中..." : "生成"}
          </button>
          <button type="button" onClick={onClose} disabled={generateSlotsMutation.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
