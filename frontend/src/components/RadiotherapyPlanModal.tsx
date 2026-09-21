import { useMemo, useState, type FormEvent } from "react";
import { radiotherapyDeviceHooks } from "../api/masterQueries";
import { useRegisterRadiotherapyPlan, useRescheduleRadiotherapyFraction } from "../api/queries";
import { summarizeRadiotherapyOrder } from "../fhir/radiotherapyOrderHelpers";
import {
  buildRadiotherapyPlanBundle,
  draftRadiotherapyPlan,
  emptyRadiotherapyPlanOptions,
  radiotherapyProgress,
  type RadiotherapyFractionDisplay,
  type RadiotherapyPlanOptions,
  type RadiotherapyPlanRow,
} from "../fhir/radiotherapyResultHelpers";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 照射予定の一括登録(docs/radiotherapy-order-design.md §7)。
//
// 処方の回数から、照射済みの回と登録済みの予定を引いた残りを、Phase の順に指定の曜日へ
// 1 日 1 回ずつ割り付ける。祝日や装置の点検日は知らないので、割り付けた日付は表で直せ、
// 行ごとに外せる。登録すると 1 回 = Procedure(status=preparation)1 件ができ、カレンダーの
// 装置の列に並ぶ。

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

interface PlanProps {
  order: fhir4.ServiceRequest;
  fractions: RadiotherapyFractionDisplay[];
  patientName?: string;
  onClose: () => void;
}

