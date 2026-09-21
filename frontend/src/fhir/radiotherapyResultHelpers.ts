import { today } from "../lib/dates";
import { toFhirDateTime } from "./clinicalNoteHelpers";
import { ORDER_TYPE_SYSTEM } from "./prescriptionHelpers";
import {
  RADIOTHERAPY_ORDER_TYPE,
  formatDose,
  summarizeRadiotherapyOrder,
  type RadiotherapyCoded,
  type RadiotherapyOrderSummary,
} from "./radiotherapyOrderHelpers";

// 放射線治療の照射記録。**1 回の照射 = Procedure 1 件**で、治療コースの間に何十件も
// 積み上がる(docs/radiotherapy-order-design.md §6.1)。
//
//   ServiceRequest(治療処方)
//    └ basedOn ← Procedure (1 回の照射)
//         status     = preparation(照射予定) | completed(照射した) | not-done(中止した回)
//         statusReason = 中止の理由(休止・中止理由マスタ)
//         category   = order-type|radiotherapy ＋ radiotherapy-procedure|fraction
//         code       = 照射方法(モダリティ + 照射技法の写し。照射録の法定項目)
//         performedPeriod = 照射の開始・終了時刻
//         performer  = 実施者(診療放射線技師)
//         usedCode   = 使用した治療装置
//         extension[radiotherapy-fraction]
//           phaseId / fractionNumber / imageGuidance
//           doseDeliveredToVolume ×M { volume(volumeId), dose(Gy) }
//
// **照射予定も同じ Procedure で持つ**(status=preparation)。部門が処方の回数ぶんを一括で
// 作り、当日は予定を開いて実績に書き換える(同じ Procedure への PUT。§7)。予約枠(Slot)を
// 使わないのは手術と同じ判断で、照射の時間割は装置ごとに部門が組み、休止のたびにまとめて
// ずれるため(docs/surgery-calendar-design.md §1)。
//
// リハビリ・栄養指導と同じ「期間継続型」なので、**照射しても進捗 Task は動かさない**。
// Task は「部門の受け入れ状態」(計画中 → 治療中 → 終了)で、治療中の間に照射が積み上がる
// (docs/radiotherapy-order-design.md §4)。終了は部門一覧の「終了」操作の担当。
//
// リハビリと違うのは**取消を物理削除にしない**こと。照射録は診療放射線技師法施行規則の
// 保存対象なので、消さずに status=entered-in-error にする(§8)。
//
// 指示医師・指示内容は basedOn の治療処方から辿る(照射記録に焼き直さない)。照射記録は
// 処方なしでは作れないので、法定項目の「指示した医師」「指示の内容」は必ず辿れる。

/** JP Core の Procedure プロファイル。上流の登録先。 */
const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";

/**
 * 放射線治療の Procedure の種別。治療コースには照射記録(fraction)と、後続フェーズの
 * 治療終了サマリー(course-summary)がぶら下がるので、category の 2 つ目の coding で分ける
 * (1 つ目は他オーダーと同じ order-type で、上流の category 列にはこちらが入る)。
 */
export const PROCEDURE_KIND_SYSTEM = "http://fhir-client.local/CodeSystem/radiotherapy-procedure";
export const FRACTION_KIND = { code: "fraction", display: "照射" };

const FRACTION_EXT_URL = "http://fhir-client.local/StructureDefinition/radiotherapy-fraction";
const DEVICE_SYSTEM = "http://fhir-client.local/CodeSystem/radiotherapy-device";
const STOP_REASON_SYSTEM = "http://fhir-client.local/CodeSystem/radiotherapy-stop-reason";
const IMAGE_GUIDANCE_SYSTEM = "http://fhir-client.local/CodeSystem/radiotherapy-image-guidance";
const UCUM_SYSTEM = "http://unitsofmeasure.org";
const DOSE_UNIT = "Gy";

/** 位置照合(IGRT)の方法。施設で増減しないのでフロントの定数。 */
export const IMAGE_GUIDANCE_OPTIONS = [
  { code: "none", display: "なし" },
  { code: "cbct", display: "CBCT" },
  { code: "kv", display: "kV 画像" },
  { code: "mv", display: "MV 画像" },
  { code: "surface", display: "体表面照合" },
  { code: "other", display: "その他" },
];

