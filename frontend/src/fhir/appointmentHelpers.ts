// 予約(Appointment)の組み立て・復元。
//
// 予約は「枠(Slot)を押さえること」なので、Appointment を作る/取り消すときは必ず
// Slot の status も一緒に動かす。両者がずれると、埋まっているのに空きに見える枠や、
// 誰も予約していないのに埋まっている枠ができる。そのため書き込みはすべて
// transaction Bundle にして、片方だけが通ることを防ぐ。
//
// なお Bundle の中の PUT には If-Match が付かないので、二人が同じ枠を同時に押さえる
// 取り合いまでは防げない。1 施設で予約を取る端末が限られる前提で今回は許容している。
import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
import type { ProblemRef } from "./conditionHelpers";
import { SSMIX2_DEPARTMENT_CODE_SYSTEM } from "./departmentCodes";
import { displayName } from "./patientHelpers";
import {
  APPOINTMENT_TYPE_SYSTEM,
  DEFAULT_APPOINTMENT_TYPE,
  appointmentTypeLabel,
  scheduleName,
  slotTime,
  toDateInput,
} from "./scheduleHelpers";

export const APPOINTMENT_STATUS_OPTIONS = [
  { code: "proposed", label: "提案" },
  { code: "pending", label: "承諾待ち" },
  { code: "booked", label: "予約済" },
  { code: "arrived", label: "来院" },
  { code: "checked-in", label: "受付済" },
  { code: "fulfilled", label: "診療済" },
  { code: "cancelled", label: "取消" },
  { code: "noshow", label: "未来院" },
  { code: "waitlist", label: "キャンセル待ち" },
  { code: "entered-in-error", label: "誤登録" },
] as const;

export function appointmentStatusLabel(status: string | undefined): string {
  if (!status) return "-";
  return APPOINTMENT_STATUS_OPTIONS.find((o) => o.code === status)?.label ?? status;
}

/** 取り消せる予約(まだ来院・診療が済んでいないもの)。 */
export function isActiveAppointment(appointment: fhir4.Appointment): boolean {
  return ["proposed", "pending", "booked", "arrived", "checked-in", "waitlist"].includes(
    appointment.status,
  );
}

/** 受付できる予約(まだ受付が済んでいないもの)。外来一覧の「受付」の出し分けに使う。 */
export function canCheckInAppointment(appointment: fhir4.Appointment): boolean {
  return ["proposed", "pending", "booked", "arrived", "waitlist"].includes(appointment.status);
}

export interface AppointmentFormValues {
  comment: string;
}

export const emptyAppointmentForm: AppointmentFormValues = {
  comment: "",
};

/**
 * 予約 1 件。日時・担当医・診察室は押さえた枠(Slot)と枠表(Schedule)から埋めるので、
 * 画面で入力するのはメモだけ。
 *
 * slots は 1 件以上。所要時間が枠長を超える検査予約は連続した複数枠を 1 予約で
 * 押さえる(Appointment.slot は 0..*)。start/end は列の先頭と末尾から取る。
 */
