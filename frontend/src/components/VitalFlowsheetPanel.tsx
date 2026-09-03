import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  usePatientEncounterEvents,
  usePatientExamOrders,
  usePatientInjectionOrders,
  usePatientMealIntake,
  usePatientNursingFlowsheet,
  usePatientSurgeryPerforms,
  useFacilitySettings,
  useVitalFlowsheet,
  useVitalThresholds,
} from "../api/queries";
import { buildInjectionRows } from "../fhir/flowsheetInjectionHelpers";
import {
  buildMealIntakeRows,
  mealIntakeLabel,
  mealIntakeSlotLabel,
  type MealIntakeKind,
  type MealIntakeSlot,
} from "../fhir/flowsheetMealHelpers";
import { mealOrderDietRef } from "../fhir/mealOrderHelpers";
import { buildNursingRows } from "../fhir/flowsheetNursingHelpers";
import {
  EMPTY_WATER_BALANCE,
  buildWaterBalance,
  waterBalanceLabel,
} from "../fhir/flowsheetWaterBalanceHelpers";
import { DEFAULT_NURSING_SCHEDULE } from "../fhir/nursingScheduleHelpers";
import { useFastingDietCodes, useMedicineMlFactors } from "../api/masterQueries";
import { injectionPerformsByOrderId } from "../fhir/injectionPerformHelpers";
import { injectionTasksByOrderId } from "../fhir/injectionTaskHelpers";
import { referenceId } from "../fhir/shared";
import {
  buildExamRows,
  buildFlowsheetEvents,
  flowsheetEventAtLabel,
  flowsheetEventRangeLabel,
  groupFlowsheetEventsByDay,
  hospitalDayLabel,
  hospitalDayOf,
  localDateOf,
  markKey,
  markModalEvents,
  postOpDayLabel,
  postOpDayOf,
  type FlowsheetEvent,
  type FlowsheetEventGroup,
  type FlowsheetMark,
  type FlowsheetMarkRow,
} from "../fhir/flowsheetEventHelpers";
import { interpretationClass } from "../fhir/labResultHelpers";
import type { KarteDetailTarget } from "../karteUrl";
import {
  formatFlowsheetView,
  parseFlowsheetView,
  type FlowsheetView,
} from "../karteUrl";
import { addDays, toDateTimeInputValue, today } from "../lib/dates";
import { FlowsheetEventModal } from "./FlowsheetEventModal";
import { InjectionPerformModal } from "./InjectionPerformModal";
import { MealIntakeModal } from "./MealIntakeModal";
import { NursingPerformModal } from "./NursingPerformModal";
import {
  BLOOD_PRESSURE_SERIES,
  bloodPressureNumbers,
  buildVitalFlowsheet,
  flowsheetColumnLabel,
  flowsheetDayLabel,
  vitalInterpretationOf,
  type VitalFlowsheetRow,
  type VitalInterpretation,
  type VitalThresholdSettings,
} from "../fhir/vitalHelpers";
import { ErrorBanner } from "./ErrorBanner";

// バイタルの経過表(POMR のフローシート)。読み取り専用で、編集はカルテの
// バイタルカードから行う(編集の導線を 2 つ持つと同期の負債になるため)。
//
// 横軸は**基準日から 1 週間**(左が古く、右端が基準日)。1 日の中は測定ごとに列が
// 分かれ、測定の無い日も 1 列は置く(紙の温度板と同じで、空いている日が見える)。
// 列の幅はパネルの幅を列数で割って使い切る(列が多い週だけ横に送る)。
//
// 上から順に、イベントの帯(手術・入退院・転棟・外出泊)、温度板グラフ、測定項目、
// 注射(薬剤の組ごと)、検査(種別ごと)。帯・注射・検査の印は**その日の列の中央**に
// 置く(1 日の中の位置は測定の並びで決まり時間に比例しないため。時刻は title と
// 一覧モーダルで見せる)。

/** 印の欄と見出し。並べる順もこの通り。 */
const MARK_SECTIONS = {
  injection: "注射",
  observation: "看護観察",
  act: "看護行為",
  exam: "検査",
} as const;
type MarkSectionKey = keyof typeof MARK_SECTIONS;

/** 期間表示で選べる日数。基準日を含む。 */
const PERIOD_OPTIONS: { days: number; label: string }[] = [
  { days: 7, label: "1週間" },
  { days: 14, label: "2週間" },
  { days: 30, label: "1か月" },
];
const DEFAULT_PERIOD_DAYS = 7;
/** これを超える期間は日付の見出しから曜日を落とし、列幅の下限も下げる(列が多いため)。 */
const LONG_PERIOD_DAYS = 14;
/** 24 時間表示の枠数。 */
const DAY_HOURS = 24;
/** 列幅の下限(px)。これより狭くなるときは横に送る。見出しが短いほど詰められる。 */
const MIN_COLUMN_WIDTH = 64;
const MIN_SHORT_COLUMN_WIDTH = 46;
const MIN_HOUR_COLUMN_WIDTH = 34;
/** 項目列 + 単位列の幅(px)。CSS の --vital-flowsheet-item-w / -unit-w と一致させること。 */
const LABEL_COLUMNS_WIDTH = 180;

/**
 * 表の 1 列。測定があればその日時、無い枠は空き列。
 *
 * 1 週間表示では「1 日 = 枠、その中を測定ごとに分ける」、24 時間表示では
 * 「1 時間 = 枠、その中を測定ごとに分ける」。枠の単位が違うだけで構造は同じ。
 */
interface DayColumn {
  key: string;
  /** 枠のキー(週: YYYY-MM-DD / 日: YYYY-MM-DDTHH)。 */
  group: string;
  at?: string;
}

/** 枠(1 週間表示なら 1 日、24 時間表示なら 1 時間)。 */
interface ColumnGroup {
  key: string;
  /** 見出しに出す文字(週: MM/DD(曜) / 日: HH)。 */
  label: string;
  /** その枠が属する日。病日・曜日の色に使う。 */
  day: string;
  /** 曜日(0=日)。1 週間表示だけ。 */
  weekday?: number;
  /** columns の中での先頭の位置。 */
  start: number;
  count: number;
}

/** 日時 → 枠のキー。時刻を持たない値(検査オーダーなど)は日のキーのまま。 */
function groupKeyOf(at: string, dayMode: boolean): string {
  const day = localDateOf(at);
  if (!dayMode || /^\d{4}-\d{2}-\d{2}$/.test(at)) return day;
  const time = new Date(at);
  if (Number.isNaN(time.getTime())) return day;
  return `${day}T${String(time.getHours()).padStart(2, "0")}`;
}