// ---- 実施入力フォームの値 ----

export interface RadiotherapyFractionFormValues {
  /** 照射予定から開いたときの Procedure.id。登録はその予定を実績に書き換える(PUT)。 */
  plannedId?: string;
  performedDate: string;
  /** 照射の開始・終了時刻(HH:mm)。開始だけでもよい。 */
  startTime: string;
  endTime: string;
  /** どの Phase の照射か。 */
  phaseId: string;
  /** 何回目か(その Phase の中での通し番号)。 */
  fractionNumber: string;
  /** volumeId → 実照射線量(Gy)。既定は処方の 1 回線量。 */
  doses: Record<string, string>;
  device: RadiotherapyCoded;
  imageGuidance: string;
  performerId: string;
  performerName: string;
  note: string;
  /** 照射しなかった回として記録する(中止・患者都合など)。 */
  notDone: boolean;
  notDoneReason: RadiotherapyCoded;
}

const EMPTY_CODED: RadiotherapyCoded = { code: "", name: "" };

/**
 * 次に照射する回の初期値。進行中の Phase(まだ処方回数に達していない先頭の Phase)を選び、
 * 回数はその Phase の実施済み件数 + 1、線量は処方の 1 回線量を入れる。
 */
export function nextRadiotherapyFractionForm(
  summary: RadiotherapyOrderSummary,
  fractions: RadiotherapyFractionDisplay[],
): RadiotherapyFractionFormValues {
  // 照射予定があれば、いちばん早い予定を実績に書き換える(予定を残したまま別の記録を足さない)。
  const planned = fractions
    .filter((fraction) => fraction.planned)
    .sort((a, b) => a.performedAt.localeCompare(b.performedAt))[0];
  if (planned) return radiotherapyFractionFormFromPlanned(summary, planned);

  const done = deliveredCountByPhase(fractions);
  const phase =
    summary.phases.find((p) => p.status === "active" && (done.get(p.phaseId) ?? 0) < p.fractions) ??
    summary.phases.find((p) => p.status === "active") ??
    summary.phases[0];

  return {
    performedDate: today(),
    startTime: "",
    endTime: "",
    phaseId: phase?.phaseId ?? "",
    fractionNumber: String((done.get(phase?.phaseId ?? "") ?? 0) + 1),
    doses: Object.fromEntries(
      (phase?.doses ?? []).map((dose) => [dose.volumeId, String(dose.fractionDose)]),
    ),
    device: phase?.deviceName ? { code: phase.deviceCode, name: phase.deviceName } : EMPTY_CODED,
    imageGuidance: "",
    performerId: "",
    performerName: "",
    note: "",
    notDone: false,
    notDoneReason: EMPTY_CODED,
  };
}

/** 照射予定から実施入力を開くときの初期値。日時・Phase・回・装置は予定のもの、線量は処方の値。 */
export function radiotherapyFractionFormFromPlanned(
  summary: RadiotherapyOrderSummary,
  planned: RadiotherapyFractionDisplay,
): RadiotherapyFractionFormValues {
  const phase = summary.phases.find((p) => p.phaseId === planned.phaseId);
  return {
    plannedId: planned.id,
    performedDate: planned.performedDate || today(),
    startTime: planned.startTime,
    endTime: planned.endTime,
    phaseId: planned.phaseId,
    fractionNumber: String(planned.fractionNumber || 1),
    doses: Object.fromEntries(
      (phase?.doses ?? []).map((dose) => [dose.volumeId, String(dose.fractionDose)]),
    ),
    device: { code: planned.deviceCode, name: planned.deviceName },
    imageGuidance: "",
    performerId: "",
    performerName: "",
    note: planned.note,
    notDone: false,
    notDoneReason: EMPTY_CODED,
  };
}