export function buildAppointment(
  values: AppointmentFormValues,
  patient: fhir4.Patient,
  schedule: fhir4.Schedule,
  slots: fhir4.Slot[],
  problem?: ProblemRef,
  id?: string,
): fhir4.Appointment {
  const first = slots[0];
  const last = slots[slots.length - 1];
  const practitioner = schedule.actor?.find((a) => a.reference?.startsWith("Practitioner/"));
  const location = schedule.actor?.find((a) => a.reference?.startsWith("Location/"));

  // participant の先頭は必ず患者。上流はここから患者を索引しており、これが無いと
  // 患者コンパートメント(Patient/$everything やカルテの検索)に入らない。
  const participant: fhir4.AppointmentParticipant[] = [
    {
      actor: { reference: `Patient/${patient.id}`, display: displayName(patient) },
      required: "required",
      status: "accepted",
    },
  ];
  if (practitioner) {
    participant.push({ actor: practitioner, required: "required", status: "accepted" });
  }
  if (location) {
    participant.push({ actor: location, required: "required", status: "accepted" });
  }

  const appointment: fhir4.Appointment = {
    resourceType: "Appointment",
    status: "booked",
    appointmentType: {
      coding: [
        {
          system: APPOINTMENT_TYPE_SYSTEM,
          code: DEFAULT_APPOINTMENT_TYPE,
          display: appointmentTypeLabel(DEFAULT_APPOINTMENT_TYPE),
        },
      ],
    },
    description: scheduleName(schedule),
    // app-2: start と end は「両方あるか両方無いか」。枠から取るので必ず両方入る。
    start: first.start,
    end: last.end,
    minutesDuration: minutesBetween(first.start, last.end),
    slot: slots.map((slot) => ({ reference: `Slot/${slot.id}` })),
    participant,
  };

  if (id) appointment.id = id;

  if (schedule.serviceType) appointment.serviceType = schedule.serviceType;
  if (schedule.specialty) appointment.specialty = schedule.specialty;
  if (values.comment.trim()) appointment.comment = values.comment.trim();

  // 何のための受診かを残す。他のオーダーの reasonReference と同じ扱い。
  if (problem?.conditionId) {
    appointment.reasonReference = [
      { reference: `Condition/${problem.conditionId}`, display: problem.display },
    ];
  }

  return appointment;
}

// ---- 当日受付 ----

/** 当日受付の予約が押さえる名目の時間(分)。 */
const WALK_IN_MINUTES = 15;

export interface WalkInFormValues {
  /** SS-MIX2 統一診療科コード。院内独自の科は空になり得る。 */
  departmentCode: string;
  departmentName: string;
  practitionerId: string;
  practitionerName: string;
  locationId: string;
  locationName: string;
}

/**
 * 当日受付。予約なしで来院した患者を、枠(Slot)を持たない予約として受付済で作る。
 * 枠がないので Slot の status を動かす transaction は要らず、単体の POST でよい。
 *
 * app-2 / app-3 により受付済(checked-in)の予約は start / end が必須なので、
 * 受付時刻から名目の時間を入れる(診察の実時間を表すものではない)。
 */
export function buildWalkInAppointment(
  patient: fhir4.Patient,
  values: WalkInFormValues,
  receivedAt: Date,
): fhir4.Appointment {
  const participant: fhir4.AppointmentParticipant[] = [
    // participant の先頭は必ず患者(buildAppointment と同じ理由)。
    {
      actor: { reference: `Patient/${patient.id}`, display: displayName(patient) },
      required: "required",
      status: "accepted",
    },
  ];
  if (values.practitionerId) {
    participant.push({
      actor: {
        reference: `Practitioner/${values.practitionerId}`,
        display: values.practitionerName || undefined,
      },
      required: "required",
      status: "accepted",
    });
  }
  if (values.locationId) {
    participant.push({
      actor: { reference: `Location/${values.locationId}`, display: values.locationName || undefined },
      required: "required",
      status: "accepted",
    });
  }

  const appointment: fhir4.Appointment = {
    resourceType: "Appointment",
    status: "checked-in",
    appointmentType: {
      coding: [
        {
          system: APPOINTMENT_TYPE_SYSTEM,
          code: "WALKIN",
          display: appointmentTypeLabel("WALKIN"),
        },
      ],
    },
    // 予約枠を持たないので、枠名の代わりに「当日受付」を出す(appointmentScheduleLabel)。
    description: appointmentTypeLabel("WALKIN"),
    start: toFhirDateTime(toDateTimeInput(receivedAt)),
    end: toFhirDateTime(
      toDateTimeInput(new Date(receivedAt.getTime() + WALK_IN_MINUTES * 60_000)),
    ),
    minutesDuration: WALK_IN_MINUTES,
    participant,
  };

  // 診療科。コードのある科は枠から取った予約(buildSchedule)と同じ形にし、
  // コード未設定の院内独自科は名前だけ残す。
  if (values.departmentCode) {
    appointment.specialty = [
      {
        coding: [
          {
            system: SSMIX2_DEPARTMENT_CODE_SYSTEM,
            code: values.departmentCode,
            display: values.departmentName || undefined,
          },
        ],
        text: values.departmentName || undefined,
      },
    ];
  } else if (values.departmentName) {
    appointment.specialty = [{ text: values.departmentName }];
  }

  return appointment;
}

