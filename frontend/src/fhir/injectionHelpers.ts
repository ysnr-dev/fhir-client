import { addDays, diffDays, today } from "../lib/dates";
import type { OrderContext } from "../orderContext";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import { toFhirDateTime } from "./clinicalNoteHelpers";
import { categoryCoding, displayOf, orderComment } from "./shared";
import {
  MEDICINE_CODE_SYSTEM,
  ORDER_IN_RP_SYSTEM,
  ORDER_TYPE_SYSTEM,
  RP_NUMBER_SYSTEM,
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  UNITS_OF_MEASURE_SYSTEM,
  YJ_CODE_SYSTEM,
  applyOrderContext,
  codingBySystem,
  identifierValue,
  medicineFromCoding,
  type MedicineLineDisplay,
  type MedicineLineValues,
  type PrescriptionSetting,
  emptyMedicineLine,
} from "./prescriptionHelpers";

// 注射オーダー(JAHIS注射データ交換規約 / JP_MedicationRequest_Injection 参考)。
// 処方と同じく ServiceRequest(オーダーヘッダ) + 薬剤ごとの MedicationRequest で表現し、
// RP(剤グループ) = 同じルートから同時に投与する薬剤のまとまり(混注)とする。
//
// 用法は JP Core の JP_MedicationDosage_Injection に寄せて dosageInstruction に持つ:
//   - route:  投与経路。JP Core route-codes(HL7 Table 0162 ベース)
//   - site:   投与部位。JAMI標準用法規格 表13 外用部位コード(SS-MIX2 でも利用)
//   - method: 手技。JAMI詳細用法コード(2桁)の注射手技(30〜3Z)
//   - ライン: JP Core の JP_MedicationDosage_Line 拡張(公式コード表が無いためローカルコード)
//   - 投与速度: doseAndRate.rateQuantity(mL/h)
//   - 開始時刻: timing.event(複数可)
//   - 用法種別(点滴/ワンショット): 対応する標準コード表が存在しないためローカル拡張

// 処方の ServiceRequest と区別するためのオーダー種別(CodeSystem は
// prescriptionHelpers の ORDER_TYPE_SYSTEM を検体検査と共有する)。
export const INJECTION_ORDER_TYPE = { code: "injection", display: "注射" };

// 注射区分。処方区分(処方の CATEGORY_SYSTEM)と選択肢が違うので別のコードシステムにする。
const CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/injection-category";

// ---- 連日オーダー(期間展開) ----
//
// 注射は 1 施行(= 1 日)ごとに実施入力・払出・算定をするので、「◯日間」と指定された
// 注射は 1 日 1 オーダー(ServiceRequest + MedicationRequest)に展開して一括登録する
// (docs/injection-order-design.md §3)。展開した各日のオーダーは同じ requisition
// (uuid)で束ね、開始日を root 拡張に焼き付けて「何日目」かを出せるようにする。
// 束ねの検索は上流に requisition パラメータが無いので、患者 + 注射 + 日付で引いて
// クライアント側で requisition を突き合わせる(queries.ts の useInjectionSeriesLater)。
export const INJECTION_SERIES_SYSTEM = "http://fhir-client.local/Identifier/injection-series";
export const SERIES_START_EXT_URL =
  "http://fhir-client.local/StructureDefinition/injection-series-start";
// 実施パターン(毎日・N日ごと・曜日指定)。看護指示の頻度と同じく root 拡張の valueTiming
// で持つ(occurrence[x] は choice で occurrenceDateTime と併用できないため)。
export const SERIES_SCHEDULE_EXT_URL =
  "http://fhir-client.local/StructureDefinition/injection-series-schedule";
/** 一度に展開できるオーダー数の上限。 */
export const MAX_INJECTION_ORDERS = 14;
/** 開始日から終了日までに指定できる期間の上限(日)。曜日指定で長い期間を張れるようにする。 */
export const MAX_INJECTION_SPAN_DAYS = 90;

/** FHIR の Timing.repeat.dayOfWeek と同じコード。 */
export const DAY_OF_WEEK_OPTIONS: { code: string; label: string }[] = [
  { code: "mon", label: "月" },
  { code: "tue", label: "火" },
  { code: "wed", label: "水" },
  { code: "thu", label: "木" },
  { code: "fri", label: "金" },
  { code: "sat", label: "土" },
  { code: "sun", label: "日" },
];

/** 実施パターン。期間(開始日〜終了日)の中で、どの日にオーダーを立てるか。 */
export type InjectionSchedule =
  /** 毎日。 */
  | { kind: "daily" }
  /** N 日ごと(2 なら隔日)。開始日を 1 回目とする。 */
  | { kind: "interval"; intervalDays: number }
  /** 指定した曜日。 */
  | { kind: "weekly"; days: string[] };

export const DAILY_SCHEDULE: InjectionSchedule = { kind: "daily" };

export interface InjectionSeries {
  /** 同時に展開したオーダー群を束ねる uuid(ServiceRequest.requisition)。 */
  requisition: string;
  /** 展開の開始日(YYYY-MM-DD)。 */
  start: string;
  /** 展開の終了日。単日の束ねでは開始日と同じ。 */
  end: string;
  /** 実施パターン。古いデータ・単日のオーダーは毎日として扱う。 */
  schedule: InjectionSchedule;
}