/** Phase を選び直したときに、回数と線量をその Phase のものに入れ替える。 */
export function switchRadiotherapyFractionPhase(
  values: RadiotherapyFractionFormValues,
  summary: RadiotherapyOrderSummary,
  fractions: RadiotherapyFractionDisplay[],
  phaseId: string,
): RadiotherapyFractionFormValues {
  const phase = summary.phases.find((p) => p.phaseId === phaseId);
  const done = deliveredCountByPhase(fractions).get(phaseId) ?? 0;
  return {
    ...values,
    phaseId,
    fractionNumber: String(done + 1),
    doses: Object.fromEntries(
      (phase?.doses ?? []).map((dose) => [dose.volumeId, String(dose.fractionDose)]),
    ),
  };
}

export function validateRadiotherapyFractionForm(
  values: RadiotherapyFractionFormValues,
): string {
  if (!values.performedDate) return "照射日を入れてください。";
  if (!values.phaseId) return "Phase を選んでください。";

  const number = Number(values.fractionNumber);
  if (!Number.isInteger(number) || number < 1) return "何回目かを 1 以上の整数で入れてください。";
  if (values.startTime && values.endTime && values.endTime < values.startTime) {
    return "終了時刻は開始時刻と同じか、それより後にしてください。";
  }

  if (values.notDone) {
    if (!values.notDoneReason.code) return "照射しなかった理由を選んでください。";
    return "";
  }

  const doses = Object.values(values.doses).filter((text) => text.trim() !== "");
  if (doses.length === 0) return "実照射線量を入れてください。";
  if (doses.some((text) => !(Number(text) > 0))) {
    return "実照射線量は正の数で入れてください。";
  }
  if (!values.performerId) return "実施者を選んでください。";
  return "";
}

// ---- 組み立て ----

function doseQuantity(value: number): fhir4.Quantity {
  return { value, unit: DOSE_UNIT, system: UCUM_SYSTEM, code: DOSE_UNIT };
}

function buildFractionProcedure(
  values: RadiotherapyFractionFormValues,
  order: fhir4.ServiceRequest,
  summary: RadiotherapyOrderSummary,
  orderReference: string,
): fhir4.Procedure {
  const phase = summary.phases.find((p) => p.phaseId === values.phaseId);
  const start = values.startTime
    ? toFhirDateTime(`${values.performedDate}T${values.startTime}`)
    : "";
  const end = values.endTime ? toFhirDateTime(`${values.performedDate}T${values.endTime}`) : "";

  const procedure: fhir4.Procedure = {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status: values.notDone ? "not-done" : "completed",
    category: {
      coding: [
        { system: ORDER_TYPE_SYSTEM, ...RADIOTHERAPY_ORDER_TYPE },
        { system: PROCEDURE_KIND_SYSTEM, ...FRACTION_KIND },
      ],
      text: FRACTION_KIND.display,
    },
    // 照射方法(法定の照射録の項目)。処方の Phase から写す。
    code: {
      ...(phase?.techniqueCoding ? { coding: [phase.techniqueCoding] } : {}),
      text: phase?.methodLabel || FRACTION_KIND.display,
    },
    subject: order.subject ?? {},
    basedOn: [{ reference: orderReference }],
    // 時刻を入れたときだけ時刻まで持つ(dateTime に時刻を入れるならタイムゾーンが要る)。
    ...(start
      ? { performedPeriod: { start, ...(end ? { end } : {}) } }
      : { performedDateTime: values.performedDate }),
  };

  if (values.notDone && values.notDoneReason.code) {
    procedure.statusReason = {
      coding: [
        {
          system: STOP_REASON_SYSTEM,
          code: values.notDoneReason.code,
          display: values.notDoneReason.name,
        },
      ],
      text: values.notDoneReason.name,
    };
  }

  if (values.performerId) {
    procedure.performer = [
      {
        actor: {
          reference: `Practitioner/${values.performerId}`,
          display: values.performerName || undefined,
        },
      },
    ];
  }

  if (values.device.code || values.device.name) {
    procedure.usedCode = [
      {
        ...(values.device.code
          ? { coding: [{ system: DEVICE_SYSTEM, code: values.device.code, display: values.device.name }] }
          : {}),
        text: values.device.name,
      },
    ];
  }

  const extension: fhir4.Extension[] = [
    { url: "phaseId", valueString: values.phaseId },
    { url: "fractionNumber", valueInteger: Number(values.fractionNumber) },
  ];
  if (values.imageGuidance) {
    extension.push({
      url: "imageGuidance",
      valueCoding: {
        system: IMAGE_GUIDANCE_SYSTEM,
        code: values.imageGuidance,
        display: IMAGE_GUIDANCE_OPTIONS.find((o) => o.code === values.imageGuidance)?.display,
      },
    });
  }
  // 照射しなかった回は線量を持たない(累積線量に入れない)。
  if (!values.notDone) {
    for (const volume of summary.volumes) {
      const dose = Number(values.doses[volume.volumeId] ?? "");
      if (!(dose > 0)) continue;
      extension.push({
        url: "doseDeliveredToVolume",
        extension: [
          { url: "volume", valueString: volume.volumeId },
          { url: "dose", valueQuantity: doseQuantity(dose) },
        ],
      });
    }
  }
  procedure.extension = [{ url: FRACTION_EXT_URL, extension }];

  if (values.note.trim()) procedure.note = [{ text: values.note.trim() }];

  return procedure;
}