export function VitalFlowsheetPanel({
  patientId,
  view,
  onViewChange,
  onOpenDetail,
  onOpenVital,
}: {
  patientId: string;
  /** URL の view。基準日(YYYY-MM-DD)と全画面を載せる(`parseFlowsheetView`)。 */
  view?: string;
  onViewChange?: (view: string | null) => void;
  /** イベント一覧からカルテのオーダー詳細モーダルを開く。 */
  onOpenDetail?: (target: KarteDetailTarget) => void;
  /** 測定の列からバイタル編集(右ペイン)を開く。 */
  onOpenVital?: (entryId: string) => void;
}) {
  // 基準日と全画面は URL に載せる(リロード・共有で同じ週が開く)。onViewChange が
  // 無い(タブの外から使う)ときだけ内部の状態で持つ。
  const parsedView = parseFlowsheetView(view);
  const [localView, setLocalView] = useState<FlowsheetView>(() => ({ baseDate: today() }));
  // URL の view をそのまま使う(項目が増えても取りこぼさないよう、既定は基準日だけ埋める)。
  const current: FlowsheetView = onViewChange
    ? { ...parsedView, baseDate: parsedView.baseDate ?? today() }
    : localView;
  const baseDate = current.baseDate;
  const fullscreen = Boolean(current.fullscreen);

  // いまの表示状態。Escape の購読(useEffect)から読むので ref に写しておく
  // (current は毎回作り直されるため、依存に入れると購読を張り直すことになる)。
  const viewRef = useRef(current);
  viewRef.current = current;

  const updateView = useCallback(
    (next: FlowsheetView) => {
      if (onViewChange) onViewChange(formatFlowsheetView(next, today()));
      else setLocalView(next);
    },
    [onViewChange],
  );

  const setBaseDate = (date: string) =>
    // 基準日を変えたら 24 時間表示は解く(見ていた日は新しい週に無いかもしれない)。
    updateView({ ...viewRef.current, baseDate: date, day: undefined });
  const setFullscreen = useCallback(
    (on: boolean) => updateView({ ...viewRef.current, fullscreen: on }),
    [updateView],
  );
  /** 日付の見出しを押したときの切り替え。同じ日をもう一度押せば期間表示に戻る。 */
  const toggleDay = (day: string) =>
    updateView({ ...viewRef.current, day: viewRef.current.day === day ? undefined : day });
  /** 期間の長さ。24 時間表示のときは解いて期間表示に戻す。 */
  const setPeriodDays = (value: number) =>
    updateView({
      ...viewRef.current,
      days: value === DEFAULT_PERIOD_DAYS ? undefined : value,
      day: undefined,
    });
  // 帯で選んだ日。選ぶとその日のイベント一覧をモーダルで出す。
  const [selectedEventDay, setSelectedEventDay] = useState<string | null>(null);
  // 注射・検査の行で選んだ印。一覧は同じまとまり(その日のオーダー)ぶんを出し、
  // 押した 1 件は markKey で突き止めて色を付ける。
  const [selectedMark, setSelectedMark] = useState<{
    rows: MarkSectionKey;
    groupId: string;
    key: string;
  } | null>(null);
  // 注射の実施入力を開いているオーダー。一覧モーダルから開く。
  const [performSrId, setPerformSrId] = useState<string | null>(null);
  // 看護の実施入力。**押した指示 1 件**を、押した印の日時で開く。指示簿から開く
  // ラウンドの記録(患者 1 人ぶんをまとめて入れる)とは意図が違うので、絞って渡す。
  const [nursingPerform, setNursingPerform] = useState<{ orderId: string; at: string } | null>(null);
  // 食事摂取量の入力。押した 1 食ぶん(主食・副食)だけを出す。
  const [selectedMealSlot, setSelectedMealSlot] = useState<MealIntakeSlot | null>(null);
  // 全画面はビューポート全体ではなく「患者情報の下」から始める。開始位置は
  // カルテのレイアウト(左右ペインの上端)を実測して決める。
  const panelRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fullscreenTop, setFullscreenTop] = useState(0);
  const [wrapWidth, setWrapWidth] = useState(0);

  // 24 時間表示ではその日だけを引く。期間表示は基準日までの N 日。
  const dayMode = current.day;
  const periodDays = current.days ?? DEFAULT_PERIOD_DAYS;
  // 列が多い期間は日付の見出しを短く(曜日は土日の色で分かる)。
  const shortDates = periodDays > LONG_PERIOD_DAYS;
  const rangeStart = dayMode ?? addDays(baseDate, -(periodDays - 1));
  const rangeEnd = dayMode ?? baseDate;
  const days = useMemo(
    () =>
      dayMode ? [dayMode] : Array.from({ length: periodDays }, (_, i) => addDays(rangeStart, i)),
    [dayMode, periodDays, rangeStart],
  );

  const { data: observations, isLoading, error } = useVitalFlowsheet(patientId, rangeStart, rangeEnd);
  // 異常値(H/L)の色付けは施設設定のしきい値で表示時に判定する。
  const thresholds = useVitalThresholds();
  const flowsheet = useMemo(
    () => buildVitalFlowsheet(observations ?? [], thresholds),
    [observations, thresholds],
  );

  // 枠ごとの列。測定があればその日時ごと、無ければ空き列を 1 つ。
  const { columns, dayGroups } = useMemo(() => {
    const columns: DayColumn[] = [];
    const dayGroups: ColumnGroup[] = [];
    // 枠の一覧。1 週間表示は 7 日、24 時間表示はその日の 24 時間。
    const slots = dayMode
      ? Array.from({ length: DAY_HOURS }, (_, hour) => {
          const label = String(hour).padStart(2, "0");
          return { key: `${dayMode}T${label}`, label, day: dayMode, weekday: undefined };
        })
      : days.map((day) => {
          const { label, short, weekday } = flowsheetDayLabel(day);
          return { key: day, label: shortDates ? short : label, day, weekday };
        });

    for (const slot of slots) {
      const instants = flowsheet.columns.filter((at) => groupKeyOf(at, Boolean(dayMode)) === slot.key);
      const start = columns.length;
      if (instants.length === 0) columns.push({ key: `slot:${slot.key}`, group: slot.key });
      else for (const at of instants) columns.push({ key: at, group: slot.key, at });
      dayGroups.push({ ...slot, start, count: Math.max(1, instants.length) });
    }
    return { columns, dayGroups };
  }, [dayMode, days, shortDates, flowsheet.columns]);

  const encounters = usePatientEncounterEvents(patientId, rangeStart, rangeEnd);
  const surgeries = usePatientSurgeryPerforms(patientId);
  const examOrders = usePatientExamOrders(patientId, rangeStart, rangeEnd);
  const injections = usePatientInjectionOrders(patientId, rangeStart, rangeEnd);
  const nursing = usePatientNursingFlowsheet(patientId, rangeStart, rangeEnd);
  // 看護指示の予定時刻(「1日N回」の既定時刻)。実施入力と同じ設定を使う。
  const facility = useFacilitySettings();
  const nursingSchedule = facility.data?.nursing_schedule ?? DEFAULT_NURSING_SCHEDULE;

  const injectionRows = useMemo(
    () => (injections.data ? buildInjectionRows(injections.data) : []),
    [injections.data],
  );
  const examRows = useMemo(
    () => (examOrders.data ? buildExamRows(examOrders.data) : []),
    [examOrders.data],
  );
  const nursingData = useMemo(
    () => (nursing.data ? { ...nursing.data, schedule: nursingSchedule } : null),
    [nursing.data, nursingSchedule],
  );
  const observationRows = useMemo(
    () => (nursingData ? buildNursingRows(nursingData, days, "observation") : []),
    [nursingData, days],
  );
  const actRows = useMemo(
    () => (nursingData ? buildNursingRows(nursingData, days, "act") : []),
    [nursingData, days],
  );
  /** 日時 → 枠のキー。印を置く位置を決める。 */
  const slotKeyOf = (at: string) => groupKeyOf(at, Boolean(dayMode));

  // 食事摂取量。食止めは食種の側の情報なので、期間に出ている食種をマスタで引いて判定する。
  const meal = usePatientMealIntake(patientId, rangeStart, rangeEnd);
  const fastingDietCodes = useFastingDietCodes(
    (meal.data?.orders ?? []).map((order) => mealOrderDietRef(order)?.code ?? "").filter(Boolean),
  );
  // 記録の subject・encounter は、その食事を出しているオーダーからそのまま採る
  // (看護の実施と同じ。経過表は患者の参照を持たない)。
  const mealSubject = meal.data?.orders[0]?.subject;
  const mealEncounter = meal.data?.orders[0]?.encounter;
  const mealRows = useMemo(
    () =>
      meal.data
        ? buildMealIntakeRows({
            orders: meal.data.orders,
            observations: meal.data.observations,
            days,
            fastingDietCodes: fastingDietCodes.data ?? new Set<string>(),
          })
        : [],
    [meal.data, days, fastingDietCodes.data],
  );

  // 水分出納。注射の投与量は薬価算定単位なので、mL 換算マスタで直してから足す。
  const balanceSettings = facility.data?.water_balance ?? EMPTY_WATER_BALANCE;
  const balanceEnabled = balanceSettings.in.length > 0 || balanceSettings.out.length > 0;
  const administrations = balanceEnabled ? (injections.data?.administrations ?? []) : [];
  const mlFactors = useMedicineMlFactors(
    administrations
      .map((administration) => administration.medicationCodeableConcept?.coding?.[0]?.code ?? "")
      .filter(Boolean),
  );
  const waterBalance = useMemo(
    () =>
      balanceEnabled
        ? buildWaterBalance({
            settings: balanceSettings,
            observations: nursing.data?.observations ?? [],
            administrations,
            mlFactors: mlFactors.data ?? new Map(),
            slotKeyOf,
          })
        : null,
    // slotKeyOf は毎回作り直されるが、依存に入れないと 24 時間表示に切り替えても
    // 集計の枠が変わらない。dayMode を代わりに見る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [balanceEnabled, balanceSettings, nursing.data, administrations, mlFactors.data, dayMode],
  );

  /** 印の欄。見出しと、選んだ印を突き合わせる行の集合。 */
  const markSectionRows: Record<MarkSectionKey, FlowsheetMarkRow[]> = useMemo(
    () => ({ injection: injectionRows, exam: examRows, observation: observationRows, act: actRows }),
    [injectionRows, examRows, observationRows, actRows],
  );

  const markModal = useMemo(() => {
    if (!selectedMark) return null;
    const rows = markSectionRows[selectedMark.rows];
    const { events, highlightIndex, selected } = markModalEvents(
      rows,
      selectedMark.groupId,
      selectedMark.key,
    );
    if (events.length === 0) return null;
    const heading = MARK_SECTIONS[selectedMark.rows];
    // 見出しは押した 1 件の日時。どれを押したかが一覧を見る前に分かる。
    const when = selected ? flowsheetEventAtLabel(selected.at) : flowsheetEventRangeLabel(events);
    // 中止した注射は実施入力を出さない(印は cancelled になっている)。
    const canPerform =
      selectedMark.rows === "injection" && !events.some((event) => event.label === "中止");
    // 看護は指示をまたいで 1 回で記録するので、押した印の日時を既定にして開く。
    const nursingAt =
      selectedMark.rows === "observation" || selectedMark.rows === "act"
        ? (selected?.at ?? events[0]?.at ?? "")
        : "";
    return {
      events,
      highlightIndex,
      title: `${heading}（${when}）`,
      canPerform,
      srId: selectedMark.groupId,
      nursingAt,
    };
  }, [selectedMark, markSectionRows]);

  /** 看護の実施入力で開く指示。押した印の指示 1 件。 */
  const nursingPerformOrder = nursingPerform
    ? nursing.data?.orders.find((sr) => sr.id === nursingPerform.orderId)
    : undefined;

  // 実施入力に渡す一式。注射の取得結果(SR + 薬剤 + Task + 実施記録)から組み直す。
  const performTarget = useMemo(() => {
    const data = injections.data;
    if (!performSrId || !data) return null;
    const order = data.orders.find((sr) => sr.id === performSrId);
    if (!order) return null;
    return {
      order,
      medicationRequests: data.medicationRequests.filter(
        (mr) => referenceId(mr.basedOn?.[0]?.reference) === performSrId,
      ),
      task: injectionTasksByOrderId(data.tasks).get(performSrId),
      performs:
        injectionPerformsByOrderId(data.procedures, data.administrations).get(performSrId) ?? [],
    };
  }, [injections.data, performSrId]);

  const events = useMemo(
    () => buildFlowsheetEvents(encounters.data?.events ?? [], surgeries.data ?? []),
    [encounters.data, surgeries.data],
  );
  const eventGroups = useMemo(() => groupFlowsheetEventsByDay(events), [events]);
  const selectedEventGroup = eventGroups.find((group) => group.day === selectedEventDay);

  const stays = encounters.data?.stays ?? [];
  // 手術日(YYYY-MM-DD)。術後日数の行を出すかの判定にも使う。
  const surgeryDates = useMemo(
    () =>
      (surgeries.data ?? [])
        .map((procedure) => procedure.performedPeriod?.start ?? procedure.performedDateTime ?? "")
        .filter(Boolean)
        .map(localDateOf)
        .filter(Boolean),
    [surgeries.data],
  );
  const hospitalDays = days.map((day) => hospitalDayOf(day, stays));
  const postOpDays = days.map((day) => postOpDayOf(day, surgeryDates));
  const showHospitalDays = hospitalDays.some((day) => day !== undefined);
  const showPostOpDays = postOpDays.some((day) => day !== undefined);
  // 見出しは 年 / 日付 / 時刻 の 3 段。病日・術後日数を出すぶんだけ rowSpan を伸ばす。
  const headerRowSpan = 3 + (showHospitalDays ? 1 : 0) + (showPostOpDays ? 1 : 0);

  // 全画面は Escape でも抜けられるようにする(モーダルと同じ作法)。
  useEffect(() => {
    if (!fullscreen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fullscreen, setFullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    function measure() {
      const layout = panelRef.current?.closest(".karte-layout");
      setFullscreenTop(layout ? Math.max(0, layout.getBoundingClientRect().top) : 0);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fullscreen]);

  // 列幅はパネルの幅から決める。ペインの分割やウィンドウの幅で変わるので、
  // 描画のたびに同期で測り、以後は ResizeObserver で追う。
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    function measure() {
      if (wrapRef.current) setWrapWidth(wrapRef.current.clientWidth);
    }
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(wrap);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [fullscreen, isLoading]);

  const minColumnWidth = dayMode
    ? MIN_HOUR_COLUMN_WIDTH
    : shortDates
      ? MIN_SHORT_COLUMN_WIDTH
      : MIN_COLUMN_WIDTH;
  const columnWidth = Math.max(
    minColumnWidth,
    Math.floor((wrapWidth - LABEL_COLUMNS_WIDTH) / Math.max(1, columns.length)),
  );

  const chartSeries = useMemo(
    () => buildChartSeries(flowsheet.rows, observations ?? [], thresholds),
    [flowsheet, observations, thresholds],
  );

  // 最上段の見出し。1 週間表示は年(連続する同じ年をまとめる)、24 時間表示は日付。
  const topGroups = useMemo(() => {
    const groups: { label: string; count: number }[] = [];
    for (const group of dayGroups) {
      const { year, label } = flowsheetDayLabel(group.day);
      const text = dayMode ? `${year}年 ${label}` : `${year}年`;
      const last = groups[groups.length - 1];
      if (last && last.label === text) last.count += group.count;
      else groups.push({ label: text, count: group.count });
    }
    return groups;
  }, [dayMode, dayGroups]);

  /**
   * 日の区切り x(px)。注射・検査の行は 1 セルを SVG で描くので表の縦罫線が入らない。
   * 日ごとに読めるよう、同じ位置に自前で線を引く(末尾はセルの外枠と重なるので除く)。
   */
  const dayLineXs = useMemo(
    () => dayGroups.slice(0, -1).map((group) => (group.start + group.count) * columnWidth),
    [dayGroups, columnWidth],
  );

  /**
   * 病日・術後日数は日の単位なので、日ごとの列数をまとめる
   * (24 時間表示では 1 日 = 全列)。
   */
  const dayColSpans = useMemo(() => {
    const spans: { day: string; count: number }[] = [];
    for (const group of dayGroups) {
      const last = spans[spans.length - 1];
      if (last && last.day === group.day) last.count += group.count;
      else spans.push({ day: group.day, count: group.count });
    }
    return spans;
  }, [dayGroups]);

  /** イベントの帯・グラフに出す枠。範囲内のものだけ。 */
  const shownEventGroups = eventGroups.filter(
    (group) => group.day >= rangeStart && group.day <= rangeEnd,
  );

  /** 枠の幅(px)。同じ枠に重なる印をどこまで広げてよいかに使う。 */
  const slotWidth = (key: string): number => {
    const group = dayGroups.find((candidate) => candidate.key === key);
    return (group?.count ?? 1) * columnWidth;
  };

  /**
   * 枠の中央 x(px)。範囲外は端に寄せる。24 時間表示で時刻を持たない値
   * (検査オーダーなど)は枠が決まらないので、その日の真ん中に置く。
   */
  const slotCenterX = (key: string): number => {
    const group = dayGroups.find((candidate) => candidate.key === key);
    if (group) return (group.start + group.count / 2) * columnWidth;
    const day = key.slice(0, 10);
    if (dayMode) return day === dayMode ? (columns.length * columnWidth) / 2 : 0;
    if (day < rangeStart) return 0;
    if (day > rangeEnd) return columns.length * columnWidth;
    return 0;
  };

  /** 前後の期間へ。24 時間表示なら 1 日ずつ動かす。 */
  function shiftPeriod(delta: number) {
    if (dayMode) {
      updateView({ ...viewRef.current, day: addDays(dayMode, delta) });
      return;
    }
    setBaseDate(addDays(baseDate, delta * periodDays));
  }

  return (
    // 表の地色・見出し行・1 行おきの濃淡は他のタブ(検査結果の時系列表示)と同じ
    // .karte-tabpanel 配下の指定に任せる。全画面は同じ中身を左右ペインの領域に
    // 重ねるだけ(患者情報の帯までは残り、右ペインなどは覆われて見えなくなる)。
    <div
      ref={panelRef}
      className={`karte-tabpanel vital-flowsheet${fullscreen ? " vital-flowsheet--fullscreen" : ""}${
        // 列が狭いと「128/82」が省略されるので、値の字を詰める。
        columnWidth < MIN_COLUMN_WIDTH ? " vital-flowsheet--narrow" : ""
      }`}
      style={{
        ...(fullscreen ? { top: fullscreenTop } : {}),
        ["--vital-flowsheet-col-w" as string]: `${columnWidth}px`,
      }}
    >
      <ErrorBanner
        error={error ?? encounters.error ?? surgeries.error ?? examOrders.error ?? injections.error}
      />

      <div className="lab-timeline__controls">
        <label className="lab-timeline__count">
          基準日
          <input
            type="date"
            value={baseDate}
            onChange={(e) => {
              if (e.target.value) setBaseDate(e.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="vital-flowsheet__week-button"
          onClick={() => shiftPeriod(-1)}
          title="前へ"
          aria-label="前へ"
        >
          ◀
        </button>
        <button
          type="button"
          className="vital-flowsheet__week-button"
          onClick={() => shiftPeriod(1)}
          title="次へ"
          aria-label="次へ"
        >
          ▶
        </button>
        <button type="button" onClick={() => setBaseDate(today())}>
          今日
        </button>
        {/* 期間の長さ。24 時間表示のときは日付の見出しから戻る操作になるので伏せる。 */}
        {!dayMode && (
          <label className="lab-timeline__count">
            <select
              aria-label="表示する期間"
              value={periodDays}
              onChange={(e) => setPeriodDays(Number(e.target.value))}
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.days} value={option.days}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="lab-timeline__hint" />
        <button type="button" onClick={() => setFullscreen(!fullscreen)}>
          {fullscreen ? "全画面を終了" : "全画面"}
        </button>
      </div>

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div ref={wrapRef} className="lab-timeline__table-wrap">
            <table className="lab-timeline__table vital-flowsheet__table">
              <thead>
                {/* 1 日 = 列のまとまり。測定ごとに列が分かれるので、日付の下に時刻を出す。
                    末尾の空列は列幅の端数を吸収する。 */}
                <tr>
                  <th className="lab-timeline__item-col" rowSpan={3}>
                    測定項目
                  </th>
                  <th className="lab-timeline__unit-col" rowSpan={3}>
                    単位
                  </th>
                  {topGroups.map((group, index) => (
                    <th key={index} className="lab-timeline__year-col" colSpan={group.count}>
                      {dayMode ? (
                        <button
                          type="button"
                          className="vital-flowsheet__day-toggle"
                          title="1 週間表示に戻る"
                          onClick={() => toggleDay(dayMode)}
                        >
                          {group.label}
                        </button>
                      ) : (
                        group.label
                      )}
                    </th>
                  ))}
                  <th className="vital-flowsheet__filler" rowSpan={headerRowSpan} />
                </tr>
                <tr>
                  {dayGroups.map((group) => {
                    const weekendClass =
                      group.weekday === 0
                        ? " vital-flowsheet__date-col--sunday"
                        : group.weekday === 6
                          ? " vital-flowsheet__date-col--saturday"
                          : "";
                    return (
                      <th
                        key={group.key}
                        className={`lab-timeline__date-col vital-flowsheet__date-col${weekendClass}${
                          !dayMode && group.day === baseDate ? " vital-flowsheet__date-col--base" : ""
                        }`}
                        colSpan={group.count}
                        title={dayMode ? `${group.day} ${group.label}時` : group.day}
                      >
                        {/* 1 週間表示では日付を押すとその日の 24 時間表示に切り替わる。 */}
                        {dayMode ? (
                          group.label
                        ) : (
                          <button
                            type="button"
                            className="vital-flowsheet__day-toggle"
                            title={`${group.label} の 24 時間表示に切り替える`}
                            onClick={() => toggleDay(group.day)}
                          >
                            {group.label}
                          </button>
                        )}
                      </th>
                    );
                  })}
                </tr>
                <tr>
                  {columns.map((column) => {
                    // 手入力のバイタルだけ、時刻からバイタル編集(右ペイン)を開ける。
                    // 看護観察・テンプレート抽出の値は束ね id が無いので開けない。
                    const entryId = column.at ? flowsheet.entryIds.get(column.at) : undefined;
                    return (
                      <th key={column.key} className="vital-flowsheet__time-col" title={column.at}>
                        {entryId && onOpenVital ? (
                          <button
                            type="button"
                            className="vital-flowsheet__time-button"
                            title={`${flowsheetColumnLabel(column.at as string).date} ${flowsheetColumnLabel(column.at as string).time} の測定を編集`}
                            onClick={() => onOpenVital(entryId)}
                          >
                            {flowsheetColumnLabel(column.at as string).time}
                          </button>
                        ) : column.at ? (
                          flowsheetColumnLabel(column.at).time
                        ) : (
                          ""
                        )}
                      </th>
                    );
                  })}
                </tr>
                {/* 病日・術後日数。入院・手術があるときだけ行を出す。日の単位なので
                    日のまとまりごとに 1 セル。見出しの中にあるので縦に送っても残る。 */}
                {showHospitalDays && (
                  <tr>
                    <th className="lab-timeline__item-col vital-flowsheet__day-head">病日</th>
                    <th className="lab-timeline__unit-col" />
                    {dayColSpans.map((span, index) => (
                      <th
                        key={span.day}
                        className="vital-flowsheet__day-col"
                        colSpan={span.count}
                        title="入院からの日数"
                      >
                        {hospitalDayLabel(hospitalDays[index])}
                      </th>
                    ))}
                  </tr>
                )}
                {showPostOpDays && (
                  <tr>
                    <th className="lab-timeline__item-col vital-flowsheet__day-head">術後</th>
                    <th className="lab-timeline__unit-col" />
                    {dayColSpans.map((span, index) => (
                      <th
                        key={span.day}
                        className="vital-flowsheet__day-col"
                        colSpan={span.count}
                        title="手術からの日数"
                      >
                        {postOpDayLabel(postOpDays[index])}
                      </th>
                    ))}
                  </tr>
                )}
              </thead>

              {/* イベントの帯とグラフは測定の行と性質が違うので tbody を分ける。
                  1 行おきの濃淡(tbody tr:nth-child(even))が測定の行だけに当たり、
                  帯の有無で縞の向きが入れ替わらない。 */}
              <tbody className="vital-flowsheet__chart-body">
                {shownEventGroups.length > 0 && (
                  <tr className="vital-flowsheet__event-row">
                    <th className="lab-timeline__item-col vital-flowsheet__event-head" colSpan={2}>
                      イベント
                    </th>
                    <td className="vital-flowsheet__event-cell" colSpan={columns.length}>
                      <FlowsheetEventBand
                        width={columns.length * columnWidth}
                        groups={shownEventGroups}
                        xOf={slotCenterX}
                        slotKeyOf={slotKeyOf}
                        selectedDay={selectedEventDay}
                        onSelect={setSelectedEventDay}
                      />
                    </td>
                    <td className="vital-flowsheet__filler" />
                  </tr>
                )}
                <tr className="vital-flowsheet__chart-row">
                  <th className="lab-timeline__item-col vital-flowsheet__axis-cell" colSpan={2}>
                    <FlowsheetAxis series={chartSeries} />
                  </th>
                  <td className="vital-flowsheet__chart-cell" colSpan={columns.length}>
                    <FlowsheetChart
                      columns={columns}
                      columnWidth={columnWidth}
                      series={chartSeries}
                      eventXs={shownEventGroups.map((group) =>
                        slotCenterX(slotKeyOf(group.events[0]?.at ?? group.day)),
                      )}
                    />
                  </td>
                  <td className="vital-flowsheet__filler" />
                </tr>
              </tbody>

              <tbody>
                {flowsheet.rows.length === 0 && (
                  <tr>
                    <td className="lab-timeline__item-col vital-flowsheet__empty" colSpan={2}>
                      バイタルの記録がありません
                    </td>
                    <td colSpan={columns.length} />
                    <td className="vital-flowsheet__filler" />
                  </tr>
                )}
                {flowsheet.rows.map((row) => (
                  <tr key={row.key}>
                    {/* 項目列・単位列は幅固定で左に貼り付く(CSS)。長い項目名は省略されるので title で。 */}
                    <td className="lab-timeline__item-col" title={row.name}>
                      <span className="lab-timeline__item-label">{row.name}</span>
                    </td>
                    <td className="lab-timeline__unit-col">{row.unit}</td>
                    {columns.map((column) => (
                      // 列幅は固定なので、長い文字値(観察結果)は省略される。全文は title で。
                      // 異常値は検査結果の時系列表示と同じ修飾子(--high / --low)で色付けする。
                      <td
                        key={column.key}
                        className={interpretationClass(
                          (column.at && row.interpretations.get(column.at)) || "",
                          "lab-timeline__value",
                        )}
                        title={column.at ? row.values.get(column.at) : undefined}
                      >
                        {column.at ? (row.values.get(column.at) ?? "") : ""}
                      </td>
                    ))}
                    <td className="vital-flowsheet__filler" />
                  </tr>
                ))}
              </tbody>

              {/* 注射・検査。薬剤の組・検査の種別ごとに 1 行で、印はその日の列の中央。
                  測定の行とは読むものが違うので下にまとめ、tbody を分けて縞を掛けない。
                  オーダーが無ければ区切りごと出さない。 */}
              {/* 食事摂取量。枠の中に朝・昼・夕を並べる(24 時間表示では 08/12/18 の枠に
                  1 つずつ落ちる)。値は割で、押すとその食事の入力を開く。オーダーの無い日・
                  欠食・食止めの食事は枠を出さない。 */}
              {mealRows[0]?.cells.length ? (
                <tbody className="vital-flowsheet__injection-body">
                  <tr className="vital-flowsheet__section-row">
                    <th className="lab-timeline__item-col vital-flowsheet__section-head" colSpan={2}>
                      食事
                    </th>
                    <td colSpan={columns.length} />
                    <td className="vital-flowsheet__filler" />
                  </tr>
                  {mealRows.map((row) => (
                    <tr key={row.kind}>
                      <td className="lab-timeline__item-col" title={row.label}>
                        <span className="lab-timeline__item-label">{row.label}</span>
                      </td>
                      <td className="lab-timeline__unit-col">割</td>
                      {dayGroups.map((group) => (
                        <td key={group.key} className="lab-timeline__value" colSpan={group.count}>
                          <span className="vital-flowsheet__meal-cell">
                            {row.cells
                              .filter((cell) => slotKeyOf(cell.slot.at) === group.key)
                              .map((cell) => (
                                <button
                                  key={cell.slot.at}
                                  type="button"
                                  className="vital-flowsheet__meal-value"
                                  title={`${mealIntakeSlotLabel(cell.slot)} ${row.label}`}
                                  onClick={() => setSelectedMealSlot(cell.slot)}
                                >
                                  {mealIntakeLabel(cell.percent) || "・"}
                                </button>
                              ))}
                          </span>
                        </td>
                      ))}
                      <td className="vital-flowsheet__filler" />
                    </tr>
                  ))}
                </tbody>
              ) : null}

              {/* 水分出納。印ではなく枠ごとの合計(mL)なので、測定項目と同じ値の行にする。
                  施設設定で対象の観察項目を選んでいなければ出さない。 */}
              {waterBalance && (
                <tbody className="vital-flowsheet__injection-body">
                  <tr className="vital-flowsheet__section-row">
                    <th
                      className="lab-timeline__item-col vital-flowsheet__section-head"
                      colSpan={2}
                      title={
                        waterBalance.unconvertible > 0
                          ? `mL に換算できない薬剤が ${waterBalance.unconvertible} 件あり、IN に数えていません`
                          : undefined
                      }
                    >
                      水分出納{waterBalance.unconvertible > 0 ? " *" : ""}
                    </th>
                    <td colSpan={columns.length} />
                    <td className="vital-flowsheet__filler" />
                  </tr>
                  {(
                    [
                      { key: "in", label: "IN", unit: "mL", totals: waterBalance.in },
                      { key: "out", label: "OUT", unit: "mL", totals: waterBalance.out },
                      { key: "balance", label: "バランス", unit: "mL", totals: waterBalance.balance },
                    ] as const
                  ).map((row) => (
                    <tr key={row.key}>
                      <td className="lab-timeline__item-col" title={row.label}>
                        <span className="lab-timeline__item-label">{row.label}</span>
                      </td>
                      <td className="lab-timeline__unit-col">{row.unit}</td>
                      {dayGroups.map((group) => (
                        <td
                          key={group.key}
                          className={`lab-timeline__value${
                            // バランスは負(出が多い)を異常値と同じ赤で示す。
                            row.key === "balance" && (row.totals.get(group.key) ?? 0) < 0
                              ? " lab-timeline__value--high"
                              : ""
                          }`}
                          colSpan={group.count}
                        >
                          {waterBalanceLabel(row.totals.get(group.key))}
                        </td>
                      ))}
                      <td className="vital-flowsheet__filler" />
                    </tr>
                  ))}
                </tbody>
              )}

              {(Object.keys(MARK_SECTIONS) as MarkSectionKey[]).map((key) => (
                <FlowsheetMarkSection
                  key={key}
                  heading={MARK_SECTIONS[key]}
                  rows={markSectionRows[key]}
                  columnCount={columns.length}
                  width={columns.length * columnWidth}
                  dayLineXs={dayLineXs}
                  xOf={slotCenterX}
                  slotKeyOf={slotKeyOf}
                  slotWidthOf={slotWidth}
                  selectedKey={selectedMark?.rows === key ? selectedMark.key : null}
                  onSelect={(mark) =>
                    setSelectedMark({ rows: key, groupId: mark.groupId, key: markKey(mark) })
                  }
                />
              ))}
            </table>
          </div>

          {selectedEventGroup && (
            <FlowsheetEventModal
              events={selectedEventGroup.events}
              onOpenDetail={onOpenDetail}
              onClose={() => setSelectedEventDay(null)}
            />
          )}

          {markModal && (
            <FlowsheetEventModal
              events={markModal.events}
              title={markModal.title}
              highlightIndex={markModal.highlightIndex}
              onOpenDetail={onOpenDetail}
              actions={
                // 施用するのは病棟なので、経過表からその場で書けるようにする
                // (カルテのカードと同じモーダル)。中止した注射には出さない。
                // 1 日に複数回の施用があるので、実施済になっても押せる。
                markModal.canPerform || markModal.nursingAt ? (
                  <button
                    type="button"
                    onClick={() => {
                      // 一覧は役目を終えるので閉じてから開く(「詳細」と同じ作法)。
                      setSelectedMark(null);
                      if (markModal.nursingAt) {
                        setNursingPerform({ orderId: markModal.srId, at: markModal.nursingAt });
                      } else {
                        setPerformSrId(markModal.srId);
                      }
                    }}
                  >
                    実施入力
                  </button>
                ) : undefined
              }
              onClose={() => setSelectedMark(null)}
            />
          )}

          {performTarget && (
            <InjectionPerformModal
              order={performTarget.order}
              medicationRequests={performTarget.medicationRequests}
              task={performTarget.task}
              performs={performTarget.performs}
              onClose={() => setPerformSrId(null)}
            />
          )}

          {nursingPerformOrder && nursingPerform && nursing.data && (
            // 指示簿タブと同じモーダルに、押した指示 1 件だけを渡す。押した印の日時を
            // 記録日時の既定にするので、未実施の予定を押せばその時刻で開く
            // (過去の分を後から入れる運用に合う)。
            <NursingPerformModal
              orders={[nursingPerformOrder]}
              defaultAt={toDateTimeInputValue(nursingPerform.at)}
              performsByOrderId={nursing.data.performsByOrderId}
              onClose={() => setNursingPerform(null)}
            />
          )}

          {selectedMealSlot && mealSubject && (
            <MealIntakeModal
              slot={selectedMealSlot}
              recorded={mealRecordedOf(mealRows, selectedMealSlot)}
              subject={mealSubject}
              encounter={mealEncounter}
              onSaved={() => setSelectedMealSlot(null)}
              onClose={() => setSelectedMealSlot(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

/** 押した食事の既存の記録。項目ごとに値と Observation の id を渡す。 */
function mealRecordedOf(
  rows: ReturnType<typeof buildMealIntakeRows>,
  slot: MealIntakeSlot,
): Partial<Record<MealIntakeKind, { percent: number; observationId: string }>> {
  const recorded: Partial<Record<MealIntakeKind, { percent: number; observationId: string }>> = {};
  for (const row of rows) {
    const cell = row.cells.find((candidate) => candidate.slot.at === slot.at);
    if (cell?.percent !== undefined && cell.observationId) {
      recorded[row.kind] = { percent: cell.percent, observationId: cell.observationId };
    }
  }
  return recorded;
}

// ---- イベントの帯 ----

/** 1 つの日に積むラベルの上限。これを超えたら最後の行を「他N件」にする。 */
const EVENT_LABEL_ROWS = 3;
const EVENT_ROW_HEIGHT = 13;
/** ▼ とラベルの間。 */
const EVENT_MARK_HEIGHT = 12;
/** ラベルの文字数の上限。列幅に収まる長さで丸め、全文は title に出す。 */
const EVENT_LABEL_CHARS = 5;

function truncateLabel(label: string): string {
  return label.length > EVENT_LABEL_CHARS ? `${label.slice(0, EVENT_LABEL_CHARS)}…` : label;
}

function eventTitle(event: FlowsheetEvent): string {
  const when = flowsheetEventAtLabel(event.at);
  return [event.name, event.detail].filter(Boolean).join(" ") + (when ? ` (${when})` : "");
}

/**
 * イベントの帯。印はその日の列のまとまりの中央に置き、同じ日のイベントは縦に積む。
 */
function FlowsheetEventBand({
  width,
  groups,
  xOf,
  slotKeyOf,
  selectedDay,
  onSelect,
}: {
  width: number;
  groups: FlowsheetEventGroup[];
  xOf: (slotKey: string) => number;
  slotKeyOf: (at: string) => string;
  selectedDay: string | null;
  onSelect: (day: string) => void;
}) {
  const rows = Math.min(EVENT_LABEL_ROWS, Math.max(1, ...groups.map((group) => group.labels.length)));
  const height = EVENT_MARK_HEIGHT + rows * EVENT_ROW_HEIGHT;

  return (
    <svg
      className="vital-flowsheet__event-band"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="入退院・手術のイベント"
    >
      {groups.map((group) => {
        // 24 時間表示では、その日のイベントを最初の 1 件の時刻の枠に置く。
        const x = xOf(slotKeyOf(group.events[0]?.at ?? group.day));
        // 4 件以上あるときは 2 行だけ出し、残りを最後の行にまとめる。
        const overflow = group.labels.length > EVENT_LABEL_ROWS;
        const shown = overflow ? group.labels.slice(0, EVENT_LABEL_ROWS - 1) : group.labels;
        const selected = group.day === selectedDay;
        return (
          <g
            key={group.day}
            className={`vital-flowsheet__event vital-flowsheet__event--${group.labels[0].kind}${
              selected ? " vital-flowsheet__event--selected" : ""
            }`}
            role="button"
            tabIndex={0}
            aria-label={`${group.labels.map((l) => l.text).join("・")} の一覧を開く`}
            onClick={() => onSelect(group.day)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(group.day);
              }
            }}
          >
            <title>{group.events.map(eventTitle).join("\n")}</title>
            {/* クリックできる範囲。▼ とラベルだけだと当たり判定が細すぎる。 */}
            <rect
              className="vital-flowsheet__event-hit"
              x={x - MIN_COLUMN_WIDTH / 2}
              y={0}
              width={MIN_COLUMN_WIDTH}
              height={height}
            />
            <path className="vital-flowsheet__event-mark" d={`M${x - 4},2 L${x + 4},2 L${x},9 Z`} />
            {shown.map((label, index) => (
              <text
                key={`${label.text}/${index}`}
                className={`vital-flowsheet__event-label vital-flowsheet__event-label--${label.kind}`}
                x={x}
                y={EVENT_MARK_HEIGHT + (index + 1) * EVENT_ROW_HEIGHT - 3}
                textAnchor="middle"
              >
                {truncateLabel(label.text)}
              </text>
            ))}
            {overflow && (
              <text
                className="vital-flowsheet__event-label vital-flowsheet__event-label--more"
                x={x}
                y={EVENT_MARK_HEIGHT + EVENT_LABEL_ROWS * EVENT_ROW_HEIGHT - 3}
                textAnchor="middle"
              >
                他{group.labels.length - shown.length}件
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---- 印の行(注射・検査) ----

const MARK_ROW_HEIGHT = 18;
/** 印の半径。 */
const MARK_R = 4;
/** 開始と終了が同じ位置に来たときのバーの最小幅。 */
const MARK_BAR_MIN_WIDTH = 12;
/** 同じ位置に重なった点をずらす間隔。印の直径 + 隙間。 */
const MARK_GAP = 13;
/** その日に印が多いときの間隔の下限。これ以下には詰めない(重なって読めなくなる)。 */
const MARK_MIN_GAP = 7;
/** 当たり判定の最小幅。 */
const MARK_HIT_WIDTH = 13;

/** 区切り行 + 行の並び。行が無ければ何も出さない。 */
function FlowsheetMarkSection({
  heading,
  rows,
  columnCount,
  width,
  dayLineXs,
  xOf,
  slotKeyOf,
  slotWidthOf,
  selectedKey,
  onSelect,
}: {
  heading: string;
  rows: FlowsheetMarkRow[];
  columnCount: number;
  width: number;
  /** 日の区切りに引く縦線の x。 */
  dayLineXs: number[];
  xOf: (slotKey: string) => number;
  slotKeyOf: (at: string) => string;
  slotWidthOf: (slotKey: string) => number;
  /** 押した印。色を付ける 1 件を選ぶ。 */
  selectedKey: string | null;
  onSelect: (mark: FlowsheetMark) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <tbody className="vital-flowsheet__injection-body">
      <tr className="vital-flowsheet__section-row">
        <th className="lab-timeline__item-col vital-flowsheet__section-head" colSpan={2}>
          {heading}
        </th>
        <td colSpan={columnCount} />
        <td className="vital-flowsheet__filler" />
      </tr>
      {rows.map((row) => (
        <tr key={row.key} className="vital-flowsheet__injection-row">
          <th
            className="lab-timeline__item-col vital-flowsheet__injection-head"
            colSpan={2}
            title={row.title}
          >
            {row.label}
          </th>
          <td className="vital-flowsheet__injection-cell" colSpan={columnCount}>
            <FlowsheetMarkRowSvg
              width={width}
              marks={row.marks}
              dayLineXs={dayLineXs}
              xOf={xOf}
              slotKeyOf={slotKeyOf}
              slotWidthOf={slotWidthOf}
              selectedKey={selectedKey}
              onSelect={onSelect}
            />
          </td>
          <td className="vital-flowsheet__filler" />
        </tr>
      ))}
    </tbody>
  );
}

/**
 * 印の x を決める。印はその日の列のまとまりの中央。同じ日に 2 回投与する予定や、
 * 予定とその実施は同じ位置に落ちて重なるので、左右に均等にずらして数が見えるようにする。
 * ずらす間隔はその日の幅に収める(はみ出すと隣の日の印に見える)。
 */
function placeMarks(
  marks: FlowsheetMark[],
  xOf: (slotKey: string) => number,
  slotKeyOf: (at: string) => string,
  slotWidthOf: (slotKey: string) => number,
): { mark: FlowsheetMark; x: number; endX?: number }[] {
  // バーを描くのは**枠をまたぐ**ときだけ。1 週間表示の枠は 1 日なので、同じ日に収まる
  // 点滴の長さは描き分けられず、短いバーを出すと隣の印に重なって鎖のように見える
  // (同じ枠の開始〜終了は title と一覧モーダルで読む)。24 時間表示の枠は 1 時間なので、
  // 同じ日の点滴でも開始〜終了がバーになる。
  const placed = marks.map((mark) => {
    const slot = slotKeyOf(mark.at);
    const endSlot = mark.end ? slotKeyOf(mark.end) : "";
    return {
      mark,
      x: xOf(slot),
      endX: endSlot && endSlot !== slot ? xOf(endSlot) : undefined,
    };
  });

  const byX = new Map<number, typeof placed>();
  for (const item of placed) {
    const list = byX.get(item.x);
    if (list) list.push(item);
    else byX.set(item.x, [item]);
  }
  for (const list of byX.values()) {
    if (list.length < 2) continue;
    // 時刻順に並べて左から置く(左が古い)。
    list.sort((a, b) => a.mark.at.localeCompare(b.mark.at));
    const slotWidth = slotWidthOf(slotKeyOf(list[0].mark.at));
    const gap = Math.max(MARK_MIN_GAP, Math.min(MARK_GAP, slotWidth / list.length));
    list.forEach((item, index) => {
      const shift = (index - (list.length - 1) / 2) * gap;
      item.x += shift;
      if (item.endX !== undefined) item.endX += shift;
    });
  }
  return placed;
}

/** 印 1 行(薬剤の組 1 つ、検査の種別 1 つ)。終了があればバー、無ければ点。 */
function FlowsheetMarkRowSvg({
  width,
  marks,
  dayLineXs,
  xOf,
  slotKeyOf,
  slotWidthOf,
  selectedKey,
  onSelect,
}: {
  width: number;
  marks: FlowsheetMark[];
  dayLineXs: number[];
  xOf: (slotKey: string) => number;
  slotKeyOf: (at: string) => string;
  slotWidthOf: (slotKey: string) => number;
  selectedKey: string | null;
  onSelect: (mark: FlowsheetMark) => void;
}) {
  const y = MARK_ROW_HEIGHT / 2;
  const placed = placeMarks(marks, xOf, slotKeyOf, slotWidthOf);

  return (
    <svg
      className="vital-flowsheet__injection-band"
      width={width}
      height={MARK_ROW_HEIGHT}
      viewBox={`0 0 ${width} ${MARK_ROW_HEIGHT}`}
      role="img"
      aria-label="予定と実施"
    >
      {/* 日の区切り。印より先に描いて背面に置く。 */}
      {dayLineXs.map((x) => (
        <line
          key={x}
          className="vital-flowsheet__grid vital-flowsheet__grid--column"
          x1={x}
          x2={x}
          y1={0}
          y2={MARK_ROW_HEIGHT}
        />
      ))}
      {placed.map(({ mark, x: rawX, endX: rawEndX }, index) => {
        // 端に来た印が半分切れないよう、半径ぶんだけ内側に寄せる。
        const x = Math.min(Math.max(rawX, MARK_R), width - MARK_R);
        const endX =
          rawEndX === undefined ? undefined : Math.min(Math.max(rawEndX, MARK_R), width - MARK_R);
        const selected = markKey(mark) === selectedKey;
        // 左が古いので、バーは開始(x)から終了(endX)へ右に伸びる。
        const barWidth = endX === undefined ? 0 : Math.max(MARK_BAR_MIN_WIDTH, endX - x);
        return (
          <g
            key={`${mark.groupId}/${mark.at}/${mark.kind}/${index}`}
            className={`vital-flowsheet__injection vital-flowsheet__injection--${mark.kind}${
              selected ? " vital-flowsheet__injection--selected" : ""
            }`}
            role="button"
            tabIndex={0}
            aria-label={`${mark.title} の一覧を開く`}
            onClick={() => onSelect(mark)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(mark);
              }
            }}
          >
            <title>{mark.title}</title>
            <rect
              className="vital-flowsheet__injection-hit"
              x={x - MARK_HIT_WIDTH / 2}
              y={0}
              width={barWidth + MARK_HIT_WIDTH}
              height={MARK_ROW_HEIGHT}
            />
            {endX !== undefined && (
              <rect
                className="vital-flowsheet__injection-bar"
                x={x}
                y={y - 4}
                width={Math.min(barWidth, width - x)}
                height={8}
                rx={4}
              />
            )}
            <circle className="vital-flowsheet__injection-mark" cx={x} cy={y} r={MARK_R} />
            {(mark.kind === "not-done" || mark.kind === "cancelled") && (
              <path
                className="vital-flowsheet__injection-cross"
                d={`M${x - 3},${y - 3} L${x + 3},${y + 3} M${x + 3},${y - 3} L${x - 3},${y + 3}`}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---- グラフ(温度板) ----

// ---- グラフ本体 ----

const CHART_HEIGHT = 206;
// 上の余白は軸の見出し(記号 + 略称)の高さぶん。ここを詰めると目盛りに近づきすぎる
// (略称と最初の目盛りの間に少し空きが要る)。折れ線の高さ(PLOT_H)は変えない。
const CHART_PAD = { top: 38, bottom: 12 };
const PLOT_H = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom;
/** 目盛りの区間数。全系列で共通(同じ横罫線に各系列の目盛りを揃える)。 */
const TICK_INTERVALS = 6;
/** 基準線(下から数えた目盛りの位置)。BP 120 / R 30 / P 75 / T 37 の横罫線。 */
const BASELINE_TICK = 3;

type ChartMarker = "square" | "circle" | "triangle-up" | "triangle-down";

interface ChartSpec {
  key: string;
  /** 略称(T/BP/P/R)。 */
  name: string;
  unit: string;
  /** CSS 側で色を当てる修飾子。 */
  className: string;
  marker: ChartMarker;
  /** 最下段の目盛りと 1 区間の幅。目盛りは TICK_INTERVALS 区間で固定。 */
  min: number;
  step: number;
  /** 軸の列に出す系列。血圧の拡張期は収縮期と同じ列を使う。 */
  axis: boolean;
  /** 凡例に出す名前。 */
  legend: string;
}

interface ChartSeries extends ChartSpec {
  max: number;
  numbers: Map<string, number>;
  /** 測定日時 → 異常値の判定。点の色を変える。 */
  interpretations: Map<string, VitalInterpretation>;
}

// 温度板の慣例的な目盛り(BP 0–240 / R 0–60 / P 0–150 / T 34–40)。系列ごとにスケールが
// 違うので 1 つの軸に重ねず、同じ横罫線に各系列の目盛りを割り当てる。
const CHART_SPECS: ChartSpec[] = [
  { key: "8480-6", name: "BP", unit: "mmHg", className: "bp", marker: "triangle-down", min: 0, step: 40, axis: true, legend: "収縮期" },
  { key: "8462-4", name: "BP", unit: "mmHg", className: "bp", marker: "triangle-up", min: 0, step: 40, axis: false, legend: "拡張期" },
  { key: "9279-1", name: "R", unit: "/分", className: "r", marker: "square", min: 0, step: 10, axis: true, legend: "呼吸数" },
  { key: "8867-4", name: "P", unit: "/分", className: "p", marker: "circle", min: 0, step: 25, axis: true, legend: "脈拍" },
  { key: "8310-5", name: "T", unit: "℃", className: "t", marker: "circle", min: 34, step: 1, axis: true, legend: "体温" },
];

function buildChartSeries(
  rows: VitalFlowsheetRow[],
  observations: fhir4.Observation[],
  thresholds: VitalThresholdSettings,
): ChartSeries[] {
  const bpKeys = BLOOD_PRESSURE_SERIES.map((series) => series.key as string);
  return CHART_SPECS.map((spec) => {
    const numbers = bpKeys.includes(spec.key)
      ? bloodPressureNumbers(observations, spec.key)
      : (rows.find((row) => row.key === spec.key)?.numbers ?? new Map<string, number>());
    // 表の血圧行は収縮期・拡張期をまとめて判定しているので、グラフは系列ごとに判定し直す。
    const interpretations = new Map<string, VitalInterpretation>();
    for (const [at, value] of numbers) {
      const mark = vitalInterpretationOf(spec.key, value, thresholds);
      if (mark) interpretations.set(at, mark);
    }
    // 目盛りの区間数は固定なので、範囲外の測定があれば目盛りごと平行移動して収める
    // (上側を優先。上下両方にはみ出す極端な場合は下側が切れる)。
    let { min } = spec;
    const span = spec.step * TICK_INTERVALS;
    const values = [...numbers.values()];
    if (values.length > 0) {
      const low = Math.min(...values);
      const high = Math.max(...values);
      while (min > low) min -= spec.step;
      while (min + span < high) min += spec.step;
    }
    return { ...spec, min, max: min + span, numbers, interpretations };
  });
}

const tickY = (index: number) => CHART_PAD.top + PLOT_H - (PLOT_H * index) / TICK_INTERVALS;

/**
 * 左端の軸。系列ごとの目盛りを列にして、グラフと同じ高さの横罫線に揃える。
 *
 * 系列の記号(▼▲■●)は**ここに描く**。操作行に凡例を並べると、左ペインの幅では
 * 折り返して読めなくなるうえ、軸には既に系列の名前と色があるので二重になる。
 * 記号を軸に載せれば折り返しようがなく、対応がグラフの真横で分かる。
 * 日本語の名前(収縮期・脈拍…)はホバーに出す。
 */
function FlowsheetAxis({ series }: { series: ChartSeries[] }) {
  const columns = series.filter((s) => s.axis);
  const colWidth = 36;
  const width = columns.length * colWidth;
  /** その軸の列に描く記号。血圧は収縮期 ▼ と拡張期 ▲ の 2 つ。 */
  const markersOf = (spec: ChartSeries) =>
    series.filter((candidate) => candidate.className === spec.className);
  return (
    <svg
      className="vital-flowsheet__axis"
      width={width}
      height={CHART_HEIGHT}
      viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
      role="img"
      aria-label="グラフの目盛り"
    >
      {columns.map((s, col) => {
        const x = width - (columns.length - col - 0.5) * colWidth;
        const markers = markersOf(s);
        return (
          <g key={s.key} className={`vital-flowsheet__series vital-flowsheet__series--${s.className}`}>
            <title>{markers.map((marker) => marker.legend).join(" / ")}</title>
            {markers.map((marker, index) => (
              <g
                key={marker.key}
                className="vital-flowsheet__marker vital-flowsheet__axis-marker"
              >
                {markerShape(
                  marker.marker,
                  // 2 つあるときは左右に振り分ける(▼▲)。
                  x + (index - (markers.length - 1) / 2) * 10,
                  7,
                )}
              </g>
            ))}
            <text className="vital-flowsheet__axis-name" x={x} y={24} textAnchor="middle">
              {s.name}
            </text>
            {Array.from({ length: TICK_INTERVALS + 1 }, (_, i) => (
              <text
                key={i}
                className={`vital-flowsheet__axis-tick${i === BASELINE_TICK ? " vital-flowsheet__axis-tick--base" : ""}`}
                x={x}
                y={tickY(i) + 3.5}
                textAnchor="middle"
              >
                {s.min + s.step * i}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function markerShape(marker: ChartMarker, x: number, y: number) {
  const r = 3.5;
  switch (marker) {
    case "square":
      return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} />;
    // 血圧は温度板の慣例で収縮期を ▼、拡張期を ▲ にする。
    case "triangle-down":
      return <path d={`M${x},${y + r + 0.5} L${x + r + 0.5},${y - r} L${x - r - 0.5},${y - r} Z`} />;
    case "triangle-up":
      return <path d={`M${x},${y - r - 0.5} L${x + r + 0.5},${y + r} L${x - r - 0.5},${y + r} Z`} />;
    default:
      return <circle cx={x} cy={y} r={r} />;
  }
}

function FlowsheetChart({
  columns,
  columnWidth,
  series,
  eventXs,
}: {
  columns: DayColumn[];
  columnWidth: number;
  series: ChartSeries[];
  /** イベントの帯の ▼ と同じ位置に落とす縦線(その日の中央)。 */
  eventXs: number[];
}) {
  const width = columns.length * columnWidth;
  const xOf = (index: number) => (index + 0.5) * columnWidth;
  const yOf = (s: ChartSeries, value: number) =>
    CHART_PAD.top + PLOT_H - ((value - s.min) / (s.max - s.min)) * PLOT_H;

  // 目盛りの横罫線(主)と、区間を 2 等分する補助線。
  const majorLines = Array.from({ length: TICK_INTERVALS + 1 }, (_, i) => tickY(i));
  const minorLines = Array.from({ length: TICK_INTERVALS }, (_, i) => tickY(i + 0.5));

  return (
    <svg
      className="vital-flowsheet__chart"
      width={width}
      height={CHART_HEIGHT}
      viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
      role="img"
      aria-label="バイタルの推移グラフ"
    >
      {minorLines.map((y) => (
        <line key={y} className="vital-flowsheet__grid vital-flowsheet__grid--minor" x1={0} x2={width} y1={y} y2={y} />
      ))}
      {majorLines.map((y, i) => (
        <line
          key={y}
          className={`vital-flowsheet__grid${i === BASELINE_TICK ? " vital-flowsheet__grid--base" : ""}`}
          x1={0}
          x2={width}
          y1={y}
          y2={y}
        />
      ))}
      {/* 列の区切り線。表のセルの縦罫線と同じ位置に引いて、グラフの点がどの列の
          測定かを目で追えるようにする(点は列の中央に載る)。 */}
      {columns.map((column, index) => (
        <line
          key={column.key}
          className="vital-flowsheet__grid vital-flowsheet__grid--column"
          x1={(index + 1) * columnWidth}
          x2={(index + 1) * columnWidth}
          y1={0}
          y2={CHART_HEIGHT}
        />
      ))}
      {/* イベントの縦線。帯の ▼ から折れ線まで目で追えるよう、破線で通す。 */}
      {eventXs.map((x, index) => (
        <line
          key={`event-${index}`}
          className="vital-flowsheet__grid vital-flowsheet__grid--event"
          x1={x}
          x2={x}
          y1={0}
          y2={CHART_HEIGHT}
        />
      ))}
      {series.map((s) => {
        const points = columns.flatMap((column, index) => {
          const value = column.at ? s.numbers.get(column.at) : undefined;
          return value == null || !column.at
            ? []
            : [{ at: column.at, value, x: xOf(index), y: yOf(s, value) }];
        });
        if (points.length === 0) return null;
        const path = points
          .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
          .join(" ");
        return (
          <g key={s.key} className={`vital-flowsheet__series vital-flowsheet__series--${s.className}`}>
            <path className="vital-flowsheet__line" d={path} />
            {points.map((p) => (
              <g
                key={p.at}
                className={interpretationClass(
                  s.interpretations.get(p.at) ?? "",
                  "vital-flowsheet__marker",
                )}
              >
                <title>
                  {s.name} {p.value}
                  {s.unit} ({flowsheetColumnLabel(p.at).date} {flowsheetColumnLabel(p.at).time})
                </title>
                {markerShape(s.marker, p.x, p.y)}
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