// 束ねを FHIR の Timing にする。毎日は Timing で表現するものが無いので持たせない
// (拡張が無い = 毎日。古いデータもそう読める)。
function scheduleTiming(series: InjectionSeries): fhir4.Timing | null {
  const { schedule, start, end } = series;
  const bounds: fhir4.Period = { start, end };
  if (schedule.kind === "interval") {
    return { repeat: { boundsPeriod: bounds, period: schedule.intervalDays, periodUnit: "d" } };
  }
  if (schedule.kind === "weekly") {
    return {
      repeat: {
        boundsPeriod: bounds,
        period: 1,
        periodUnit: "wk",
        dayOfWeek: schedule.days as fhir4.TimingRepeat["dayOfWeek"],
      },
    };
  }
  return null;
}

function scheduleFromTiming(timing: fhir4.Timing | undefined): InjectionSchedule {
  const repeat = timing?.repeat;
  if (repeat?.dayOfWeek?.length) return { kind: "weekly", days: [...repeat.dayOfWeek] };
  if (repeat?.periodUnit === "d" && (repeat.period ?? 1) > 1) {
    return { kind: "interval", intervalDays: repeat.period ?? 1 };
  }
  return DAILY_SCHEDULE;
}

/** 保存済みの注射から連日オーダーの束ね情報を読む。単日で登録したものも 1 日の束ねを持つ。 */
export function injectionSeriesOf(sr: fhir4.ServiceRequest): InjectionSeries | null {
  const requisition =
    sr.requisition?.system === INJECTION_SERIES_SYSTEM ? sr.requisition.value : undefined;
  const start = sr.extension?.find((e) => e.url === SERIES_START_EXT_URL)?.valueDate;
  if (!requisition || !start) return null;
  const timing = sr.extension?.find((e) => e.url === SERIES_SCHEDULE_EXT_URL)?.valueTiming;
  return {
    requisition,
    start,
    end: timing?.repeat?.boundsPeriod?.end ?? start,
    schedule: scheduleFromTiming(timing),
  };
}

/** 連日オーダーの「N日目」(1 始まり)。束ね情報が無ければ null。 */
export function injectionSeriesDay(sr: fhir4.ServiceRequest): number | null {
  const series = injectionSeriesOf(sr);
  const date = sr.authoredOn?.slice(0, 10);
  if (!series || !date) return null;
  return diffDays(series.start, date) + 1;
}

/** 実施パターンの短い表示(「毎日」「2日ごと」「月・水・金」)。 */
export function scheduleLabel(schedule: InjectionSchedule): string {
  if (schedule.kind === "interval") {
    return schedule.intervalDays === 2 ? "隔日" : `${schedule.intervalDays}日ごと`;
  }
  if (schedule.kind === "weekly") {
    const labels = DAY_OF_WEEK_OPTIONS.filter((o) => schedule.days.includes(o.code)).map(
      (o) => o.label,
    );
    return labels.length ? `毎週 ${labels.join("・")}` : "毎週";
  }
  return "毎日";
}

// カード・詳細に添える連日オーダーの要約(「連日 3日目(8/30〜)」「隔日(8/30〜)」)。
// 総日数は保存していない(後続日の削除で変わる)ので出さない。毎日のときだけ「N日目」を
// 出せる(間引きのあるパターンは開始日からの差が回数と一致しないため)。開始日そのものの
// オーダーは単日の注射と見分けが付かないので、毎日なら空にする。
export function injectionSeriesLabel(sr: fhir4.ServiceRequest): string {
  const series = injectionSeriesOf(sr);
  const day = injectionSeriesDay(sr);
  if (!series || day == null) return "";
  const [, m, d] = series.start.split("-");
  const from = `${Number(m)}/${Number(d)}〜`;
  if (series.schedule.kind === "daily") {
    return day === 1 ? "" : `連日 ${day}日目(${from})`;
  }
  return `${scheduleLabel(series.schedule)}(${from})`;
}

// 用法種別(点滴/ワンショット)。JAHIS・JP Core に対応するコード表が無いためローカル定義。
const USAGE_TYPE_EXT_URL = "http://fhir-client.local/StructureDefinition/injection-usage-type";
const USAGE_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/injection-usage-type";

// 投与経路。JP Core route-codes(HL7 Table 0162 ベース)のうち注射で使うもの。
// 放射線検査の造影剤(経口・注腸を含む)も同じコード表を使う。
export const ROUTE_SYSTEM = "http://jpfhir.jp/fhir/core/CodeSystem/route-codes";

// 投与部位。JAMI標準用法規格 表13 外用部位コード(urn:oid:1.2.392.200250.2.2.20.32)。
const SITE_SYSTEM = "urn:oid:1.2.392.200250.2.2.20.32";

// 手技。JAMI詳細用法コード(urn:oid:1.2.392.200250.2.2.20.40)の注射手技(30〜3Z)。
const METHOD_SYSTEM = "urn:oid:1.2.392.200250.2.2.20.40";

// ライン。拡張 URL は JP Core の JP_MedicationDosage_Line、コードは公式表が無いためローカル。
const LINE_EXT_URL = "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_MedicationDosage_Line";
const LINE_SYSTEM = "http://fhir-client.local/CodeSystem/injection-line";

export interface CodeOption {
  code: string;
  display: string;
}

// 注射区分。入外区分(処方と共通の SETTING_OPTIONS)で選択肢が変わる。
export const CATEGORY_OPTIONS: Record<Exclude<PrescriptionSetting, "">, CodeOption[]> = {
  inpatient: [
    { code: "regular", display: "定時" },
    { code: "temporary", display: "臨時" },
    { code: "emergency", display: "緊急" },
  ],
  outpatient: [{ code: "outpatient", display: "外来" }],
};

export type InjectionUsageType = "drip" | "one-shot";