/**
 * 1 回ぶんの照射登録。進捗 Task は動かさない。照射予定から開いたときはその予定を実績に
 * 書き換え(PUT)、予定が無ければ新しく足す(POST)。
 */
export function buildRadiotherapyFractionBundle(
  values: RadiotherapyFractionFormValues,
  order: fhir4.ServiceRequest,
): fhir4.Bundle {
  const summary = summarizeRadiotherapyOrder(order);
  const resource = buildFractionProcedure(values, order, summary, `ServiceRequest/${order.id ?? ""}`);
  if (values.plannedId) resource.id = values.plannedId;
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      values.plannedId
        ? { resource, request: { method: "PUT", url: `Procedure/${values.plannedId}` } }
        : { resource, request: { method: "POST", url: "Procedure" } },
    ],
  };
}

// ---- 照射予定の一括登録(§7) ----

/** 照射予定 1 回ぶん。一括登録の確認表の 1 行。 */
export interface RadiotherapyPlanRow {
  key: string;
  date: string;
  phaseId: string;
  phaseLabel: string;
  fractionNumber: number;
}

export interface RadiotherapyPlanOptions {
  startDate: string;
  /** 照射する曜日(0=日 〜 6=土)。 */
  weekdays: number[];
  /** 開始時刻(HH:mm)と 1 回の所要時間(分)。装置の時間割に載せるのに使う。 */
  startTime: string;
  durationMinutes: string;
  device: RadiotherapyCoded;
}

export function emptyRadiotherapyPlanOptions(startDate: string): RadiotherapyPlanOptions {
  return {
    startDate,
    weekdays: [1, 2, 3, 4, 5],
    startTime: "09:00",
    durationMinutes: "15",
    device: EMPTY_CODED,
  };
}

function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 残りの回数ぶんの照射予定を日付に割り付ける。処方の回数から、照射済みの回と登録済みの予定を
 * 引いた残りを、Phase の並び順に、指定の曜日へ 1 日 1 回ずつ置く。祝日は知らないので、
 * 確認表で行の日付を直すか外してもらう。
 */
