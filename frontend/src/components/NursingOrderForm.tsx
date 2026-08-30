import { useEffect, useRef, useState, type FormEvent } from "react";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import { useNursingActModifiers } from "../api/masterQueries";
import { useFacilitySettings } from "../api/queries";
import {
  DAY_OF_WEEK_OPTIONS,
  DEFAULT_NURSING_SCHEDULE,
  NURSING_SCHEDULE_PRESETS,
  presetValueOf,
  type NursingScheduleSettings,
  type NursingScheduleValues,
} from "../fhir/nursingScheduleHelpers";
import {
  nursingActLevel3Code,
  emptyNursingOrderLine,
  validateNursingOrderForm,
  type NursingItemRef,
  type NursingOrderFormValues,
  type NursingOrderLineValues,
} from "../fhir/nursingOrderHelpers";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { ErrorBanner } from "./ErrorBanner";
import { NursingItemSearchModal } from "./NursingItemSearchModal";
import { ProblemSelect } from "./ProblemSelect";

interface Props {
  patientId: string;
  initialValues: NursingOrderFormValues;
  /** 編集は 1 行だけ(行の追加・削除を出さない)。 */
  singleLine?: boolean;
  onSubmit: (values: NursingOrderFormValues) => void;
  submitting: boolean;
  submitError: unknown;
  submitLabel?: string;
}

