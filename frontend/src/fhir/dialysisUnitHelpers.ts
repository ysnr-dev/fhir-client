import { addDays } from "../lib/dates";
import { toFhirDateTime } from "./clinicalNoteHelpers";
import { sortedDialysisShifts, type DialysisShift } from "./dialysisShiftHelpers";
import {
  APPOINTMENT_TYPE_SYSTEM,
  DEFAULT_APPOINTMENT_TYPE,
  SERVICE_TYPE_SYSTEM,
  appointmentTypeLabel,
  scheduleTypeLabel,
  slotDate,
  slotTime,
} from "./scheduleHelpers";
import { BED_PHYSICAL_TYPE, PHYSICAL_TYPE_SYSTEM, ROOM_PHYSICAL_TYPE, partOfId } from "./wardHelpers";

// 透析室とベッド(Location)、ベッドの枠表(Schedule)と枠(Slot)。docs/dialysis-order-design.md §5。
//
//   Location 透析室  type = location-type|dialysis-unit, physicalType = ro
//     └ Location ベッド  type 同上, physicalType = bd, partOf = 透析室, name = "1" / "A-3" など
//          ← actor ── Schedule (serviceType = dialysis、名前 = 透析室名 + ベッド名)
//                       ← Slot (日 × シフトで 1 件。定員 1)
//
// 種別をローカルの dialysis-unit にしているのは、診察室(LOCATION_TYPE_OPTIONS)・病棟(HU)の画面と
// 集計に混ざらないようにするため。透析ベッドは病床ではないので入院の Encounter.location にはしない。
//
// 枠表に schedule-slot-pattern 拡張を付けない。透析の枠はシフト(施設設定)から作るもので、
// 枠表の編集画面の一括生成(1 枠の長さが 1 つのパターン)で作り直されないようにする。

export const LOCATION_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/location-type";
export const DIALYSIS_LOCATION_TYPE = { code: "dialysis-unit", display: "透析室" };

/** 一度に追加できるベッド数。 */
export const MAX_DIALYSIS_BED_ADD = 50;

/** 一度に枠を作れる月数。 */
export const MAX_DIALYSIS_SLOT_MONTHS = 6;

const DIALYSIS_SERVICE_TYPE = "dialysis";

function dialysisType(): fhir4.CodeableConcept[] {
  return [{ coding: [{ system: LOCATION_TYPE_SYSTEM, ...DIALYSIS_LOCATION_TYPE }] }];
}

function physicalType(type: { code: string; display: string }): fhir4.CodeableConcept {
  return { coding: [{ system: PHYSICAL_TYPE_SYSTEM, ...type }] };
}

function hasPhysicalType(location: fhir4.Location, code: string): boolean {
  return Boolean(location.physicalType?.coding?.some((c) => c.system === PHYSICAL_TYPE_SYSTEM && c.code === code));
}

export function isDialysisUnitLocation(location: fhir4.Location): boolean {
  return hasPhysicalType(location, ROOM_PHYSICAL_TYPE.code);
}

export function isDialysisBedLocation(location: fhir4.Location): boolean {
  return hasPhysicalType(location, BED_PHYSICAL_TYPE.code);
}

export function buildDialysisUnit(name: string, id?: string): fhir4.Location {
  return {
    resourceType: "Location",
    ...(id ? { id } : {}),
    status: "active",
    name: name.trim(),
    mode: "instance",
    type: dialysisType(),
    physicalType: physicalType(ROOM_PHYSICAL_TYPE),
  };
}

function buildDialysisBed(name: string, unitReference: string): fhir4.Location {
  return {
    resourceType: "Location",
    status: "active",
    name,
    mode: "instance",
    type: dialysisType(),
    physicalType: physicalType(BED_PHYSICAL_TYPE),
    partOf: { reference: unitReference },
  };
}

/** 透析室の中でのベッドの表示名。 */
export function dialysisBedLabel(bed: fhir4.Location): string {
  return bed.name ?? bed.id ?? "";
}

/** 枠表の名前。枠表の一覧(/schedules)でどの透析室のベッドか分かるように透析室名を前に付ける。 */
function bedScheduleName(unitName: string, bedName: string): string {
  return `${unitName} ${bedName}`.trim();
}

function buildBedSchedule(bedReference: string, bedName: string, unitName: string): fhir4.Schedule {
  return {
    resourceType: "Schedule",
    active: true,
    actor: [{ reference: bedReference, display: bedScheduleName(unitName, bedName) }],
    serviceType: [
      {
        coding: [
          {
            system: SERVICE_TYPE_SYSTEM,
            code: DIALYSIS_SERVICE_TYPE,
            display: scheduleTypeLabel("dialysis"),
          },
        ],
        text: bedScheduleName(unitName, bedName),
      },
    ],
  };
}