function minutesBetween(start: string, end: string): number | undefined {
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return undefined;
  return Math.round((to - from) / 60_000);
}

// ---- 書き込み(Appointment と Slot は必ず同じ transaction で動かす) ----

function slotEntry(slot: fhir4.Slot, status: fhir4.Slot["status"]): fhir4.BundleEntry {
  const updated: fhir4.Slot = { ...slot, status };
  return {
    resource: updated,
    request: { method: "PUT", url: `Slot/${slot.id}` },
  };
}

/** 予約する枠の選択。枠選択 UI(AppointmentSlotPicker)の結果。 */
export interface SlotSelection {
  schedule: fhir4.Schedule;
  /**
   * 押さえる枠。1 件以上で、所要時間が枠長を超える検査予約は連続した複数枠になる
   * (先頭が開始、末尾が終了)。
   */
  slots: fhir4.Slot[];
}

/**
 * 検査予約を放射線オーダーの transaction に同梱するためのエントリ。
 * Appointment はオーダーヘッダを basedOn で指す。新規登録では headerReference が
 * urn:uuid なので、サーバー側で採番後の id に解決される。
 *
 * 予約はモーダルで枠を「選ぶだけ」で、オーダー登録のこの transaction で初めて
 * 書かれる。オーダーをやめれば何も残らない(予約だけが先に立つ孤児を作らない)。
 */
export function buildExamAppointmentEntries(
  patient: fhir4.Patient,
  selection: SlotSelection,
  headerReference: string,
): fhir4.BundleEntry[] {
  const appointment = buildAppointment(
    emptyAppointmentForm,
    patient,
    selection.schedule,
    selection.slots,
  );
  appointment.basedOn = [{ reference: headerReference }];

  return [
    { resource: appointment, request: { method: "POST", url: "Appointment" } },
    ...selection.slots.map((slot) => slotEntry(slot, "busy")),
  ];
}

/** オーダーに紐づく予約(検査予約)か。予約タブでの操作の出し分けに使う。 */
export function isExamAppointment(appointment: fhir4.Appointment): boolean {
  return Boolean(appointment.basedOn?.length);
}

/** 予約を取る。押さえた枠(複数枠の検査予約は全部)は busy にする。 */
export function buildBookBundle(appointment: fhir4.Appointment, slots: fhir4.Slot[]): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      { resource: appointment, request: { method: "POST", url: "Appointment" } },
      ...slots.map((slot) => slotEntry(slot, "busy")),
    ],
  };
}

/**
 * 予約の取消エントリ(Appointment を cancelled に、押さえていた枠を空きに戻す)。
 * 単体の取消のほか、放射線オーダーの削除 transaction にもこのまま同梱する。
 * app-4 により cancelationReason は cancelled / noshow のときだけ持てる。
 */
export function buildCancelEntries(
  appointment: fhir4.Appointment,
  slots: fhir4.Slot[],
): fhir4.BundleEntry[] {
  const cancelled: fhir4.Appointment = { ...appointment, status: "cancelled" };

  return [
    {
      resource: cancelled,
      request: { method: "PUT", url: `Appointment/${appointment.id}` },
    },
    ...slots.map((slot) => slotEntry(slot, "free")),
  ];
}

/** 予約を取り消す。押さえていた枠は空きに戻す。 */
export function buildCancelBundle(
  appointment: fhir4.Appointment,
  slots: fhir4.Slot[],
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: buildCancelEntries(appointment, slots),
  };
}