export const USAGE_TYPE_OPTIONS: { code: InjectionUsageType; display: string }[] = [
  { code: "drip", display: "点滴" },
  { code: "one-shot", display: "ワンショット" },
];

/** 点滴のときの投与経路の既定値。点滴はほぼ静脈内なので未選択なら入れる。 */
export const DRIP_DEFAULT_ROUTE = "IV";

export const ROUTE_OPTIONS: CodeOption[] = [
  { code: "IV", display: "静脈内" },
  { code: "IM", display: "筋肉内" },
  { code: "SC", display: "皮下" },
  { code: "ID", display: "皮内" },
  { code: "IA", display: "動脈内" },
  { code: "IT", display: "髄腔内" },
  { code: "IP", display: "腹腔内" },
];

// JAMI詳細用法コードの注射手技全 23 区分。
export const METHOD_OPTIONS: CodeOption[] = [
  { code: "30", display: "静脈注射" },
  { code: "31", display: "中心静脈注射" },
  { code: "32", display: "皮下注射" },
  { code: "33", display: "筋肉内注射" },
  { code: "34", display: "皮内注射" },
  { code: "35", display: "動脈注射" },
  { code: "3A", display: "硬膜外注射" },
  { code: "3B", display: "脳脊髄腔注射" },
  { code: "3C", display: "骨髄内注射" },
  { code: "3D", display: "関節腔内注射" },
  { code: "3E", display: "腱鞘内注射" },
  { code: "3F", display: "腱鞘周囲注射" },
  { code: "3G", display: "硝子体内注射" },
  { code: "3H", display: "結膜下注射" },
  { code: "3J", display: "テノン氏のう内注射" },
  { code: "3K", display: "耳茸内注射" },
  { code: "3L", display: "咽頭注射" },
  { code: "3M", display: "胸腔内注射" },
  { code: "3N", display: "痔核注射" },
  { code: "3P", display: "角膜内注射" },
  { code: "3Q", display: "球後注射" },
  { code: "3R", display: "腹腔内注射" },
  { code: "3Z", display: "局所・病巣内注射" },
];

// JAMI外用部位コードから注射でよく使う部位を抜粋(表示名はコード表のまま)。
export const SITE_OPTIONS: CodeOption[] = [
  { code: "74L", display: "左上腕" },
  { code: "74R", display: "右上腕" },
  { code: "75L", display: "左前腕" },
  { code: "75R", display: "右前腕" },
  { code: "72L", display: "左上肢" },
  { code: "72R", display: "右上肢" },
  { code: "92L", display: "左ふともも" },
  { code: "92R", display: "右ふともも" },
  { code: "8DL", display: "左臀部" },
  { code: "8DR", display: "右臀部" },
  { code: "8D0", display: "臀部" },
  { code: "890", display: "上腹部" },
  { code: "8A0", display: "下腹部" },
  { code: "91L", display: "左下肢" },
  { code: "91R", display: "右下肢" },
];

// 投与経路から手技が一意に決まる組み合わせ。静脈内(IV)だけは末梢の静脈注射(30)と
// 中心静脈注射(31)のどちらもありうるため入れない。
const ROUTE_METHODS: Record<string, string> = {
  IM: "33", // 筋肉内 → 筋肉内注射
  SC: "32", // 皮下 → 皮下注射
  ID: "34", // 皮内 → 皮内注射
  IA: "35", // 動脈内 → 動脈注射
  IT: "3B", // 髄腔内 → 脳脊髄腔注射
  IP: "3R", // 腹腔内 → 腹腔内注射
};

/**
 * 投与経路を選んだときの手技。経路から一意に決まるならその手技にする。決まらない
 * (静脈内・未選択)場合は今の手技を残すが、別の経路に固有の手技(経路を選び直す前に
 * 自動で入ったもの)なら経路と食い違うので落とす。
 */
export function methodForRoute(routeCode: string, currentMethod: string): string {
  const unique = ROUTE_METHODS[routeCode];
  if (unique) return unique;
  return Object.values(ROUTE_METHODS).includes(currentMethod) ? "" : currentMethod;
}

export const LINE_OPTIONS: CodeOption[] = [
  { code: "peripheral", display: "末梢ルート" },
  { code: "peripheral-side", display: "末梢ルート(側管)" },
  { code: "central", display: "中心静脈ルート" },
  { code: "central-side", display: "中心静脈ルート(側管)" },
];

function findCategoryDisplay(setting: PrescriptionSetting, code: string): string {
  if (!setting) return code;
  return displayOf(CATEGORY_OPTIONS[setting], code);
}

// 投与時間の選択肢。総投与量(mL)をこの時間で割って投与速度(mL/h)を出す。
export const INFUSION_HOURS_OPTIONS: { value: string; display: string }[] = [
  { value: "0.5", display: "30分" },
  { value: "1", display: "1時間" },
  { value: "1.5", display: "1時間30分" },
  { value: "2", display: "2時間" },
  { value: "3", display: "3時間" },
  { value: "4", display: "4時間" },
  { value: "5", display: "5時間" },
  { value: "6", display: "6時間" },
  { value: "8", display: "8時間" },
  { value: "12", display: "12時間" },
  { value: "24", display: "24時間" },
];

export interface RpDoseTotal {
  /** mL に換算できた薬剤の合計(mL)。 */
  ml: number;
  /** mL 換算できなかった薬剤の数(粉末バイアル等、容量がマスタに無いもの)。 */
  unconvertible: number;
}

/**
 * RP の総投与量。投与量は薬価算定単位(管・瓶・袋…)で入力するので、投与量換算マスタの
 * 係数(1[薬価算定単位] = factor[mL])を掛けて mL に揃えてから合計する。
 */