function withLocationStatus(location: fhir4.Location, active: boolean): fhir4.Location {
  return { ...location, status: active ? "active" : "inactive" };
}

function withScheduleActive(schedule: fhir4.Schedule, active: boolean): fhir4.Schedule {
  return { ...schedule, active };
}

/** 枠表の名前(serviceType[0].text)と actor の表示を揃える。 */
function renamedSchedule(schedule: fhir4.Schedule, bedReference: string, label: string): fhir4.Schedule {
  return {
    ...schedule,
    actor: [{ reference: bedReference, display: label }],
    serviceType: schedule.serviceType?.map((concept, index) => (index === 0 ? { ...concept, text: label } : concept)),
  };
}

/** ベッドの並び。数字の名前は数の順、それ以外は名前の順。 */
export function compareDialysisBeds(a: fhir4.Location, b: fhir4.Location): number {
  return dialysisBedLabel(a).localeCompare(dialysisBedLabel(b), undefined, { numeric: true });
}

/** 追加するベッドの名前。既存の数字の名前の最大の次から連番で振る。 */
export function nextDialysisBedNames(existingBeds: readonly fhir4.Location[], count: number): string[] {
  const max = existingBeds.reduce((acc, bed) => {
    const name = bed.name?.trim() ?? "";
    return /^\d+$/.test(name) ? Math.max(acc, Number(name)) : acc;
  }, 0);
  return Array.from({ length: count }, (_, i) => String(max + i + 1));
}

/**
 * ベッドを N 台足す transaction。ベッドの Location と、それを actor にする Schedule を
 * urn:uuid で結んで 1 回で書く(枠表だけ・ベッドだけが残らないように)。
 */
export function buildAddDialysisBedsBundle(
  unit: fhir4.Location,
  existingBeds: readonly fhir4.Location[],
  count: number,
): fhir4.Bundle {
  const entry: fhir4.BundleEntry[] = nextDialysisBedNames(existingBeds, count).flatMap((name) => {
    const fullUrl = `urn:uuid:${crypto.randomUUID()}`;
    return [
      {
        fullUrl,
        resource: buildDialysisBed(name, `Location/${unit.id}`),
        request: { method: "POST" as const, url: "Location" },
      },
      {
        fullUrl: `urn:uuid:${crypto.randomUUID()}`,
        resource: buildBedSchedule(fullUrl, name, unit.name ?? ""),
        request: { method: "POST" as const, url: "Schedule" },
      },
    ];
  });
  return { resourceType: "Bundle", type: "transaction", entry };
}

/**
 * ベッドの名前・有効を変える transaction。枠表の名前と active も揃える
 * (無効にしたベッドは枠を作らず、ボードにも出さない)。
 */
export function buildDialysisBedUpdateBundle(
  bed: fhir4.Location,
  schedule: fhir4.Schedule | undefined,
  unitName: string,
  values: { name: string; active: boolean },
): fhir4.Bundle {
  const name = values.name.trim();
  const entry: fhir4.BundleEntry[] = [
    {
      resource: withLocationStatus({ ...bed, name }, values.active),
      request: { method: "PUT", url: `Location/${bed.id}` },
    },
  ];
  if (schedule) {
    const label = bedScheduleName(unitName, name);
    entry.push({
      resource: withScheduleActive(renamedSchedule(schedule, `Location/${bed.id}`, label), values.active),
      request: { method: "PUT", url: `Schedule/${schedule.id}` },
    });
  } else {
    // 枠表を持たないベッド(手で Location だけ作られたもの)は、ここで枠表を足す。
    entry.push({
      resource: withScheduleActive(buildBedSchedule(`Location/${bed.id}`, name, unitName), values.active),
      request: { method: "POST", url: "Schedule" },
    });
  }
  return { resourceType: "Bundle", type: "transaction", entry };
}