export function RadiotherapyPlanModal({ order, fractions, patientName, onClose }: PlanProps) {
  const register = useRegisterRadiotherapyPlan();
  const devices = radiotherapyDeviceHooks.useOptions();
  const summary = useMemo(() => summarizeRadiotherapyOrder(order), [order]);
  const progress = useMemo(() => radiotherapyProgress(summary, fractions), [summary, fractions]);

  const [options, setOptions] = useState<RadiotherapyPlanOptions>(() => {
    // 既に予定や実績があれば、その最後の日の翌日から続ける。
    const last = fractions.map((f) => f.performedDate).sort().pop();
    const start = summary.startDate > today() ? summary.startDate : today();
    const base = emptyRadiotherapyPlanOptions(last && last >= start ? nextDay(last) : start);
    const device = summary.phases.find((p) => p.deviceName);
    return device ? { ...base, device: { code: device.deviceCode, name: device.deviceName } } : base;
  });
  // 表で直した日付と、外した行。条件を変えて割り付け直したら捨てる。
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const drafted = useMemo(
    () => draftRadiotherapyPlan(summary, fractions, options),
    [summary, fractions, options],
  );
  const rows: RadiotherapyPlanRow[] = drafted
    .filter((row) => !removed.has(row.key))
    .map((row) => ({ ...row, date: edits[row.key] ?? row.date }));

  function changeOptions(patch: Partial<RadiotherapyPlanOptions>) {
    setOptions((current) => ({ ...current, ...patch }));
    setEdits({});
    setRemoved(new Set());
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (rows.length === 0) return;
    register.mutate(buildRadiotherapyPlanBundle(rows, options, order), { onSuccess: onClose });
  }

  return (
    <Modal
      title={`照射予定の一括登録${patientName ? ` - ${patientName}` : ""}`}
      onClose={onClose}
      className="modal--wide"
    >
      <form className="prescription-form" onSubmit={handleSubmit}>
        <ErrorBanner error={register.error} />

        <fieldset>
          <legend>治療コース</legend>
          <dl className="prescription-detail__common">
            <dt>処方</dt>
            <dd>
              第{summary.courseNumber}コース {summary.siteLabel} {summary.doseLabel}
            </dd>
            <dt>これまで</dt>
            <dd>
              照射 {progress.fractionLabel}、予定 {progress.planned} 回
            </dd>
          </dl>
        </fieldset>

        <fieldset>
          <legend>割り付け</legend>
          <label>
            開始日 *
            <input
              type="date"
              value={options.startDate}
              onChange={(e) => changeOptions({ startDate: e.target.value })}
              required
            />
          </label>
          <label>
            開始時刻 *
            <input
              type="time"
              value={options.startTime}
              onChange={(e) => setOptions((o) => ({ ...o, startTime: e.target.value }))}
              required
            />
          </label>
          <label>
            所要時間(分) *
            <input
              type="number"
              min={5}
              max={240}
              step={5}
              value={options.durationMinutes}
              onChange={(e) => setOptions((o) => ({ ...o, durationMinutes: e.target.value }))}
              required
            />
          </label>
          <label>
            治療装置
            <select
              value={options.device.code}
              onChange={(e) => {
                const device = devices.items.find((d) => d.code === e.target.value);
                setOptions((o) => ({ ...o, device: { code: e.target.value, name: device?.name ?? "" } }));
              }}
            >
              <option value=""></option>
              {devices.items.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <div className="radiotherapy-plan__weekdays" role="group" aria-label="照射する曜日">
            {WEEKDAYS.map((label, weekday) => (
              <label key={label} className="dose-conversion__checkbox">
                <input
                  type="checkbox"
                  checked={options.weekdays.includes(weekday)}
                  onChange={(e) =>
                    changeOptions({
                      weekdays: e.target.checked
                        ? [...options.weekdays, weekday].sort()
                        : options.weekdays.filter((w) => w !== weekday),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>照射予定 ({rows.length} 回)</legend>
          {rows.length === 0 ? (
            <p className="patient-table__empty">
              {drafted.length === 0
                ? "登録する照射予定がありません(処方の回数ぶんが照射済みか、予定済みです)。"
                : "すべての行を外しています。"}
            </p>
          ) : (
            <div className="radiotherapy-plan__table">
              <table className="master-search__table">
                <thead>
                  <tr>
                    <th>照射日</th>
                    <th>曜日</th>
                    <th>Phase</th>
                    <th>回</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td>
                        <input
                          type="date"
                          value={row.date}
                          aria-label={`${row.phaseLabel} ${row.fractionNumber} 回目の照射日`}
                          onChange={(e) => setEdits((c) => ({ ...c, [row.key]: e.target.value }))}
                          required
                        />
                      </td>
                      <td>{WEEKDAYS[new Date(`${row.date}T00:00:00`).getDay()] ?? ""}</td>
                      <td>{row.phaseLabel}</td>
                      <td>{row.fractionNumber}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => setRemoved((c) => new Set([...c, row.key]))}
                        >
                          外す
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </fieldset>

        <div className="prescription-form__actions">
          <button type="submit" disabled={register.isPending || rows.length === 0}>
            {register.isPending ? "登録中..." : `${rows.length} 回ぶんを登録`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 照射予定 1 件の日時・装置の変更。
export function RadiotherapyRescheduleModal({
  fraction,
  patientName,
  onClose,
}: {
  fraction: RadiotherapyFractionDisplay;
  patientName?: string;
  onClose: () => void;
}) {
  const reschedule = useRescheduleRadiotherapyFraction();
  const devices = radiotherapyDeviceHooks.useOptions();
  const [date, setDate] = useState(fraction.performedDate);
  const [startTime, setStartTime] = useState(fraction.startTime);
  const [endTime, setEndTime] = useState(fraction.endTime);
  const [deviceCode, setDeviceCode] = useState(fraction.deviceCode);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const device = devices.items.find((d) => d.code === deviceCode);
    reschedule.mutate(
      {
        procedureId: fraction.id,
        date,
        startTime,
        endTime,
        device: { code: deviceCode, name: device?.name ?? "" },
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title={`予定変更${patientName ? ` - ${patientName}` : ""}`} onClose={onClose}>
      <form className="prescription-form" onSubmit={handleSubmit}>
        <ErrorBanner error={reschedule.error} />
        <fieldset>
          <label>
            照射日 *
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>
            開始時刻
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label>
            終了時刻
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </label>
          <label>
            治療装置
            <select value={deviceCode} onChange={(e) => setDeviceCode(e.target.value)}>
              <option value=""></option>
              {devices.items.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <div className="prescription-form__actions">
          <button type="submit" disabled={reschedule.isPending}>
            {reschedule.isPending ? "保存中..." : "変更"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
