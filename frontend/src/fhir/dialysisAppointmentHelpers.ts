import { addDays, localDay } from "../lib/dates";
import {
  appointmentActorId,
  buildAppointment,
  buildBookBundle,
  buildRescheduleBundle,
  emptyAppointmentForm,
  isActiveAppointment,
} from "./appointmentHelpers";
import { DIALYSIS_SHIFT_SYSTEM } from "./dialysisOrderHelpers";
import { dialysisShiftAt, type DialysisOccurrence, type DialysisShift } from "./dialysisShiftHelpers";
import { dayOfWeekCode } from "./injectionHelpers";
import { slotDate, slotTime } from "./scheduleHelpers";

// 透析の予約(Appointment)。docs/dialysis-order-design.md §5.3。
//
//   Appointment  serviceType = schedule-service-type|dialysis(枠表から写す)
//                basedOn     = ヘッダ ServiceRequest
//                participant = Patient + ベッド Location(枠表の actor)
//                slot        = ベッドの枠(日 × シフトで 1 件、定員 1)
//                extension[dialysis-shift] = シフト(コード + 予約時の名前)
//
// 1 回 = 1 件。曜日 × シフトのパターンから N 週ぶんを 1 transaction で作る(部分成功を作らない)。
// 枠の PUT には読んだ版が ifMatch で付くので、別の患者が先に取った枠があると transaction 全体が 412 になる。

const DIALYSIS_SHIFT_EXT_URL = "http://fhir-client.local/StructureDefinition/dialysis-shift";

export interface DialysisShiftRef {
  code: string;
  label: string;
}

function withDialysisShift(appointment: fhir4.Appointment, shift: DialysisShiftRef): fhir4.Appointment {
  return {
    ...appointment,
    extension: [
      ...(appointment.extension ?? []).filter((e) => e.url !== DIALYSIS_SHIFT_EXT_URL),
      { url: DIALYSIS_SHIFT_EXT_URL, valueCoding: { system: DIALYSIS_SHIFT_SYSTEM, code: shift.code, display: shift.label } },
    ],
  };
}

/** 押さえる 1 枠(ベッドの枠表とその日 × シフトの枠)。 */
export interface DialysisBooking {
  schedule: fhir4.Schedule;
  slot: fhir4.Slot;
  shift: DialysisShiftRef;
}

function buildDialysisAppointment(patient: fhir4.Patient, orderId: string, booking: DialysisBooking): fhir4.Appointment {
  const appointment = buildAppointment(emptyAppointmentForm, patient, booking.schedule, [booking.slot]);
  appointment.basedOn = [{ reference: `ServiceRequest/${orderId}` }];
  return withDialysisShift(appointment, booking.shift);
}

/** 1 件の予約(臨時・スポット)。 */
export function buildDialysisAppointmentBundle(
  patient: fhir4.Patient,
  orderId: string,
  booking: DialysisBooking,
): fhir4.Bundle {
  return buildBookBundle(buildDialysisAppointment(patient, orderId, booking), [booking.slot]);
}

/** 一括展開。予約の POST と枠の busy 化の組を件数ぶん 1 transaction に並べる。 */
export function buildDialysisAppointmentBatchBundle(
  patient: fhir4.Patient,
  orderId: string,
  bookings: readonly DialysisBooking[],
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: bookings.flatMap(
      (booking) => buildDialysisAppointmentBundle(patient, orderId, booking).entry ?? [],
    ),
  };
}

/** 予約を別のベッド・日・シフトへ移す。古い枠は空きに戻す。 */
export function buildDialysisRescheduleBundle(
  appointment: fhir4.Appointment,
  oldSlots: fhir4.Slot[],
  booking: DialysisBooking,
): fhir4.Bundle {
  const bed = booking.schedule.actor?.find((actor) => actor.reference?.startsWith("Location/"));
  const moved = withDialysisShift(
    {
      ...appointment,
      description: booking.schedule.serviceType?.[0]?.text ?? appointment.description,
      participant: [
        ...(appointment.participant ?? []).filter((p) => !p.actor?.reference?.startsWith("Location/")),
        ...(bed ? [{ actor: bed, required: "required" as const, status: "accepted" as const }] : []),
      ],
    },
    booking.shift,
  );
  return buildRescheduleBundle(moved, oldSlots, [booking.slot]);
}