/**
 * 日時を変えるエントリ。古い枠を空きに戻し、新しい枠を押さえ、予約の日時を差し替える。
 * 診察予約の日時変更(予約タブ)のほか、放射線オーダーの更新 transaction にもこのまま
 * 同梱する(検査予約の日時はオーダーの編集画面から変える)。
 */
export function buildRescheduleEntries(
  appointment: fhir4.Appointment,
  oldSlots: fhir4.Slot[],
  newSlots: fhir4.Slot[],
): fhir4.BundleEntry[] {
  const first = newSlots[0];
  const last = newSlots[newSlots.length - 1];
  const moved: fhir4.Appointment = {
    ...appointment,
    start: first.start,
    end: last.end,
    minutesDuration: minutesBetween(first.start, last.end),
    slot: newSlots.map((slot) => ({ reference: `Slot/${slot.id}` })),
  };

  // 同じ枠に取り直した場合に free で上書きしないよう、古い枠から新しい枠を除く。
  const newIds = new Set(newSlots.map((slot) => slot.id));

  return [
    { resource: moved, request: { method: "PUT", url: `Appointment/${appointment.id}` } },
    ...oldSlots.filter((slot) => !newIds.has(slot.id)).map((slot) => slotEntry(slot, "free")),
    ...newSlots.map((slot) => slotEntry(slot, "busy")),
  ];
}

/** 日時を変える。 */
export function buildRescheduleBundle(
  appointment: fhir4.Appointment,
  oldSlots: fhir4.Slot[],
  newSlots: fhir4.Slot[],
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: buildRescheduleEntries(appointment, oldSlots, newSlots),
  };
}

// ---- 表示 ----

export function appointmentSlotIds(appointment: fhir4.Appointment): string[] {
  return (appointment.slot ?? [])
    .map((ref) => ref.reference?.split("/").pop())
    .filter((id): id is string => Boolean(id));
}

export function appointmentActorDisplay(
  appointment: fhir4.Appointment,
  resourceType: string,
): string {
  return actorReference(appointment, resourceType)?.display ?? "";
}

export function appointmentActorId(appointment: fhir4.Appointment, resourceType: string): string {
  return actorReference(appointment, resourceType)?.reference?.split("/").pop() ?? "";
}

function actorReference(
  appointment: fhir4.Appointment,
  resourceType: string,
): fhir4.Reference | undefined {
  return appointment.participant?.find((p) => p.actor?.reference?.startsWith(`${resourceType}/`))
    ?.actor;
}

/** 予約が引き継いでいる診療科コード(SS-MIX2)。日時変更で枠表を絞る初期値に使う。 */
export function appointmentDepartmentCode(appointment: fhir4.Appointment): string {
  return appointment.specialty?.[0]?.coding?.[0]?.code ?? "";
}

/** 予約の診療科名。 */
export function appointmentDepartmentLabel(appointment: fhir4.Appointment): string {
  const specialty = appointment.specialty?.[0];
  return specialty?.coding?.[0]?.display || specialty?.text || "";
}

/** 予約の開始時刻「09:00」。外来一覧の並び順の手掛かり。 */
export function appointmentTimeLabel(appointment: fhir4.Appointment): string {
  return appointment.start?.slice(11, 16) ?? "-";
}

/** 「2026-08-19(水) 09:00〜09:15」。 */
export function appointmentDateTimeLabel(appointment: fhir4.Appointment): string {
  if (!appointment.start) return "-";
  const start = new Date(appointment.start);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][start.getDay()];
  const time = appointment.start.slice(11, 16);
  const endTime = appointment.end ? `〜${appointment.end.slice(11, 16)}` : "";
  return `${toDateInput(start)}(${weekday}) ${time}${endTime}`;
}

/** 新しい予約が上に来る並び(過去の予約は下)。 */
export function sortAppointmentsByStartDesc(
  appointments: fhir4.Appointment[],
): fhir4.Appointment[] {
  return [...appointments].sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""));
}