export function draftRadiotherapyPlan(
  summary: RadiotherapyOrderSummary,
  fractions: RadiotherapyFractionDisplay[],
  options: RadiotherapyPlanOptions,
): RadiotherapyPlanRow[] {
  if (!options.startDate || options.weekdays.length === 0) return [];

  const taken = new Map<string, number>();
  for (const fraction of fractions) {
    if (fraction.notDone) continue;
    taken.set(fraction.phaseId, Math.max(taken.get(fraction.phaseId) ?? 0, 0) + 1);
  }

  const rows: RadiotherapyPlanRow[] = [];
  let date = options.startDate;
  // 曜日の指定が空でなければ必ず進むが、念のため上限を置く。
  let guard = 0;
  for (const phase of summary.phases) {
    if (phase.status !== "active") continue;
    const from = taken.get(phase.phaseId) ?? 0;
    for (let number = from + 1; number <= phase.fractions; number += 1) {
      while (!options.weekdays.includes(new Date(`${date}T00:00:00`).getDay()) && guard < 5000) {
        date = nextDate(date);
        guard += 1;
      }
      rows.push({
        key: `${phase.phaseId}:${number}`,
        date,
        phaseId: phase.phaseId,
        phaseLabel: phase.label,
        fractionNumber: number,
      });
      date = nextDate(date);
    }
  }
  return rows;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** 照射予定の一括登録。1 回 = Procedure(status=preparation)1 件を、1 つの transaction で作る。 */
export function buildRadiotherapyPlanBundle(
  rows: RadiotherapyPlanRow[],
  options: RadiotherapyPlanOptions,
  order: fhir4.ServiceRequest,
): fhir4.Bundle {
  const summary = summarizeRadiotherapyOrder(order);
  const duration = Number(options.durationMinutes) || 15;
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: rows.map((row) => {
      const resource = buildFractionProcedure(
        {
          performedDate: row.date,
          startTime: options.startTime,
          endTime: options.startTime ? addMinutes(options.startTime, duration) : "",
          phaseId: row.phaseId,
          fractionNumber: String(row.fractionNumber),
          doses: {},
          device: options.device,
          imageGuidance: "",
          performerId: "",
          performerName: "",
          note: "",
          notDone: false,
          notDoneReason: EMPTY_CODED,
        },
        order,
        summary,
        `ServiceRequest/${order.id ?? ""}`,
      );
      resource.status = "preparation";
      return { resource, request: { method: "POST" as const, url: "Procedure" } };
    }),
  };
}

/** 照射予定の日時・装置を変える(予定のままの Procedure への PUT)。 */
export function rescheduleRadiotherapyFraction(
  procedure: fhir4.Procedure,
  change: { date: string; startTime: string; endTime: string; device?: RadiotherapyCoded },
): fhir4.Procedure {
  const next: fhir4.Procedure = { ...procedure };
  delete next.performedDateTime;
  delete next.performedPeriod;
  if (change.startTime) {
    next.performedPeriod = {
      start: toFhirDateTime(`${change.date}T${change.startTime}`),
      ...(change.endTime ? { end: toFhirDateTime(`${change.date}T${change.endTime}`) } : {}),
    };
  } else {
    next.performedDateTime = change.date;
  }
  if (change.device) {
    next.usedCode = change.device.code
      ? [
          {
            coding: [{ system: DEVICE_SYSTEM, code: change.device.code, display: change.device.name }],
            text: change.device.name,
          },
        ]
      : undefined;
  }
  return next;
}

/**
 * 照射記録の取消。**消さずに entered-in-error にする**(照射録は保存の対象なので、
 * 誤登録も「誤りだった」という記録として残す)。
 */
export function buildRadiotherapyFractionCancelBundle(procedure: fhir4.Procedure): fhir4.Bundle {
  const cancelled: fhir4.Procedure = { ...procedure, status: "entered-in-error" };
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      { resource: cancelled, request: { method: "PUT", url: `Procedure/${procedure.id}` } },
    ],
  };
}

// ---- 一覧・カルテへの表示 ----

export interface RadiotherapyFractionDisplay {
  id: string;
  /** 照射日 "YYYY-MM-DD"。並べ替えに使う。 */
  performedDate: string;
  /** "YYYY-MM-DD HH:mm"。時刻を持たない記録では日付だけ。 */
  performedAt: string;
  /** 照射の所要時間の表示("10:05〜10:18")。開始だけなら開始時刻。 */
  timeLabel: string;
  phaseId: string;
  fractionNumber: number;
  /** 照射予定(まだ照射していない)。回数にも累積線量にも数えない。 */
  planned: boolean;
  /** 開始・終了時刻(HH:mm)。カレンダーの位置に使う。 */
  startTime: string;
  endTime: string;
  deviceCode: string;
  /** 照射しなかった回。 */
  notDone: boolean;
  notDoneReason: string;
  methodLabel: string;
  deviceName: string;
  imageGuidance: string;
  performerName: string;
  note: string;
  /** volumeId → 実照射線量(Gy)。 */
  doses: Record<string, number>;
  /** 「9/21 12回目 2 Gy 技師A」の 1 行表示。 */
  label: string;
}

