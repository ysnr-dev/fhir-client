import { makeFieldUpdater } from "../lib/form";
import { diffDays } from "../lib/dates";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { Medicine } from "../api/masterClient";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import {
  CATEGORY_OPTIONS,
  DRIP_DEFAULT_ROUTE,
  INFUSION_HOURS_OPTIONS,
  LINE_OPTIONS,
  DAILY_SCHEDULE,
  DAY_OF_WEEK_OPTIONS,
  MAX_INJECTION_ORDERS,
  MAX_INJECTION_SPAN_DAYS,
  injectionDates,
  scheduleLabel,
  METHOD_OPTIONS,
  ROUTE_OPTIONS,
  SITE_OPTIONS,
  USAGE_TYPE_OPTIONS,
  defaultCategory,
  emptyInjectionForm,
  emptyInjectionRp,
  infusionDurationHours,
  infusionEndTime,
  infusionRate,
  methodForRoute,
  rpDoseTotal,
  type InjectionFormValues,
  type InjectionRpValues,
  type InjectionSchedule,
  type InjectionUsageType,
  type RpDoseTotal,
} from "../fhir/injectionHelpers";
import {
  SETTING_OPTIONS,
  emptyMedicineLine,
  type MedicineLineValues,
  type PrescriptionSetting,
} from "../fhir/prescriptionHelpers";
import { presetInjectionUsageType } from "../fhir/usageMapping";
import { useMedicineMlFactors } from "../api/masterQueries";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import { ErrorBanner } from "./ErrorBanner";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { ProblemSelect } from "./ProblemSelect";

// 注射オーダーの入力フォーム。構成は処方(PrescriptionForm)に合わせ、用法だけ
// 注射固有の構造化項目(用法種別・投与経路・部位・手技・ライン・速度・開始時刻)にする。