export function rpDoseTotal(
  medicines: MedicineLineValues[],
  mlFactors: Map<string, number>,
): RpDoseTotal {
  let ml = 0;
  let unconvertible = 0;
  for (const line of medicines) {
    const code = line.medicine?.medicine_code;
    const dose = Number(line.dose);
    if (!code || !line.dose || !Number.isFinite(dose)) continue;
    const factor = mlFactors.get(code);
    if (factor === undefined) unconvertible += 1;
    else ml += dose * factor;
  }
  return { ml, unconvertible };
}

/** 総投与量(mL)と投与時間から投与速度(mL/h)を求める。表示・保存とも小数第 1 位まで。 */
export function infusionRate(totalMl: number, hours: string): string {
  const h = Number(hours);
  if (!totalMl || !h) return "";
  return String(Math.round((totalMl / h) * 10) / 10);
}

export interface InjectionRpValues {
  usageType: InjectionUsageType | "";
  routeCode: string;
  siteCode: string;
  methodCode: string;
  lineCode: string;
  /** 投与速度(mL/h)。点滴のときのみ使用。infusionHours を選んでいる間は自動計算値で埋まる。 */
  rate: string;
  /**
   * 投与時間。総投与量から投与速度を自動計算するための入力で、FHIR には保存しない
   * (保存するのは計算結果の投与速度)。空なら投与速度を直接入力する。
   */
  infusionHours: string;
  /** 開始時刻(HH:mm)。日付は注射日を使う。複数設定可能。 */
  startTimes: string[];
  usageComment: string;
  medicines: MedicineLineValues[];
}

export interface InjectionFormValues {
  setting: PrescriptionSetting;
  category: string;
  /** 注射日。連日オーダーではその開始日。 */
  authoredDate: string;
  /** 期間の終了日。新規登録でのみ意味を持ち、編集では注射日と同じ(1 日分を直す)。 */
  endDate: string;
  /** 実施パターン。新規登録でのみ意味を持つ。 */
  schedule: InjectionSchedule;
  comment: string;
  // 対象プロブレム(POMR)。null なら特定の問題に紐付かない注射。
  problem: ProblemRef | null;
  rps: InjectionRpValues[];
  /** 保存済みオーダーの束ね情報。編集時に引き継ぎ、新規・DO では null(登録時に採番)。 */
  series: InjectionSeries | null;
}

/** 入外区分に対応する注射区分。選択肢が 1 つだけならそれを既定にする。 */
export function defaultCategory(setting: PrescriptionSetting): string {
  const options = setting ? CATEGORY_OPTIONS[setting] : [];
  return options.length === 1 ? options[0].code : "";
}

export const emptyInjectionRp: InjectionRpValues = {
  usageType: "",
  routeCode: "",
  siteCode: "",
  methodCode: "",
  lineCode: "",
  rate: "",
  infusionHours: "",
  startTimes: [],
  usageComment: "",
  medicines: [{ ...emptyMedicineLine }],
};

export function emptyInjectionForm(
  problem: ProblemRef | null = null,
  setting: PrescriptionSetting = "outpatient",
): InjectionFormValues {
  return {
    setting,
    category: defaultCategory(setting),
    authoredDate: today(),
    endDate: today(),
    schedule: DAILY_SCHEDULE,
    comment: "",
    problem,
    rps: [{ ...emptyInjectionRp, startTimes: [], medicines: [{ ...emptyMedicineLine }] }],
    series: null,
  };
}

// ---- FHIR dateTime との相互変換 ----
//
// 開始時刻はフォーム上は時刻(HH:mm)だけを持ち、日付は注射日を使う。FHIR の dateTime は
// 時刻を持つならタイムゾーンが必須なので、実行環境のオフセットを付けて保存する。

/** FHIR の dateTime から時刻(HH:mm)だけを取り出す。 */
function toLocalTime(fhirDateTime: string): string {
  return fhirDateTime.slice(11, 16);
}

// ---- FHIR リソースの組み立て ----

// ServiceRequest が注射オーダーかどうか。処方(注射より前から存在し order-type を
// 持たない)との振り分けに使うため、category のローカルコードだけを見る。
export function isInjectionServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return (sr.category ?? []).some((category) =>
    category.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === INJECTION_ORDER_TYPE.code,
    ),
  );
}

function usageTypeDisplay(code: string): string {
  return USAGE_TYPE_OPTIONS.find((o) => o.code === code)?.display ?? code;
}