/**
 * 同じ日 × シフトの 2 件の予約のベッドを入れ替える(ボードのドラッグ)。枠はどちらも busy のまま、
 * 予約の枠・ベッド・時刻・名前だけを交換する。読んだ予約を書き換えて送るので、版は postBundle が ifMatch に添える。
 */
export function buildDialysisSwapBundle(a: fhir4.Appointment, b: fhir4.Appointment): fhir4.Bundle {
  const isBed = (p: fhir4.AppointmentParticipant) => Boolean(p.actor?.reference?.startsWith("Location/"));
  const swapped = (from: fhir4.Appointment, to: fhir4.Appointment): fhir4.Appointment => ({
    ...from,
    slot: to.slot,
    start: to.start,
    end: to.end,
    description: to.description,
    participant: [...(from.participant ?? []).filter((p) => !isBed(p)), ...(to.participant ?? []).filter(isBed)],
  });
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      { resource: swapped(a, b), request: { method: "PUT", url: `Appointment/${a.id}` } },
      { resource: swapped(b, a), request: { method: "PUT", url: `Appointment/${b.id}` } },
    ],
  };
}

/** ボードでドラッグできる予約(予約済で、まだ入室していない)。予約変更・予約取消と同じ条件。 */
export function isDialysisAppointmentMovable(appointment: fhir4.Appointment, hasSession: boolean): boolean {
  return appointment.status === "booked" && !hasSession;
}

// ---- 読み取り ----

/** 予約のベッド(Location.id)。 */
export function dialysisAppointmentBedId(appointment: fhir4.Appointment): string {
  return appointmentActorId(appointment, "Location");
}

/** 予約の日(ローカル)。 */
export function dialysisAppointmentDate(appointment: fhir4.Appointment): string {
  return localDay(appointment.start);
}

/**
 * 予約のシフト。開始時刻から施設設定のシフトを当て、当たらなければ予約時に焼き付けたシフトを使う
 * (予約タブの汎用の日時変更で別のシフトの枠へ移されても、ボードの列がずれないように)。
 */
export function dialysisAppointmentShift(
  appointment: fhir4.Appointment,
  shifts: readonly DialysisShift[],
): DialysisShiftRef | undefined {
  if (appointment.start) {
    const date = new Date(appointment.start);
    const pad = (n: number) => String(n).padStart(2, "0");
    const shift = dialysisShiftAt(shifts, `${pad(date.getHours())}:${pad(date.getMinutes())}`);
    if (shift) return { code: shift.code, label: shift.label };
  }
  const coding = appointment.extension?.find((e) => e.url === DIALYSIS_SHIFT_EXT_URL)?.valueCoding;
  return coding?.code ? { code: coding.code, label: coding.display ?? coding.code } : undefined;
}

/** 日 × シフトのキー。 */
export function dialysisSlotKey(date: string, shiftCode: string): string {
  return `${date}|${shiftCode}`;
}

/** その日 × シフトの枠(誤登録は除く)。シフトの開始時刻に作った枠を当てる。 */
export function findDialysisSlot(
  slots: readonly fhir4.Slot[],
  date: string,
  shift: DialysisShift,
): fhir4.Slot | undefined {
  return slots.find(
    (slot) => slot.status !== "entered-in-error" && slotDate(slot) === date && slotTime(slot) === shift.start,
  );
}

// ---- 一括展開の計画 ----

export type DialysisPlanStatus =
  /** 予約できる。 */
  | "ok"
  /** このオーダーで同じ日 × シフトに予約がある(除外)。 */
  | "booked"
  /** 枠が埋まっている・止めてある。 */
  | "taken"
  /** 枠が無い(未生成)。 */
  | "no-slot"
  /** ベッドを選んでいない・シフトが施設設定から消えた。 */
  | "no-bed";

export const DIALYSIS_PLAN_STATUS_LABELS: Record<DialysisPlanStatus, string> = {
  ok: "予約",
  booked: "予約済(除外)",
  taken: "空きなし",
  "no-slot": "枠なし",
  "no-bed": "ベッド未選択",
};