// 看護指示の入力。1 回の登録で複数行(安静度・清潔・観察…)をまとめて出せるよう、
// 行を足していく表の形にする。各行は保存時に別々の ServiceRequest になる。
export function NursingOrderForm({
  patientId,
  initialValues,
  singleLine = false,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: Props) {
  const [values, setValues] = useState<NursingOrderFormValues>(initialValues);
  const [validationError, setValidationError] = useState("");
  const [picking, setPicking] = useState<number | null>(null);
  const problemOptions = useProblemOptions(patientId);
  const validationErrorRef = useRef<HTMLDivElement>(null);
  // 「1日N回」の既定時刻。読めていない間は既定値で組む(選び直せば設定値が入る)。
  const facility = useFacilitySettings();
  const scheduleSettings = facility.data?.nursing_schedule ?? DEFAULT_NURSING_SCHEDULE;

  useEffect(() => {
    if (validationError) validationErrorRef.current?.scrollIntoView({ block: "nearest" });
  }, [validationError]);

  function updateLine(index: number, patch: Partial<NursingOrderLineValues>) {
    setValues((prev) => ({
      ...prev,
      lines: prev.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  }

  function addLine() {
    setValues((prev) => {
      // 開始日は直前の行に合わせる(同じ日付を何度も入れ直さないため)。
      const last = prev.lines[prev.lines.length - 1];
      const line = emptyNursingOrderLine();
      if (last) line.startDate = last.startDate;
      return { ...prev, lines: [...prev.lines, line] };
    });
  }

  function removeLine(index: number) {
    setValues((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }));
  }

  function handlePicked(index: number, item: NursingItemRef, display: string) {
    // マスタから選んだら文言も用語名で埋める(自由記載なら空のまま入力してもらう)。
    updateLine(index, { item, ...(display ? { text: display } : {}) });
    setPicking(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateNursingOrderForm(values);
    setValidationError(error);
    if (error) return;
    onSubmit({ ...values, problem: refreshProblemDisplay(values.problem, problemOptions) });
  }

  return (
    // 用語検索モーダルは <form> の外に出す。Modal はポータルではないので、中に置くと
    // モーダル内の検索フォームが入れ子の <form> になり、検索ボタンで外側の指示登録
    // フォームがネイティブ送信されてしまう(処置・生理のオーダー画面と同じ作り)。
    <>
      <form className="prescription-form" onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert" ref={validationErrorRef}>
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={submitError} />

        <fieldset>
          <legend>指示</legend>
          <div className="nursing-order-form__lines">
            {values.lines.map((line, index) => (
              <div key={index} className="nursing-order-form__line">
                <div className="nursing-order-form__line-head">
                  <span className="nursing-order-form__line-no">{index + 1}</span>
                  <button type="button" onClick={() => setPicking(index)}>
                    {line.item ? "用語を変更" : "用語を選択"}
                  </button>
                  <span className="nursing-order-form__item">
                    {line.item
                      ? `${line.item.kind === "act" ? "行為" : "観察"}: ${line.item.display}`
                      : "自由記載"}
                  </span>
                  {line.item && (
                    <button type="button" onClick={() => updateLine(index, { item: null })}>
                      用語を外す
                    </button>
                  )}
                  {line.item?.kind === "act" && (
                    <NursingModifierSelect
                      item={line.item}
                      onChange={(item, display) => updateLine(index, { item, text: display })}
                    />
                  )}
                  {!singleLine && values.lines.length > 1 && (
                    <button type="button" onClick={() => removeLine(index)}>
                      行を削除
                    </button>
                  )}
                </div>
                <label>
                  指示内容
                  <input
                    type="text"
                    value={line.text}
                    onChange={(e) => updateLine(index, { text: e.target.value })}
                    placeholder="例: 車椅子移送、SpO2 測定"
                  />
                </label>
                <NursingScheduleFields
                  schedule={line.schedule}
                  settings={scheduleSettings}
                  onChange={(schedule) => updateLine(index, { schedule })}
                />
                <label>
                  条件
                  <input
                    type="text"
                    value={line.condition}
                    onChange={(e) => updateLine(index, { condition: e.target.value })}
                    placeholder="例: 38℃以上で報告、疼痛時"
                  />
                </label>
                <div className="nursing-order-form__dates">
                  <label>
                    開始日
                    <input
                      type="date"
                      value={line.startDate}
                      onChange={(e) => updateLine(index, { startDate: e.target.value })}
                      required
                    />
                  </label>
                  <label>
                    終了日
                    <input
                      type="date"
                      value={line.endDate}
                      onChange={(e) => updateLine(index, { endDate: e.target.value })}
                    />
                  </label>
                </div>
                <label>
                  備考
                  <input
                    type="text"
                    value={line.comment}
                    onChange={(e) => updateLine(index, { comment: e.target.value })}
                  />
                </label>
              </div>
            ))}
          </div>
          {!singleLine && (
            <button type="button" onClick={addLine}>
              行を追加
            </button>
          )}
        </fieldset>

        <fieldset>
          <legend>対象</legend>
          <label>
            対象プロブレム
            <ProblemSelect
              value={values.problem}
              options={problemOptions}
              onChange={(problem) => setValues((prev) => ({ ...prev, problem }))}
            />
          </label>
        </fieldset>

        <div className="prescription-form__actions">
          <button type="submit" disabled={submitting}>
            {submitting ? "送信中..." : submitLabel}
          </button>
        </div>
      </form>

      {picking !== null && (
        <NursingItemSearchModal
          onSelect={(item, display) => handlePicked(picking, item, display)}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  );
}

/**
 * 修飾語(第 4 階層)の選択。用語選択モーダルは行為(第 3 階層)までを出し、
 * その行為が持つ修飾語はここで選び直す(選ぶたびに 16 桁コードと管理番号が変わる)。
 * 修飾語を持たない行為ではセレクトを出さない。
 */
function NursingModifierSelect({
  item,
  onChange,
}: {
  item: Extract<NursingItemRef, { kind: "act" }>;
  onChange: (item: NursingItemRef, display: string) => void;
}) {
  const level3Code = nursingActLevel3Code(item.code16);
  const modifiers = useNursingActModifiers(level3Code);
  const rows = modifiers.data?.items ?? [];
  // 修飾語なし(D000)しか無い行為ではセレクトを出す意味がない。
  const hasModifiers = rows.some((row) => row.level4_name);
  if (!hasModifiers) return null;

  return (
    <label className="nursing-order-form__modifier">
      修飾語
      <select
        value={item.code16}
        onChange={(e) => {
          const row = rows.find((r) => r.code_16 === e.target.value);
          if (!row) return;
          const display = [row.level3_name, row.level4_name].filter(Boolean).join(" ");
          onChange(
            { kind: "act", code16: row.code_16, manageNo: row.manage_no, display },
            display,
          );
        }}
      >
        {rows.map((row) => (
          <option key={row.code_16} value={row.code_16}>
            {row.level4_name || "(修飾語なし)"}
          </option>
        ))}
        {/* マスタから消えた修飾語でも、保存済みの選択を失わせない。 */}
        {!rows.some((r) => r.code_16 === item.code16) && (
          <option value={item.code16}>{item.display} (無効)</option>
        )}
      </select>
    </label>
  );
}

/**
 * 頻度の入力。select で型を選び、型ごとに時刻を微調整する。「1日N回」の初期時刻は
 * 施設設定から入れ、指示に焼き付ける(あとで設定を変えても指示は動かない)。
 */
function NursingScheduleFields({
  schedule,
  settings,
  onChange,
}: {
  schedule: NursingScheduleValues;
  settings: NursingScheduleSettings;
  onChange: (schedule: NursingScheduleValues) => void;
}) {
  const presetValue = presetValueOf(schedule);

  function handlePresetChange(value: string) {
    const preset = NURSING_SCHEDULE_PRESETS.find((p) => p.value === value);
    onChange(preset ? preset.make(settings) : null);
  }

  function updateTimes(times: string[]) {
    if (!schedule) return;
    if (schedule.kind === "daily") onChange({ ...schedule, times, timesPerDay: times.length });
    else if (schedule.kind === "times") onChange({ ...schedule, times });
  }

  return (
    <div className="nursing-order-form__schedule">
      <label>
        頻度
        <select value={presetValue} onChange={(e) => handlePresetChange(e.target.value)}>
          {NURSING_SCHEDULE_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>

      {schedule && (schedule.kind === "daily" || schedule.kind === "times") && (
        <span className="nursing-order-form__times">
          {schedule.times.map((time, index) => (
            <span key={index} className="nursing-order-form__time">
              <input
                type="time"
                value={time}
                onChange={(e) => {
                  const times = [...schedule.times];
                  times[index] = e.target.value;
                  updateTimes(times);
                }}
                aria-label={`${index + 1} 回目の時刻`}
              />
              {schedule.kind === "times" && schedule.times.length > 1 && (
                <button
                  type="button"
                  onClick={() => updateTimes(schedule.times.filter((_, i) => i !== index))}
                  aria-label="この時刻を削除"
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {schedule.kind === "times" && (
            <button type="button" onClick={() => updateTimes([...schedule.times, ""])}>
              時刻を追加
            </button>
          )}
        </span>
      )}

      {schedule?.kind === "interval" && (
        <label className="nursing-order-form__inline">
          起点
          <input
            type="time"
            value={schedule.start}
            onChange={(e) => onChange({ ...schedule, start: e.target.value })}
          />
        </label>
      )}

      {schedule?.kind === "weekly" && (
        <span className="nursing-order-form__times">
          {DAY_OF_WEEK_OPTIONS.map((day) => (
            <label key={day.code} className="nursing-order-form__day">
              <input
                type="checkbox"
                checked={schedule.days.includes(day.code)}
                onChange={(e) => {
                  const days = e.target.checked
                    ? [...schedule.days, day.code]
                    : schedule.days.filter((d) => d !== day.code);
                  onChange({ ...schedule, days, perWeek: Math.max(days.length, 1) });
                }}
              />
              {day.label}
            </label>
          ))}
          <label className="nursing-order-form__inline">
            時刻
            <input
              type="time"
              value={schedule.time}
              onChange={(e) => onChange({ ...schedule, time: e.target.value })}
            />
          </label>
        </span>
      )}
    </div>
  );
}