/** 透析室の名前・有効を変える transaction。配下のベッドの枠表の名前(透析室名 + ベッド名)も揃える。 */
export function buildDialysisUnitUpdateBundle(
  unit: fhir4.Location,
  beds: readonly fhir4.Location[],
  schedulesByBedId: ReadonlyMap<string, fhir4.Schedule>,
  values: { name: string; active: boolean },
): fhir4.Bundle {
  const name = values.name.trim();
  const entry: fhir4.BundleEntry[] = [
    {
      resource: withLocationStatus({ ...unit, name }, values.active),
      request: { method: "PUT", url: `Location/${unit.id}` },
    },
  ];
  if (name !== (unit.name ?? "")) {
    for (const bed of beds) {
      const schedule = schedulesByBedId.get(bed.id ?? "");
      if (!schedule) continue;
      const label = bedScheduleName(name, dialysisBedLabel(bed));
      entry.push({
        resource: renamedSchedule(schedule, `Location/${bed.id}`, label),
        request: { method: "PUT", url: `Schedule/${schedule.id}` },
      });
    }
  }
  return { resourceType: "Bundle", type: "transaction", entry };
}

/** 枠表が指すベッドの Location.id。 */
export function scheduleBedId(schedule: fhir4.Schedule): string {
  return (
    schedule.actor
      ?.find((actor) => actor.reference?.startsWith("Location/"))
      ?.reference?.split("/")
      .pop() ?? ""
  );
}

/** 透析室 1 つぶんのまとまり。ベッドは並べ替え済み。 */
export interface DialysisUnitGroup {
  unit: fhir4.Location;
  beds: fhir4.Location[];
}

/** 読んだ Location を透析室ごとにまとめる。透析室は名前の順。 */
export function groupDialysisLocations(locations: readonly fhir4.Location[]): DialysisUnitGroup[] {
  const units = locations.filter(isDialysisUnitLocation);
  const beds = locations.filter(isDialysisBedLocation);
  return units
    .map((unit) => ({
      unit,
      beds: beds.filter((bed) => partOfId(bed) === unit.id).sort(compareDialysisBeds),
    }))
    .sort((a, b) => (a.unit.name ?? "").localeCompare(b.unit.name ?? "", undefined, { numeric: true }));
}

/** ボードに出すベッド(有効な透析室の有効なベッド)。 */
export interface DialysisBoardBed {
  bed: fhir4.Location;
  unit: fhir4.Location;
  schedule?: fhir4.Schedule;
}

export function activeDialysisBeds(
  groups: readonly DialysisUnitGroup[],
  schedulesByBedId: ReadonlyMap<string, fhir4.Schedule>,
): DialysisBoardBed[] {
  return groups
    .filter((group) => group.unit.status !== "inactive")
    .flatMap((group) =>
      group.beds
        .filter((bed) => bed.status !== "inactive")
        .map((bed) => ({ bed, unit: group.unit, schedule: schedulesByBedId.get(bed.id ?? "") })),
    );
}

// ---- 枠(Slot) ----

function buildDialysisSlot(scheduleId: string, date: string, shift: DialysisShift): fhir4.Slot {
  return {
    resourceType: "Slot",
    schedule: { reference: `Schedule/${scheduleId}` },
    status: "free",
    start: toFhirDateTime(`${date}T${shift.start}`),
    end: toFhirDateTime(`${date}T${shift.end}`),
    appointmentType: {
      coding: [
        {
          system: APPOINTMENT_TYPE_SYSTEM,
          code: DEFAULT_APPOINTMENT_TYPE,
          display: appointmentTypeLabel(DEFAULT_APPOINTMENT_TYPE),
        },
      ],
    },
  };
}

/**
 * ベッドの枠を日 × シフトで作る。from〜to は両端を含む。既に同じ日 × シフトの開始に枠があれば作らない
 * (同じ期間に二度実行しても増えず、シフトを足したときは足したシフトの枠だけが増える)。
 * 休日も作る(透析は祝日も行う施設が多い。休む日は施設の運用で予約を入れない)。
 */
export function generateDialysisSlots(
  scheduleId: string,
  shifts: readonly DialysisShift[],
  from: string,
  to: string,
  existingSlots: readonly fhir4.Slot[],
): fhir4.Slot[] {
  const existing = new Set(
    existingSlots
      .filter((slot) => slot.status !== "entered-in-error")
      .map((slot) => `${slotDate(slot)}T${slotTime(slot)}`),
  );
  const slots: fhir4.Slot[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    for (const shift of sortedDialysisShifts(shifts)) {
      if (existing.has(`${date}T${shift.start}`)) continue;
      slots.push(buildDialysisSlot(scheduleId, date, shift));
    }
  }
  return slots;
}

/** 選択肢・プレビューに出すベッド名。透析室が複数あるときは透析室名を前に付ける。 */
export function dialysisBoardBedLabel(entry: DialysisBoardBed, withUnit: boolean): string {
  const bed = dialysisBedLabel(entry.bed);
  return withUnit ? `${entry.unit.name ?? ""} ${bed}`.trim() : bed;
}