// カルテカードなどに出す用法 1 行の要約(「点滴 静脈内 左前腕 100mL/h」)。
function usageSummaryText(rp: InjectionRpValues): string {
  return [
    rp.usageType ? usageTypeDisplay(rp.usageType) : "",
    rp.methodCode ? displayOf(METHOD_OPTIONS, rp.methodCode) : "",
    rp.routeCode ? displayOf(ROUTE_OPTIONS, rp.routeCode) : "",
    rp.siteCode ? displayOf(SITE_OPTIONS, rp.siteCode) : "",
    rp.lineCode ? displayOf(LINE_OPTIONS, rp.lineCode) : "",
    rp.usageType === "drip" && rp.rate ? `${rp.rate}mL/h` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildInjectionMedicationRequest(
  rp: InjectionRpValues,
  medLine: MedicineLineValues,
  rpNumber: number,
  orderInRp: number,
  patientId: string,
  authoredOn: string,
  serviceRequestReference: string,
  requester: OrderContext,
): fhir4.MedicationRequest {
  const dosageInstruction: fhir4.Dosage = {
    text: usageSummaryText(rp) || undefined,
  };

  if (rp.usageType) {
    dosageInstruction.extension = [
      {
        url: USAGE_TYPE_EXT_URL,
        valueCodeableConcept: {
          coding: [
            {
              system: USAGE_TYPE_SYSTEM,
              code: rp.usageType,
              display: usageTypeDisplay(rp.usageType),
            },
          ],
        },
      },
    ];
  }
  if (rp.lineCode) {
    dosageInstruction.extension = [
      ...(dosageInstruction.extension ?? []),
      {
        url: LINE_EXT_URL,
        valueCodeableConcept: {
          coding: [
            { system: LINE_SYSTEM, code: rp.lineCode, display: displayOf(LINE_OPTIONS, rp.lineCode) },
          ],
        },
      },
    ];
  }

  if (rp.startTimes.length) {
    dosageInstruction.timing = {
      event: rp.startTimes.map((time) => toFhirDateTime(`${authoredOn}T${time}`)),
    };
  }
  if (rp.routeCode) {
    dosageInstruction.route = {
      coding: [
        { system: ROUTE_SYSTEM, code: rp.routeCode, display: displayOf(ROUTE_OPTIONS, rp.routeCode) },
      ],
    };
  }
  if (rp.siteCode) {
    dosageInstruction.site = {
      coding: [
        { system: SITE_SYSTEM, code: rp.siteCode, display: displayOf(SITE_OPTIONS, rp.siteCode) },
      ],
    };
  }
  if (rp.methodCode) {
    dosageInstruction.method = {
      coding: [
        {
          system: METHOD_SYSTEM,
          code: rp.methodCode,
          display: displayOf(METHOD_OPTIONS, rp.methodCode),
        },
      ],
    };
  }

  const doseAndRate: fhir4.DosageDoseAndRate = {};
  if (medLine.dose) {
    doseAndRate.doseQuantity = {
      value: Number(medLine.dose),
      unit: medLine.medicine?.unit_name ?? undefined,
    };
  }
  // 投与速度は用法(RP)の値だが、FHIR 上は各 MedicationRequest に持つしかないので
  // 同じ RP の全薬剤に同じ値を入れる(用法コードなどと同じ扱い)。
  if (rp.usageType === "drip" && rp.rate) {
    doseAndRate.rateQuantity = {
      value: Number(rp.rate),
      unit: "mL/h",
      system: UNITS_OF_MEASURE_SYSTEM,
      code: "mL/h",
    };
  }
  if (doseAndRate.doseQuantity || doseAndRate.rateQuantity) {
    dosageInstruction.doseAndRate = [doseAndRate];
  }

  if (rp.usageComment) {
    dosageInstruction.additionalInstruction = [{ text: rp.usageComment }];
  }

  const resource: fhir4.MedicationRequest = {
    resourceType: "MedicationRequest",
    status: "active",
    intent: "order",
    identifier: [
      { system: RP_NUMBER_SYSTEM, value: String(rpNumber) },
      { system: ORDER_IN_RP_SYSTEM, value: String(orderInRp) },
    ],
    medicationCodeableConcept: medLine.medicine
      ? {
          coding: [
            {
              system: MEDICINE_CODE_SYSTEM,
              code: medLine.medicine.medicine_code,
              display: medLine.medicine.name,
            },
            ...(medLine.medicine.yj_code
              ? [
                  {
                    system: YJ_CODE_SYSTEM,
                    code: medLine.medicine.yj_code,
                    display: medLine.medicine.name,
                  },
                ]
              : []),
          ],
          text: medLine.medicine.name,
        }
      : undefined,
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    basedOn: [{ reference: serviceRequestReference }],
    dosageInstruction: [dosageInstruction],
  };

  if (medLine.id) resource.id = medLine.id;

  applyOrderContext(resource, requester);

  if (medLine.comment) {
    resource.note = [{ text: medLine.comment }];
  }

  return resource;
}

// 処方の buildPrescriptionTransactionBundle と同じ構成。ServiceRequest の category に
// オーダー種別(注射)を持たせる点と、orderDetail の拡張 URL を共用する点だけ異なる。
const ORDER_DETAIL_MR_EXT_URL =
  "http://fhir-client.local/StructureDefinition/prescription-medication-request";

// 1 日分(ServiceRequest 1 本 + 薬剤の MedicationRequest)の transaction entry を組む。
// 連日オーダーは日ごとにこれを呼んで entry を 1 つの Bundle に連ねる。
function buildInjectionDayEntries(
  values: InjectionFormValues,
  patientId: string,
  requester: OrderContext,
  series: InjectionSeries,
  serviceRequestId?: string,
  originalMedicationRequestIds?: string[],
): fhir4.BundleEntry[] {
  const authoredOn = values.authoredDate;
  const seriesTiming = scheduleTiming(series);
  const serviceRequestReference = serviceRequestId
    ? `ServiceRequest/${serviceRequestId}`
    : `urn:uuid:${crypto.randomUUID()}`;

  const orderDetail: fhir4.CodeableConcept[] = [];
  const medicationEntries: fhir4.BundleEntry[] = [];
  const keptMedicationRequestIds = new Set<string>();

  values.rps.forEach((rp, rpIndex) => {
    const rpNumber = rpIndex + 1;
    rp.medicines.forEach((medLine, medIndex) => {
      const orderInRp = medIndex + 1;
      const resource = buildInjectionMedicationRequest(
        rp,
        medLine,
        rpNumber,
        orderInRp,
        patientId,
        authoredOn,
        serviceRequestReference,
        requester,
      );

      const fullUrl = medLine.id ? `MedicationRequest/${medLine.id}` : `urn:uuid:${crypto.randomUUID()}`;
      if (medLine.id) keptMedicationRequestIds.add(medLine.id);

      medicationEntries.push({
        fullUrl,
        resource,
        request: medLine.id
          ? { method: "PUT", url: `MedicationRequest/${medLine.id}` }
          : { method: "POST", url: "MedicationRequest" },
      });
      orderDetail.push({
        extension: [
          {
            url: ORDER_DETAIL_MR_EXT_URL,
            valueReference: { reference: fullUrl },
          },
        ],
        text: `RP${rpNumber}-${orderInRp}`,
      });
    });
  });

  const serviceRequest: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    // 読み出し側(summarizeInjectionServiceRequest)は system で引くので順序には依存しない。
    category: [
      {
        coding: [{ system: ORDER_TYPE_SYSTEM, ...INJECTION_ORDER_TYPE }],
      },
      {
        coding: [
          {
            system: SETTING_SYSTEM,
            code: values.setting,
            display: displayOf(SETTING_OPTIONS, values.setting),
          },
        ],
      },
      {
        coding: [
          {
            system: CATEGORY_SYSTEM,
            code: values.category,
            display: findCategoryDisplay(values.setting, values.category),
          },
        ],
      },
    ],
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    orderDetail,
    requisition: { system: INJECTION_SERIES_SYSTEM, value: series.requisition },
    extension: [
      { url: SERIES_START_EXT_URL, valueDate: series.start },
      // 実施パターンは束ね全体の性質なので、展開した全日に同じものを焼き付ける。
      ...(seriesTiming ? [{ url: SERIES_SCHEDULE_EXT_URL, valueTiming: seriesTiming }] : []),
    ],
  };

  if (serviceRequestId) serviceRequest.id = serviceRequestId;
  if (values.problem) {
    serviceRequest.reasonReference = [
      {
        reference: `Condition/${values.problem.conditionId}`,
        display: values.problem.display,
      },
    ];
  }
  applyOrderContext(serviceRequest, requester);
  if (values.comment) {
    serviceRequest.note = [{ text: values.comment }];
  }

  const removedMedicationRequestEntries: fhir4.BundleEntry[] = (originalMedicationRequestIds ?? [])
    .filter((id) => !keptMedicationRequestIds.has(id))
    .map((id) => ({ request: { method: "DELETE", url: `MedicationRequest/${id}` } }));

  return [
    {
      fullUrl: serviceRequestReference,
      resource: serviceRequest,
      request: serviceRequestId
        ? { method: "PUT", url: `ServiceRequest/${serviceRequestId}` }
        : { method: "POST", url: "ServiceRequest" },
    },
    ...medicationEntries,
    ...removedMedicationRequestEntries,
  ];
}

function transactionBundle(entry: fhir4.BundleEntry[]): fhir4.Bundle {
  return { resourceType: "Bundle", type: "transaction", entry };
}

/** YYYY-MM-DD の曜日コード(Timing.repeat.dayOfWeek と同じ)。 */
function dayOfWeekCode(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  // getDay() は 0=日曜。DAY_OF_WEEK_OPTIONS は月曜始まりなので 1 つずらす。
  return DAY_OF_WEEK_OPTIONS[(new Date(y, m - 1, d).getDay() + 6) % 7].code;
}

// 期間(注射日〜終了日)を実施パターンで間引いた、オーダーを立てる日付。開始日は
// パターンの起点なので、毎日・N 日ごとでは必ず入る(曜日指定では曜日が合うときだけ)。
export function injectionDates(
  values: Pick<InjectionFormValues, "authoredDate" | "endDate" | "schedule">,
): string[] {
  const start = values.authoredDate;
  if (!start) return [];
  const end = values.endDate && values.endDate > start ? values.endDate : start;
  const span = Math.min(diffDays(start, end), MAX_INJECTION_SPAN_DAYS);
  const schedule = values.schedule;

  const dates: string[] = [];
  for (let i = 0; i <= span && dates.length < MAX_INJECTION_ORDERS; i++) {
    const date = addDays(start, i);
    if (schedule.kind === "interval") {
      if (i % Math.max(Math.trunc(schedule.intervalDays) || 1, 1) !== 0) continue;
    } else if (schedule.kind === "weekly") {
      if (!schedule.days.includes(dayOfWeekCode(date))) continue;
    }
    dates.push(date);
  }
  return dates.length ? dates : [start];
}

// 新規登録。投与日数ぶんを 1 日 1 オーダーに展開し、同じ requisition で束ねて
// 1 つの transaction で登録する(全日成功か全日失敗か)。
export function buildInjectionBundle(
  values: InjectionFormValues,
  patientId: string,
  requester: OrderContext,
): fhir4.Bundle {
  const dates = injectionDates(values);
  const series: InjectionSeries = {
    requisition: crypto.randomUUID(),
    start: values.authoredDate,
    // 実際に展開した最後の日を終了日にする(上限で打ち切ったときに入力値と食い違わない)。
    end: dates[dates.length - 1],
    schedule: values.schedule,
  };
  return transactionBundle(
    dates.flatMap((date) =>
      buildInjectionDayEntries({ ...values, authoredDate: date }, patientId, requester, series),
    ),
  );
}

// 1 日分の更新。束ね情報は保存済みのものを引き継ぐ(古いデータで無ければ単日の束ねを作る)。
export function buildInjectionUpdateBundle(
  values: InjectionFormValues,
  patientId: string,
  serviceRequestId: string,
  originalMedicationRequestIds: string[],
  requester: OrderContext,
): fhir4.Bundle {
  // 束ね情報は保存済みのものをそのまま戻す(1 日分の更新でパターン・期間は変えない)。
  const series = values.series ?? {
    requisition: crypto.randomUUID(),
    start: values.authoredDate,
    end: values.authoredDate,
    schedule: DAILY_SCHEDULE,
  };
  return transactionBundle(
    buildInjectionDayEntries(
      values,
      patientId,
      requester,
      series,
      serviceRequestId,
      originalMedicationRequestIds,
    ),
  );
}

/** 連日オーダーの 1 日分(ヘッダと薬剤)。 */
export interface InjectionDayTarget {
  serviceRequest: fhir4.ServiceRequest;
  medicationRequests: fhir4.MedicationRequest[];
}

// 「この日以降」の一括更新。編集中の日と同じ束ねの後続日すべてに、同じ内容
// (注射日だけは各日のもの)を書き込む。各日の MedicationRequest は差し替え
// (id を持つ薬剤行は編集中の日のものなので後続日では新規扱いにし、元の行は消す)。
export function buildInjectionSeriesUpdateBundle(
  values: InjectionFormValues,
  patientId: string,
  targets: InjectionDayTarget[],
  requester: OrderContext,
): fhir4.Bundle {
  const fallback: InjectionSeries = {
    requisition: crypto.randomUUID(),
    start: values.authoredDate,
    end: values.authoredDate,
    schedule: DAILY_SCHEDULE,
  };
  return transactionBundle(
    targets.flatMap((target) => {
      const sr = target.serviceRequest;
      const date = sr.authoredOn?.slice(0, 10) ?? values.authoredDate;
      const own = date === values.authoredDate;
      const dayValues: InjectionFormValues = own
        ? { ...values, authoredDate: date }
        : {
            ...values,
            authoredDate: date,
            rps: values.rps.map((rp) => ({
              ...rp,
              medicines: rp.medicines.map(({ id: _id, ...rest }) => rest),
            })),
          };
      const originalIds = target.medicationRequests
        .map((mr) => mr.id)
        .filter((id): id is string => Boolean(id));
      return buildInjectionDayEntries(
        dayValues,
        patientId,
        requester,
        injectionSeriesOf(sr) ?? values.series ?? fallback,
        sr.id,
        originalIds,
      );
    }),
  );
}

/** 複数日のオーダーをまとめて削除する(処方の削除 Bundle と同じ組み立てを日数ぶん連ねる)。 */
export function buildInjectionSeriesDeleteBundle(serviceRequestIds: string[]): fhir4.Bundle {
  return transactionBundle(
    serviceRequestIds.flatMap((id) => [
      { request: { method: "DELETE" as const, url: `ServiceRequest/${id}` } },
      { request: { method: "DELETE" as const, url: `MedicationRequest?based-on=ServiceRequest/${id}` } },
    ]),
  );
}

// 既存の注射を DO(流用)して新規登録するためのフォーム値に変換する。処方の DO と同じく
// id を落として新規登録(POST)にし、注射日は当日にする。開始時刻は時刻だけを持ち
// 日付は注射日から決まるので、そのまま引き継げる。入外区分もいまの患者の状態に合わせ、
// DO 元と変わるなら注射区分は選び直させる(選択肢が 1 つの外来はそれを入れる)。
export function buildDoInjectionForm(
  values: InjectionFormValues,
  setting: PrescriptionSetting,
): InjectionFormValues {
  return {
    ...values,
    setting,
    category: setting === values.setting ? values.category : defaultCategory(setting),
    authoredDate: today(),
    endDate: today(),
    schedule: DAILY_SCHEDULE,
    series: null,
    rps: values.rps.map((rp) => ({
      ...rp,
      medicines: rp.medicines.map(({ id: _id, ...rest }) => rest),
    })),
  };
}

// ---- 一覧・カルテ表示のための parse ----

export interface InjectionRpDisplay {
  rpNumber: number;
  usageTypeDisplay?: string;
  routeDisplay?: string;
  siteDisplay?: string;
  methodDisplay?: string;
  lineDisplay?: string;
  /** 投与速度(mL/h)。 */
  rate?: number;
  /** 開始時刻(HH:mm)。 */
  startTimes: string[];
  usageComment?: string;
  medicines: MedicineLineDisplay[];
}

function extensionCoding(
  extensions: fhir4.Extension[] | undefined,
  url: string,
): fhir4.Coding | undefined {
  return extensions?.find((e) => e.url === url)?.valueCodeableConcept?.coding?.[0];
}

export function groupInjectionByRp(mrs: fhir4.MedicationRequest[]): InjectionRpDisplay[] {
  const groups = new Map<number, InjectionRpDisplay>();

  for (const mr of mrs) {
    const rpNumber = Number(identifierValue(mr, RP_NUMBER_SYSTEM) ?? "0");
    const orderInRp = Number(identifierValue(mr, ORDER_IN_RP_SYSTEM) ?? "0");
    const dosage = mr.dosageInstruction?.[0];

    let group = groups.get(rpNumber);
    if (!group) {
      const doseAndRate = dosage?.doseAndRate?.[0];
      group = {
        rpNumber,
        usageTypeDisplay: extensionCoding(dosage?.extension, USAGE_TYPE_EXT_URL)?.display,
        routeDisplay: dosage?.route?.coding?.[0]?.display,
        siteDisplay: dosage?.site?.coding?.[0]?.display,
        methodDisplay: dosage?.method?.coding?.[0]?.display,
        lineDisplay: extensionCoding(dosage?.extension, LINE_EXT_URL)?.display,
        rate: doseAndRate?.rateQuantity?.value,
        startTimes: (dosage?.timing?.event ?? []).map(toLocalTime),
        usageComment: dosage?.additionalInstruction?.[0]?.text,
        medicines: [],
      };
      groups.set(rpNumber, group);
    }

    const medicineCoding = codingBySystem(mr.medicationCodeableConcept?.coding, MEDICINE_CODE_SYSTEM);
    const yjCoding = codingBySystem(mr.medicationCodeableConcept?.coding, YJ_CODE_SYSTEM);

    group.medicines.push({
      orderInRp,
      code: medicineCoding?.code ?? "",
      name: medicineCoding?.display ?? mr.medicationCodeableConcept?.text ?? "",
      yjCode: yjCoding?.code ?? undefined,
      dose: dosage?.doseAndRate?.[0]?.doseQuantity?.value,
      unit: dosage?.doseAndRate?.[0]?.doseQuantity?.unit,
      comment: mr.note?.[0]?.text,
    });
  }

  const result = Array.from(groups.values());
  result.forEach((g) => g.medicines.sort((a, b) => a.orderInRp - b.orderInRp));
  result.sort((a, b) => a.rpNumber - b.rpNumber);
  return result;
}

export interface InjectionSummary {
  settingDisplay: string;
  categoryDisplay: string;
}

// category はオーダー種別・入外区分・注射区分の 3 つを持つので、処方(添字で引く
// summarizeServiceRequest)と違い system で引く(shared の categoryCoding を使う)。
export function summarizeInjectionServiceRequest(sr: fhir4.ServiceRequest): InjectionSummary {
  return {
    settingDisplay: categoryCoding(sr, SETTING_SYSTEM)?.display ?? "",
    categoryDisplay: categoryCoding(sr, CATEGORY_SYSTEM)?.display ?? "",
  };
}

export const injectionComment = orderComment;
// 注射が対象としているプロブレム。処方と同じく reasonReference の Condition 参照を拾う。
export const injectionProblem = orderProblem;

// ---- 編集フォームへの復元 ----

export function parseInjectionForm(
  sr: fhir4.ServiceRequest,
  mrs: fhir4.MedicationRequest[],
): InjectionFormValues {
  const rpGroups = new Map<
    number,
    InjectionRpValues & { medicinesByOrder: Map<number, MedicineLineValues> }
  >();

  for (const mr of mrs) {
    const rpNumber = Number(identifierValue(mr, RP_NUMBER_SYSTEM) ?? "0");
    const orderInRp = Number(identifierValue(mr, ORDER_IN_RP_SYSTEM) ?? "0");
    const dosage = mr.dosageInstruction?.[0];

    let group = rpGroups.get(rpNumber);
    if (!group) {
      const doseAndRate = dosage?.doseAndRate?.[0];
      group = {
        usageType: (extensionCoding(dosage?.extension, USAGE_TYPE_EXT_URL)?.code ??
          "") as InjectionUsageType | "",
        routeCode: dosage?.route?.coding?.[0]?.code ?? "",
        siteCode: dosage?.site?.coding?.[0]?.code ?? "",
        methodCode: dosage?.method?.coding?.[0]?.code ?? "",
        lineCode: extensionCoding(dosage?.extension, LINE_EXT_URL)?.code ?? "",
        rate:
          doseAndRate?.rateQuantity?.value != null ? String(doseAndRate.rateQuantity.value) : "",
        // 投与時間は保存していないので、編集時は投与速度を直接入力する状態に戻す。
        infusionHours: "",
        startTimes: (dosage?.timing?.event ?? []).map(toLocalTime),
        usageComment: dosage?.additionalInstruction?.[0]?.text ?? "",
        medicines: [],
        medicinesByOrder: new Map(),
      };
      rpGroups.set(rpNumber, group);
    }

    const doseValue = dosage?.doseAndRate?.[0]?.doseQuantity?.value;
    group.medicinesByOrder.set(orderInRp, {
      id: mr.id,
      medicine: medicineFromCoding(mr),
      dose: doseValue != null ? String(doseValue) : "",
      comment: mr.note?.[0]?.text ?? "",
    });
  }

  const rps: InjectionRpValues[] = Array.from(rpGroups.entries())
    .sort(([a], [b]) => a - b)
    .map(([, group]) => ({
      usageType: group.usageType,
      routeCode: group.routeCode,
      siteCode: group.siteCode,
      methodCode: group.methodCode,
      lineCode: group.lineCode,
      rate: group.rate,
      infusionHours: group.infusionHours,
      startTimes: group.startTimes,
      usageComment: group.usageComment,
      medicines: Array.from(group.medicinesByOrder.entries())
        .sort(([a], [b]) => a - b)
        .map(([, medLine]) => medLine),
    }));

  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    category: categoryCoding(sr, CATEGORY_SYSTEM)?.code ?? "",
    authoredDate: sr.authoredOn?.slice(0, 10) ?? today(),
    endDate: sr.authoredOn?.slice(0, 10) ?? today(),
    schedule: injectionSeriesOf(sr)?.schedule ?? DAILY_SCHEDULE,
    comment: injectionComment(sr),
    problem: injectionProblem(sr),
    rps: rps.length
      ? rps
      : [{ ...emptyInjectionRp, startTimes: [], medicines: [{ ...emptyMedicineLine }] }],
    series: injectionSeriesOf(sr),
  };
}