export function appointmentScheduleLabel(appointment: fhir4.Appointment): string {
  return appointment.serviceType?.[0]?.text || appointment.description || "-";
}

// ---- 枠選択(月カレンダー) ----

/** "2026-08" のような月の指定。 */
export function currentMonth(): string {
  return toDateInput(new Date()).slice(0, 7);
}

export function shiftMonth(month: string, diff: number): string {
  const [year, mon] = month.split("-").map(Number);
  const date = new Date(year, mon - 1 + diff, 1);
  return toDateInput(date).slice(0, 7);
}

export function monthRange(month: string): { from: string; to: string } {
  const [year, mon] = month.split("-").map(Number);
  return {
    from: toDateInput(new Date(year, mon - 1, 1)),
    // 月末を含めたいので翌月 1 日。呼び出し側は start=lt で使う。
    to: toDateInput(new Date(year, mon, 1)),
  };
}

export function monthLabel(month: string): string {
  const [year, mon] = month.split("-");
  return `${year}年${Number(mon)}月`;
}

export interface MonthCell {
  date: string;
  /** その月の日か(前後月のはみ出しは薄く出す)。 */
  inMonth: boolean;
}

/** 月曜始まりで 6 週ぶん(42 日)。行数を固定して月送りで高さが変わらないようにする。 */
export function monthGrid(month: string): MonthCell[][] {
  const [year, mon] = month.split("-").map(Number);
  const first = new Date(year, mon - 1, 1);
  // getDay() は 0=日。月曜を週頭にするので日曜は 6 日戻す。
  const start = new Date(year, mon - 1, 1 - ((first.getDay() + 6) % 7));

  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + day);
      return { date: toDateInput(date), inMonth: date.getMonth() === mon - 1 };
    }),
  );
}

export interface SlotTimeGroup {
  /** "09:00"。 */
  time: string;
  endTime: string;
  total: number;
  free: number;
  /** 押さえる対象。空きのうち先頭の 1 件を使う。 */
  freeSlots: fhir4.Slot[];
}

function slotMinutes(slot: fhir4.Slot): number {
  return Math.round((new Date(slot.end).getTime() - new Date(slot.start).getTime()) / 60_000);
}

/**
 * 開始時刻から所要時間ぶんを覆う連続した空き枠の列。組めなければ null。
 *
 * 「30 分枠で所要 45 分」なら 2 枠(60 分)になる — 覆うまで枠を足すので、
 * 余りの 15 分はその予約が使い切る(死に枠)。連続とは前の枠の終了時刻に
 * 始まる枠があること。昼休みなどで途切れていたら組めない。
 */
export function chainFreeSlots(
  groups: SlotTimeGroup[],
  startTime: string,
  requiredMinutes: number,
): fhir4.Slot[] | null {
  const byTime = new Map(groups.map((group) => [group.time, group]));
  const chain: fhir4.Slot[] = [];
  let covered = 0;
  let time = startTime;

  while (covered < requiredMinutes) {
    const slot = byTime.get(time)?.freeSlots[0];
    if (!slot) return null;
    chain.push(slot);
    covered += slotMinutes(slot);
    time = slot.end.slice(11, 16);
  }

  return chain;
}

/** その日の枠を開始時刻でまとめる。定員が複数ある枠は 1 行にまとまる。 */
export function groupSlotsByTime(slots: fhir4.Slot[]): SlotTimeGroup[] {
  const groups = new Map<string, fhir4.Slot[]>();
  for (const slot of slots) {
    if (slot.status === "entered-in-error") continue;
    const time = slotTime(slot);
    const group = groups.get(time);
    if (group) group.push(slot);
    else groups.set(time, [slot]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, group]) => ({
      time,
      endTime: group[0].end?.slice(11, 16) ?? "",
      total: group.length,
      free: group.filter((slot) => slot.status === "free").length,
      freeSlots: group.filter((slot) => slot.status === "free"),
    }));
}