export interface DialysisPlanRow {
  occurrence: DialysisOccurrence;
  bedId: string;
  status: DialysisPlanStatus;
  /** status が ok のときだけ。 */
  booking?: DialysisBooking;
}

export interface DialysisPlanInput {
  occurrences: readonly DialysisOccurrence[];
  /** パターンの要素(曜日 × シフト)ごとに選んだベッド。 */
  bedIdFor: (occurrence: DialysisOccurrence) => string;
  schedulesByBedId: ReadonlyMap<string, fhir4.Schedule>;
  /** 選んだベッドの枠表の、展開する期間の枠(状態を問わず)。 */
  slots: readonly fhir4.Slot[];
  /** このオーダーの有効な予約と実施済みの予約。 */
  orderAppointments: readonly fhir4.Appointment[];
  shifts: readonly DialysisShift[];
}

/** プレビューの行。日付・シフトの順(occurrences の順)のまま。 */
export function planDialysisExpansion(input: DialysisPlanInput): DialysisPlanRow[] {
  const booked = new Set(
    input.orderAppointments.flatMap((appointment) => {
      const shift = dialysisAppointmentShift(appointment, input.shifts);
      return shift ? [dialysisSlotKey(dialysisAppointmentDate(appointment), shift.code)] : [];
    }),
  );
  const slotsBySchedule = new Map<string, fhir4.Slot[]>();
  for (const slot of input.slots) {
    const id = slot.schedule.reference?.split("/").pop() ?? "";
    const list = slotsBySchedule.get(id);
    if (list) list.push(slot);
    else slotsBySchedule.set(id, [slot]);
  }

  return input.occurrences.map((occurrence) => {
    const bedId = input.bedIdFor(occurrence);
    if (booked.has(dialysisSlotKey(occurrence.date, occurrence.shift))) {
      return { occurrence, bedId, status: "booked" };
    }
    const shift = input.shifts.find((s) => s.code === occurrence.shift);
    const schedule = input.schedulesByBedId.get(bedId);
    if (!bedId || !shift || !schedule?.id) return { occurrence, bedId, status: "no-bed" };
    const slot = findDialysisSlot(slotsBySchedule.get(schedule.id) ?? [], occurrence.date, shift);
    if (!slot) return { occurrence, bedId, status: "no-slot" };
    if (slot.status !== "free") return { occurrence, bedId, status: "taken" };
    return {
      occurrence,
      bedId,
      status: "ok",
      booking: { schedule, slot, shift: { code: occurrence.shift, label: occurrence.shiftLabel } },
    };
  });
}

/**
 * 展開を始める日。オーダーの開始日と今日のうち遅いほうから、既に予約があればその最後の翌日から。
 */
export function dialysisExpandStart(
  orderStart: string,
  todayDate: string,
  orderAppointments: readonly fhir4.Appointment[],
): string {
  const last = orderAppointments.reduce((max, appointment) => {
    const day = dialysisAppointmentDate(appointment);
    return day > max ? day : max;
  }, "");
  const base = orderStart > todayDate ? orderStart : todayDate;
  return last && last >= base ? addDays(last, 1) : base;
}

/**
 * 曜日 × シフトごとのベッドの初期値。同じ曜日 × シフトの直近の予約のベッド、無ければ直近の予約のベッド、
 * 無ければ空(選ばせる)。
 */
export function previousDialysisBeds(
  orderAppointments: readonly fhir4.Appointment[],
  shifts: readonly DialysisShift[],
): { byPattern: Map<string, string>; latest: string } {
  const sorted = [...orderAppointments].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  const byPattern = new Map<string, string>();
  let latest = "";
  for (const appointment of sorted) {
    const bedId = dialysisAppointmentBedId(appointment);
    const shift = dialysisAppointmentShift(appointment, shifts);
    if (!bedId) continue;
    latest = bedId;
    if (shift) byPattern.set(`${dayOfWeekCode(dialysisAppointmentDate(appointment))}|${shift.code}`, bedId);
  }
  return { byPattern, latest };
}

/** 一覧の「残りの予約」に数えるもの。 */
export function isUpcomingDialysisAppointment(appointment: fhir4.Appointment, fromDate: string): boolean {
  return isActiveAppointment(appointment) && dialysisAppointmentDate(appointment) >= fromDate;
}