export function isRadiotherapyProcedure(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === RADIOTHERAPY_ORDER_TYPE.code,
    ),
  );
}

/** 照射記録(fraction)か。治療終了サマリー(後続)と振り分ける。 */
export function isRadiotherapyFraction(procedure: fhir4.Procedure): boolean {
  if (!isRadiotherapyProcedure(procedure)) return false;
  const kind = procedure.category?.coding?.find((c) => c.system === PROCEDURE_KIND_SYSTEM)?.code;
  // 種別の coding を持たない古い記録は照射記録として読む(ぶら下がるのが照射だけの間に作ったもの)。
  return kind === undefined || kind === FRACTION_KIND.code;
}

function referenceId(reference: string | undefined, resourceType: string): string {
  return reference?.match(new RegExp(`^${resourceType}/(.+)$`))?.[1] ?? "";
}

function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : date;
}

function toDisplay(procedure: fhir4.Procedure): RadiotherapyFractionDisplay {
  const ext = procedure.extension?.find((e) => e.url === FRACTION_EXT_URL);
  const sub = (url: string) => ext?.extension?.find((e) => e.url === url);
  const start = procedure.performedPeriod?.start ?? procedure.performedDateTime ?? "";
  const end = procedure.performedPeriod?.end ?? "";
  const performedDate = start.slice(0, 10);
  const startTime = start.length > 10 ? start.slice(11, 16) : "";
  const endTime = end.length > 10 ? end.slice(11, 16) : "";

  const doses: Record<string, number> = {};
  for (const dose of ext?.extension?.filter((e) => e.url === "doseDeliveredToVolume") ?? []) {
    const volumeId = dose.extension?.find((e) => e.url === "volume")?.valueString;
    const value = dose.extension?.find((e) => e.url === "dose")?.valueQuantity?.value;
    if (volumeId && typeof value === "number") doses[volumeId] = value;
  }

  const notDone = procedure.status === "not-done";
  const planned = procedure.status === "preparation";
  const fractionNumber = sub("fractionNumber")?.valueInteger ?? 0;
  const total = Object.values(doses).reduce((max, value) => Math.max(max, value), 0);

  return {
    id: procedure.id ?? "",
    performedDate,
    performedAt: startTime ? `${performedDate} ${startTime}` : performedDate,
    timeLabel: startTime ? (endTime ? `${startTime}〜${endTime}` : startTime) : "",
    phaseId: sub("phaseId")?.valueString ?? "",
    fractionNumber,
    planned,
    startTime,
    endTime,
    deviceCode: procedure.usedCode?.[0]?.coding?.find((c) => c.system === DEVICE_SYSTEM)?.code ?? "",
    notDone,
    notDoneReason: procedure.statusReason?.text ?? procedure.statusReason?.coding?.[0]?.display ?? "",
    methodLabel: procedure.code?.text ?? "",
    deviceName: procedure.usedCode?.[0]?.text ?? procedure.usedCode?.[0]?.coding?.[0]?.display ?? "",
    imageGuidance: sub("imageGuidance")?.valueCoding?.display ?? "",
    performerName: procedure.performer?.[0]?.actor?.display ?? "",
    note: procedure.note?.[0]?.text ?? "",
    doses,
    label: [
      shortDate(performedDate),
      fractionNumber ? `${fractionNumber}回目` : "",
      planned ? "予定" : notDone ? "未実施" : total ? `${formatDose(total)} Gy` : "",
      procedure.performer?.[0]?.actor?.display ?? "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/** オーダーの id → その照射記録(新しい順)。取消(entered-in-error)は出さない。 */
export function radiotherapyFractionsByOrderId(
  procedures: fhir4.Procedure[],
): Map<string, RadiotherapyFractionDisplay[]> {
  const byOrderId = new Map<string, RadiotherapyFractionDisplay[]>();

  for (const procedure of procedures) {
    if (!isRadiotherapyFraction(procedure) || procedure.status === "entered-in-error") continue;
    const orderId = referenceId(procedure.basedOn?.[0]?.reference, "ServiceRequest");
    if (!orderId) continue;

    const list = byOrderId.get(orderId);
    if (list) list.push(toDisplay(procedure));
    else byOrderId.set(orderId, [toDisplay(procedure)]);
  }

  for (const list of byOrderId.values()) {
    list.sort((a, b) => b.performedAt.localeCompare(a.performedAt) || b.fractionNumber - a.fractionNumber);
  }
  return byOrderId;
}

/** Phase ごとの実施回数(照射した回だけ数える)。 */
function deliveredCountByPhase(fractions: RadiotherapyFractionDisplay[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const fraction of fractions) {
    if (fraction.notDone || fraction.planned) continue;
    counts.set(fraction.phaseId, (counts.get(fraction.phaseId) ?? 0) + 1);
  }
  return counts;
}

export interface RadiotherapyVolumeProgress {
  volumeId: string;
  label: string;
  /** 処方の総線量。 */
  prescribedDose: number;
  /** 実照射線量の累計。 */
  deliveredDose: number;
  /** 「24 / 60 Gy」。 */
  doseLabel: string;
}

export interface RadiotherapyProgress {
  /** 照射した回数。 */
  delivered: number;
  /** 処方の分割回数の合計(中止した Phase は除く)。 */
  prescribed: number;
  /** 照射しなかった回(未実施として記録したもの)。 */
  notDone: number;
  /** 照射予定(まだ照射していない)の件数と、その最初の日。 */
  planned: number;
  nextPlannedDate: string;
  /** 「12 / 30 回」。 */
  fractionLabel: string;
  volumes: RadiotherapyVolumeProgress[];
  /** 最終照射日。 */
  lastDate: string;
  /** 処方の回数に達したか。 */
  finished: boolean;
}

/** 累積線量と進み具合(docs/radiotherapy-order-design.md §6.1)。 */
export function radiotherapyProgress(
  summary: RadiotherapyOrderSummary,
  fractions: RadiotherapyFractionDisplay[],
): RadiotherapyProgress {
  const active = fractions.filter((f) => !f.notDone && !f.planned);
  const planned = fractions.filter((f) => f.planned);
  const prescribed = summary.phases
    .filter((phase) => phase.status === "active")
    .reduce((sum, phase) => sum + phase.fractions, 0);

  const volumes = summary.volumes.map((volume) => {
    // 線量は cGy の整数で足す(0.1 刻みの実照射線量を何十回も足すと誤差が出る)。
    const cGy = active.reduce(
      (sum, fraction) => sum + Math.round((fraction.doses[volume.volumeId] ?? 0) * 100),
      0,
    );
    const deliveredDose = cGy / 100;
    return {
      volumeId: volume.volumeId,
      label: volume.label,
      prescribedDose: volume.totalDose,
      deliveredDose,
      doseLabel: `${formatDose(deliveredDose)} / ${formatDose(volume.totalDose)} ${DOSE_UNIT}`,
    };
  });

  return {
    delivered: active.length,
    prescribed,
    notDone: fractions.length - active.length - planned.length,
    planned: planned.length,
    nextPlannedDate: planned.map((f) => f.performedDate).sort()[0] ?? "",
    fractionLabel: `${active.length} / ${prescribed} 回`,
    volumes,
    lastDate: active[0]?.performedDate ?? "",
    finished: prescribed > 0 && active.length >= prescribed,
  };
}

/** Phase の名前(照射記録の phaseId から引く)。処方から消えた Phase は「(不明)」。 */
export function radiotherapyFractionPhaseLabel(
  summary: RadiotherapyOrderSummary,
  phaseId: string,
): string {
  return summary.phases.find((p) => p.phaseId === phaseId)?.label ?? "(不明)";
}