interface InjectionFormProps {
  patientId: string;
  initialValues?: InjectionFormValues;
  onSubmit: (values: InjectionFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
  /** 編集(1 日分を直す)では投与日数を出さない。 */
  mode?: "create" | "edit";
}

type ModalState = { kind: "medicine"; rpIndex: number; medIndex: number } | null;

// 期間とパターンから展開されるオーダー数。injectionDates は上限で打ち切るので、
// 「上限を超えている」と伝えるために打ち切らずに数え直す(上限 + 1 で止める)。
function countDates(start: string, end: string, schedule: InjectionSchedule): number {
  if (!start || !end || end < start) return 1;
  const span = Math.min(diffDays(start, end), MAX_INJECTION_SPAN_DAYS);
  let count = 0;
  for (let i = 0; i <= span; i++) {
    if (schedule.kind === "interval") {
      if (i % Math.max(Math.trunc(schedule.intervalDays) || 1, 1) !== 0) continue;
    } else if (schedule.kind === "weekly") {
      const [y, m, d] = start.split("-").map(Number);
      const date = new Date(y, m - 1, d + i);
      if (!schedule.days.includes(DAY_OF_WEEK_OPTIONS[(date.getDay() + 6) % 7].code)) continue;
    }
    count++;
    if (count > MAX_INJECTION_ORDERS) break;
  }
  return count || 1;
}

// 総投与量。端数が出るのは濃度からの換算だけなので小数第 1 位まで出す。
function formatMl(ml: number): string {
  return (Math.round(ml * 10) / 10).toLocaleString();
}

/** 曜日指定に切り替えたときの初期選択(注射日の曜日)。 */
function defaultWeekday(date: string): string {
  if (!date) return DAY_OF_WEEK_OPTIONS[0].code;
  const [y, m, d] = date.split("-").map(Number);
  return DAY_OF_WEEK_OPTIONS[(new Date(y, m - 1, d).getDay() + 6) % 7].code;
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4M6.5 6.5v5M9.5 6.5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function InjectionForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
  mode = "create",
}: InjectionFormProps) {
  const [values, setValues] = useState<InjectionFormValues>(initialValues ?? emptyInjectionForm);
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [modal, setModal] = useState<ModalState>(null);
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));
  const [usageCommentOpen, setUsageCommentOpen] = useState<boolean[]>(() =>
    (initialValues ?? emptyInjectionForm()).rps.map((rp) => Boolean(rp.usageComment)),
  );
  // 用法種別を手で選んだ RP。以降は医薬品を変えても自動で書き換えない
  // (保存済みの注射を開いた場合も、登録時の選択を勝手に変えないよう選択済み扱いにする)。
  const [usageTypeTouched, setUsageTypeTouched] = useState<boolean[]>(() =>
    (initialValues ?? emptyInjectionForm()).rps.map((rp) => Boolean(rp.usageType)),
  );

  const problemOptions = useProblemOptions(patientId);

  // 総投与量の計算に使う mL 換算係数。フォーム上の全医薬品分をまとめて引く。
  const { data: mlFactors } = useMedicineMlFactors(
    values.rps.flatMap((rp) =>
      rp.medicines.map((m) => m.medicine?.medicine_code).filter((c): c is string => Boolean(c)),
    ),
  );

  function doseTotalOf(rp: InjectionRpValues): RpDoseTotal {
    return rpDoseTotal(rp.medicines, mlFactors ?? new Map());
  }

  // 投与時間を選んでいる間は投与速度を自動計算で埋める(直接入力は投与時間が空のときだけ)。
  function effectiveRate(rp: InjectionRpValues): string {
    return rp.infusionHours ? infusionRate(doseTotalOf(rp).ml, rp.infusionHours) : rp.rate;
  }

  /** その RP の 1 回ぶんの投与時間(h)。終了時刻の初期値に使う。 */
  function durationOf(rp: InjectionRpValues): number | undefined {
    if (rp.usageType !== "drip") return undefined;
    return infusionDurationHours(rp.infusionHours, doseTotalOf(rp).ml, effectiveRate(rp));
  }

  /** 開始時刻から自動で決まる終了時刻。決められなければ空。 */
  function autoEndOf(rp: InjectionRpValues, startTime: string): string {
    const hours = durationOf(rp);
    return hours === undefined ? "" : infusionEndTime(startTime, hours);
  }

  /**
   * 投与時間・投与速度・投与量を変えたときに、終了時刻を新しい値へ追従させる。
   * 自動で入れた値(変更前の条件での計算結果)のままの行だけを差し替え、
   * 手で直した終了時刻は残す。
   */
  function withRecalculatedEnds(before: InjectionRpValues, after: InjectionRpValues): InjectionRpValues {
    return {
      ...after,
      times: after.times.map((time, index) => {
        const previousAuto = autoEndOf(before, before.times[index]?.start ?? time.start);
        if (time.end && time.end !== previousAuto) return time;
        return { ...time, end: autoEndOf(after, time.start) };
      }),
    };
  }

  const update = makeFieldUpdater(setValues);

  const weekdays = values.schedule.kind === "weekly" ? values.schedule.days : [];

  // 注射日を後ろにずらしたら終了日も連れて動かす(期間が逆転したままにしない)。
  function handleStartDate(date: string) {
    setValues((v) => ({
      ...v,
      startDate: date,
      endDate: !v.endDate || v.endDate < date ? date : v.endDate,
    }));
  }

  // パターンを変えたときは、そのパターンの既定値で入れ直す(隔日・曜日は未選択だと
  // 展開できないので、隔日は 2 日ごと、曜日は注射日の曜日を初期選択にする)。
  function handleScheduleKind(kind: InjectionSchedule["kind"]) {
    if (kind === "interval") update("schedule", { kind, intervalDays: 2 });
    else if (kind === "weekly") update("schedule", { kind, days: [defaultWeekday(values.startDate)] });
    else update("schedule", DAILY_SCHEDULE);
  }

  function toggleWeekday(code: string) {
    const next = weekdays.includes(code)
      ? weekdays.filter((c) => c !== code)
      : DAY_OF_WEEK_OPTIONS.filter((o) => o.code === code || weekdays.includes(o.code)).map(
          (o) => o.code,
        );
    update("schedule", { kind: "weekly", days: next });
  }

  const expansionNote = (() => {
    if (!values.startDate) return "";
    const dates = injectionDates(values);
    const count = countDates(values.startDate, values.endDate, values.schedule);
    if (count > MAX_INJECTION_ORDERS) {
      return `${scheduleLabel(values.schedule)}: ${MAX_INJECTION_ORDERS}件を超えます。期間を短くしてください。`;
    }
    // 1 件だけ(単日)のときは注射日を見れば分かるので何も出さない。
    if (dates.length <= 1) return "";
    return `${scheduleLabel(values.schedule)}: ${dates[dates.length - 1]} まで ${dates.length} 件のオーダーを登録します(${dates
      .slice(0, 5)
      .map((d) => d.slice(5).replace("-", "/"))
      .join("、")}${dates.length > 5 ? "…" : ""})`;
  })();

  // 注射区分の選択肢は入外区分で変わるので選び直させる。外来のように選択肢が
  // 1 つしかないときは既定値を入れておく。
  function handleSettingChange(setting: PrescriptionSetting) {
    setValues((v) => ({ ...v, setting, category: defaultCategory(setting) }));
  }

  /** 投与時間の元になる項目。これらが変わったら終了時刻を計算し直す。 */
  const DURATION_KEYS = ["usageType", "rate", "infusionHours"] as const;

  function updateRp(rpIndex: number, patch: Partial<InjectionRpValues>) {
    const touchesDuration = DURATION_KEYS.some((key) => key in patch);
    setValues((v) => ({
      ...v,
      rps: v.rps.map((rp, i) => {
        if (i !== rpIndex) return rp;
        const next = { ...rp, ...patch };
        return touchesDuration ? withRecalculatedEnds(rp, next) : next;
      }),
    }));
  }

  function updateMedicine(rpIndex: number, medIndex: number, patch: Partial<MedicineLineValues>) {
    setValues((v) => ({
      ...v,
      rps: v.rps.map((rp, i) => {
        if (i !== rpIndex) return rp;
        // 投与量が変われば総投与量が変わり、投与時間(= 終了時刻)も動く。
        const next = {
          ...rp,
          medicines: rp.medicines.map((m, j) => (j === medIndex ? { ...m, ...patch } : m)),
        };
        return withRecalculatedEnds(rp, next);
      }),
    }));
  }

  // 用法種別の変更に伴う付随項目。ワンショットに投与速度は無いので値を落とし、点滴なら
  // 投与経路の既定(静脈内)を入れる。投与経路は選択済みなら上書きしないので、
  // 手で選んだ経路が医薬品の入れ替えで戻ることはない。
  function usageTypePatch(
    rp: InjectionRpValues,
    usageType: InjectionUsageType | "",
  ): Partial<InjectionRpValues> {
    // ワンショットは一瞬で終わるので、終了時刻も落とす。
    if (usageType !== "drip") {
      return {
        usageType,
        rate: "",
        infusionHours: "",
        times: rp.times.map((time) => ({ ...time, end: "" })),
      };
    }
    return { usageType, ...(rp.routeCode ? {} : { routeCode: DRIP_DEFAULT_ROUTE }) };
  }

  // 医薬品の増減・入れ替え。用法種別を手で選んでいない RP は、医薬品の包装から推定した
  // 既定値に追従させる(輸液を足せば点滴、外せばワンショットに戻る)。
  function updateRpMedicines(
    rpIndex: number,
    updater: (medicines: MedicineLineValues[]) => MedicineLineValues[],
  ) {
    const touched = usageTypeTouched[rpIndex];
    setValues((v) => ({
      ...v,
      rps: v.rps.map((rp, i) => {
        if (i !== rpIndex) return rp;
        const medicines = updater(rp.medicines);
        if (touched) return { ...rp, medicines };
        const preset = presetInjectionUsageType(medicines.map((m) => m.medicine));
        return withRecalculatedEnds(rp, { ...rp, medicines, ...usageTypePatch(rp, preset) });
      }),
    }));
  }

  function addRp() {
    setValues((v) => ({
      ...v,
      rps: [...v.rps, { ...emptyInjectionRp, startTimes: [], medicines: [{ ...emptyMedicineLine }] }],
    }));
    setUsageCommentOpen((open) => [...open, false]);
    setUsageTypeTouched((touched) => [...touched, false]);
  }

  function removeRp(rpIndex: number) {
    setValues((v) => ({ ...v, rps: v.rps.filter((_, i) => i !== rpIndex) }));
    setUsageCommentOpen((open) => open.filter((_, i) => i !== rpIndex));
    setUsageTypeTouched((touched) => touched.filter((_, i) => i !== rpIndex));
  }

  function toggleUsageComment(rpIndex: number, open: boolean) {
    setUsageCommentOpen((prev) => prev.map((v, i) => (i === rpIndex ? open : v)));
    if (!open) updateRp(rpIndex, { usageComment: "" });
  }

  function addMedicine(rpIndex: number) {
    const rp = values.rps[rpIndex];
    if (rp.medicines.some((m) => !m.medicine)) {
      setValidationError("医薬品が未選択のレコードがあります。選択してから追加してください。");
      return;
    }
    setValidationError(null);
    const newMedIndex = rp.medicines.length;
    setValues((v) => ({
      ...v,
      rps: v.rps.map((r, i) =>
        i === rpIndex ? { ...r, medicines: [...r.medicines, { ...emptyMedicineLine }] } : r,
      ),
    }));
    setModal({ kind: "medicine", rpIndex, medIndex: newMedIndex });
  }

  function removeMedicine(rpIndex: number, medIndex: number) {
    updateRpMedicines(rpIndex, (medicines) => medicines.filter((_, j) => j !== medIndex));
  }

  function handleMedicineSelect(medicine: Medicine) {
    if (modal?.kind !== "medicine") return;
    const { rpIndex, medIndex } = modal;
    updateRpMedicines(rpIndex, (medicines) =>
      medicines.map((m, j) => (j === medIndex ? { ...m, medicine } : m)),
    );
    setModal(null);
  }

  function addTime(rpIndex: number) {
    updateRp(rpIndex, { times: [...values.rps[rpIndex].times, { start: "", end: "" }] });
  }

  /** 開始時刻。自動で入れた終了時刻はいっしょに動かし、手で直したものは残す。 */
  function updateStartTime(rpIndex: number, timeIndex: number, value: string) {
    const rp = values.rps[rpIndex];
    updateRp(rpIndex, {
      times: rp.times.map((time, i) => {
        if (i !== timeIndex) return time;
        const wasAuto = !time.end || time.end === autoEndOf(rp, time.start);
        return { start: value, end: wasAuto ? autoEndOf(rp, value) : time.end };
      }),
    });
  }

  function updateEndTime(rpIndex: number, timeIndex: number, value: string) {
    updateRp(rpIndex, {
      times: values.rps[rpIndex].times.map((time, i) =>
        i === timeIndex ? { ...time, end: value } : time,
      ),
    });
  }

  function removeTime(rpIndex: number, timeIndex: number) {
    updateRp(rpIndex, {
      times: values.rps[rpIndex].times.filter((_, i) => i !== timeIndex),
    });
  }

  function validate(): string | null {
    if (!values.startDate) return "注射日は必須です。";
    if (mode === "create") {
      if (!values.endDate) return "終了日は必須です。";
      if (values.endDate < values.startDate) return "終了日は注射日以降にしてください。";
      if (diffDays(values.startDate, values.endDate) > MAX_INJECTION_SPAN_DAYS) {
        return `期間は${MAX_INJECTION_SPAN_DAYS}日までです。`;
      }
      if (values.schedule.kind === "interval") {
        const n = values.schedule.intervalDays;
        if (!Number.isInteger(n) || n < 2) return "間隔は2以上の整数で入力してください。";
      }
      if (values.schedule.kind === "weekly" && values.schedule.days.length === 0) {
        return "曜日を1つ以上選択してください。";
      }
      // 展開数の上限を超えるときは、黙って打ち切らず期間を縮めてもらう。
      const span = diffDays(values.startDate, values.endDate);
      const wanted = countDates(values.startDate, values.endDate, values.schedule);
      if (wanted > MAX_INJECTION_ORDERS) {
        return `一度に登録できるのは${MAX_INJECTION_ORDERS}件までです(いまの指定は${wanted}件${
          span > MAX_INJECTION_SPAN_DAYS ? "以上" : ""
        })。期間を短くしてください。`;
      }
    }
    if (!values.setting) return "入外区分は必須です。";
    if (!values.category) return "注射区分は必須です。";
    if (values.rps.length === 0) return "RPを1件以上登録してください。";

    for (let i = 0; i < values.rps.length; i++) {
      const rp = values.rps[i];
      const rpLabel = `RP${i + 1}`;
      if (!rp.usageType) return `${rpLabel}: 用法種別を選択してください。`;
      if (!rp.routeCode) return `${rpLabel}: 投与経路を選択してください。`;
      const rate = effectiveRate(rp);
      if (rp.usageType === "drip" && rate && Number(rate) <= 0) {
        return `${rpLabel}: 投与速度は正の数値で入力してください。`;
      }
      if (rp.usageType === "drip" && rp.infusionHours && !rate) {
        return `${rpLabel}: 総投与量を mL 換算できないため投与速度を計算できません。投与時間の選択を外して直接入力してください。`;
      }
      if (rp.times.some((t) => !t.start)) {
        return `${rpLabel}: 開始時刻が未入力の行があります。入力するか削除してください。`;
      }
      if (rp.medicines.length === 0) return `${rpLabel}: 医薬品を1件以上登録してください。`;
      for (let j = 0; j < rp.medicines.length; j++) {
        const med = rp.medicines[j];
        if (!med.medicine) return `${rpLabel}: 医薬品を選択してください。`;
        if (!med.dose || Number(med.dose) <= 0) return `${rpLabel}: 投与量を入力してください。`;
      }
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validate();
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    // 投与時間から計算した投与速度を確定値として保存する(投与時間そのものは保存しない)。
    onSubmit({
      ...values,
      problem: refreshProblemDisplay(values.problem, problemOptions),
      rps: values.rps.map((rp) => ({ ...rp, rate: effectiveRate(rp) })),
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // input 上での Enter による暗黙の form submit を抑止する(処方フォームと同じ)。
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
    }
  }

  return (
    <form className="prescription-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <fieldset>
        <legend>注射共通</legend>
        <label>
          対象プロブレム
          <ProblemSelect
            value={values.problem}
            options={problemOptions}
            onChange={(problem) => update("problem", problem)}
          />
        </label>
        <label>
          入外区分
          <select
            value={values.setting}
            onChange={(e) => handleSettingChange(e.target.value as PrescriptionSetting)}
          >
            <option value="">選択してください</option>
            {SETTING_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          注射区分
          <select value={values.category} onChange={(e) => update("category", e.target.value)}>
            <option value="">選択してください</option>
            {values.setting &&
              CATEGORY_OPTIONS[values.setting].map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
          </select>
        </label>
        <label>
          注射日
          <input
            type="date"
            value={values.startDate}
            onChange={(e) => handleStartDate(e.target.value)}
          />
        </label>
        {mode === "create" && (
          <>
            <label>
              終了日
              <input
                type="date"
                value={values.endDate}
                min={values.startDate}
                onChange={(e) => update("endDate", e.target.value)}
              />
            </label>
            <label>
              実施パターン
              <select
                value={values.schedule.kind}
                onChange={(e) => handleScheduleKind(e.target.value as InjectionSchedule["kind"])}
              >
                <option value="daily">毎日</option>
                <option value="interval">N日ごと</option>
                <option value="weekly">曜日指定</option>
              </select>
            </label>
            {values.schedule.kind === "interval" && (
              <label>
                間隔
                <span className="injection-days">
                  <input
                    type="number"
                    min={2}
                    step={1}
                    value={values.schedule.intervalDays}
                    onChange={(e) =>
                      update("schedule", { kind: "interval", intervalDays: Number(e.target.value) })
                    }
                  />
                  <span className="injection-days__unit">日ごと</span>
                </span>
              </label>
            )}
            {values.schedule.kind === "weekly" && (
              <fieldset className="injection-weekdays">
                <legend>曜日</legend>
                {DAY_OF_WEEK_OPTIONS.map((o) => (
                  <label key={o.code} className="injection-weekdays__option">
                    <input
                      type="checkbox"
                      checked={weekdays.includes(o.code)}
                      onChange={() => toggleWeekday(o.code)}
                    />
                    {o.label}
                  </label>
                ))}
              </fieldset>
            )}
            {/* 複数日に展開されるときだけ、何日にいくつ立つのかを登録前に見せる。 */}
            {expansionNote && <p className="injection-days__note">{expansionNote}</p>}
          </>
        )}
        {commentOpen ? (
          <div className="prescription-form__comment-field">
            <label>
              注射コメント
              <input
                type="text"
                value={values.comment}
                onChange={(e) => update("comment", e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rp-card__icon-button"
              title="注射コメントを削除"
              aria-label="注射コメントを削除"
              onClick={() => {
                setCommentOpen(false);
                update("comment", "");
              }}
            >
              <TrashIcon />
            </button>
          </div>
        ) : (
          <div className="prescription-form__comment-toggle">
            <button type="button" className="comment-add-button" onClick={() => setCommentOpen(true)}>
              ＋注射コメント
            </button>
          </div>
        )}
      </fieldset>

      {values.rps.map((rp, rpIndex) => {
        const doseTotal = doseTotalOf(rp);
        return (
        <fieldset className="rp-card" key={rpIndex}>
          <legend>{`RP${rpIndex + 1}`}</legend>

          <table className="rp-card__medicines rp-card__medicines--form">
            <colgroup>
              <col />
              <col style={{ width: "88px" }} />
              <col style={{ width: "60px" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "32px" }} />
            </colgroup>
            <thead>
              <tr>
                <th>医薬品</th>
                <th>投与量</th>
                <th>単位</th>
                <th>薬剤コメント</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rp.medicines.map((med, medIndex) => (
                <tr key={medIndex}>
                  <td>
                    <div className="rp-card__medicine-cell">
                      <button
                        type="button"
                        onClick={() => setModal({ kind: "medicine", rpIndex, medIndex })}
                      >
                        {med.medicine ? "変更" : "選択"}
                      </button>
                      {med.medicine ? (
                        <span className="rp-card__medicine-name">{med.medicine.name}</span>
                      ) : (
                        <span className="rp-card__usage-value--empty">未選択</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      className="rp-card__dose-input"
                      value={med.dose}
                      onChange={(e) => updateMedicine(rpIndex, medIndex, { dose: e.target.value })}
                    />
                  </td>
                  <td className="rp-card__medicine-unit">{med.medicine?.unit_name ?? "-"}</td>
                  <td>
                    <input
                      type="text"
                      value={med.comment}
                      onChange={(e) => updateMedicine(rpIndex, medIndex, { comment: e.target.value })}
                    />
                  </td>
                  <td>
                    {rp.medicines.length > 1 && (
                      <button
                        type="button"
                        className="rp-card__icon-button"
                        title="この医薬品を削除"
                        aria-label="この医薬品を削除"
                        onClick={() => removeMedicine(rpIndex, medIndex)}
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="rp-card__actions rp-card__actions--between">
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => addMedicine(rpIndex)}
            >
              + 医薬品追加
            </button>
            {/* 総投与量は投与速度を使わない場合(ワンショット等)でも常に出す。 */}
            <span className="injection-total">
              <span className="injection-total__label">総投与量</span>
              <span className="injection-total__value">
                {doseTotal.ml ? `${formatMl(doseTotal.ml)} mL` : "-"}
              </span>
              {doseTotal.unconvertible > 0 && (
                <span className="injection-total__note">
                  {`(${doseTotal.unconvertible}件はmL換算できないため含みません)`}
                </span>
              )}
            </span>
          </div>

          <div className="injection-usage">
            <label>
              用法種別
              <select
                value={rp.usageType}
                onChange={(e) => {
                  setUsageTypeTouched((prev) => prev.map((t, i) => (i === rpIndex ? true : t)));
                  updateRp(rpIndex, usageTypePatch(rp, e.target.value as InjectionUsageType | ""));
                }}
              >
                <option value="">選択してください</option>
                {USAGE_TYPE_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
            <label>
              投与経路
              <select
                value={rp.routeCode}
                onChange={(e) => {
                  // 手技が経路から一意に決まるものは一緒に選ぶ(methodForRoute 参照)。
                  const routeCode = e.target.value;
                  updateRp(rpIndex, {
                    routeCode,
                    methodCode: methodForRoute(routeCode, rp.methodCode),
                  });
                }}
              >
                <option value="">選択してください</option>
                {ROUTE_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
            <label>
              投与部位
              <select
                value={rp.siteCode}
                onChange={(e) => updateRp(rpIndex, { siteCode: e.target.value })}
              >
                <option value="">指定なし</option>
                {SITE_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
            <label>
              手技
              <select
                value={rp.methodCode}
                onChange={(e) => updateRp(rpIndex, { methodCode: e.target.value })}
              >
                <option value="">指定なし</option>
                {METHOD_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
            <label>
              ライン
              <select
                value={rp.lineCode}
                onChange={(e) => updateRp(rpIndex, { lineCode: e.target.value })}
              >
                <option value="">指定なし</option>
                {LINE_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
            {rp.usageType === "drip" && (
              <>
                <label>
                  投与時間
                  <select
                    value={rp.infusionHours}
                    onChange={(e) =>
                      // 投与時間をやめたら、それまでの計算値を直接入力の初期値として残す。
                      updateRp(rpIndex, {
                        infusionHours: e.target.value,
                        ...(e.target.value ? {} : { rate: effectiveRate(rp) }),
                      })
                    }
                  >
                    <option value="">指定なし(速度を直接入力)</option>
                    {INFUSION_HOURS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.display}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  投与速度
                  <span className="injection-usage__rate">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      // 投与時間を選んでいる間は総投与量からの自動計算値を出す。
                      value={effectiveRate(rp)}
                      readOnly={Boolean(rp.infusionHours)}
                      title={
                        rp.infusionHours ? "総投与量と投与時間から自動計算しています" : undefined
                      }
                      onChange={(e) => updateRp(rpIndex, { rate: e.target.value })}
                    />
                    <span className="injection-usage__rate-unit">mL/h</span>
                  </span>
                </label>
              </>
            )}
          </div>

          <div className="injection-start-times">
            <span className="rp-card__usage-label">開始・終了時刻</span>
            {rp.times.map((time, timeIndex) => (
              <div className="injection-start-times__row" key={timeIndex}>
                {/* 日付は注射日を使うので時刻だけを入力する。 */}
                <input
                  type="time"
                  value={time.start}
                  aria-label={`${timeIndex + 1} 回目の開始時刻`}
                  onChange={(e) => updateStartTime(rpIndex, timeIndex, e.target.value)}
                />
                <span className="injection-start-times__separator">〜</span>
                {/* 終了は任意。投与時間・投与速度が入っていれば初期値を自動で入れる。
                    開始以下の時刻は翌日として扱う(夜からの持続点滴)。 */}
                <input
                  type="time"
                  value={time.end}
                  aria-label={`${timeIndex + 1} 回目の終了時刻`}
                  disabled={rp.usageType !== "drip"}
                  onChange={(e) => updateEndTime(rpIndex, timeIndex, e.target.value)}
                />
                {time.end !== "" && time.start !== "" && time.end <= time.start && (
                  <span className="injection-start-times__nextday">翌日</span>
                )}
                <button
                  type="button"
                  className="rp-card__icon-button"
                  title="この時刻を削除"
                  aria-label="この時刻を削除"
                  onClick={() => removeTime(rpIndex, timeIndex)}
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
            <div className="rp-card__actions">
              <button
                type="button"
                className="rp-card__compact-button"
                onClick={() => addTime(rpIndex)}
              >
                + 開始時刻追加
              </button>
            </div>
          </div>

          {usageCommentOpen[rpIndex] ? (
            <div className="rp-card__comment-field">
              <label>
                用法コメント
                <input
                  type="text"
                  value={rp.usageComment}
                  onChange={(e) => updateRp(rpIndex, { usageComment: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="rp-card__icon-button"
                title="用法コメントを削除"
                aria-label="用法コメントを削除"
                onClick={() => toggleUsageComment(rpIndex, false)}
              >
                <TrashIcon />
              </button>
            </div>
          ) : (
            <div className="rp-card__actions">
              <button
                type="button"
                className="comment-add-button"
                onClick={() => toggleUsageComment(rpIndex, true)}
              >
                ＋用法コメント
              </button>
            </div>
          )}

          {values.rps.length > 1 && (
            <div className="rp-card__actions rp-card__actions--end">
              <button
                type="button"
                className="rp-card__icon-button"
                title={`RP${rpIndex + 1}を削除`}
                aria-label={`RP${rpIndex + 1}を削除`}
                onClick={() => removeRp(rpIndex)}
              >
                <TrashIcon />
              </button>
            </div>
          )}
        </fieldset>
        );
      })}

      <div className="prescription-form__actions">
        <button type="button" onClick={addRp}>
          + RP追加
        </button>
      </div>

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>

      {modal?.kind === "medicine" && (
        <MedicineSearchModal
          // 注射オーダーなので注射薬(剤形区分4)を初期絞り込みにする。
          dosageForm="4"
          onSelect={handleMedicineSelect}
          onClose={() => setModal(null)}
        />
      )}
    </form>
  );
}
