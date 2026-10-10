import { addDays, diffDays } from "../lib/dates";
import {
  ADMISSION_STATUS,
  DISCHARGED_STATUS,
  encounterDischargePlan,
  encounterPatientId,
  encounterTransferPlan,
  plannedAdmissionDate,
  plannedBedId,
  plannedWardId,
} from "./encounterHelpers";
import { PHYSICAL_TYPE_SYSTEM } from "./wardHelpers";
import { referenceId } from "./shared";

// ベッドスケジュール(病床ガント)と病床状況の集計(docs/bed-management-design.md)。
//
// 入院(Encounter)は location に床の履歴を持つ(先頭が今の床、後ろほど古い。移動した床は
// period.start に移動日、それまでの床は period.end に同じ日を持つ)。ここから「どの床に・いつから・
// いつまで」を区間(BedSegment)に起こし、ガントの帯と、病棟ごとの在院・入退棟の集計に共用する。
//
// 区間は夜で数える: start の日から until の前日までの夜をその床で過ごした(until は移動日・退院日)。
// 入院日は数え、退院日は数えない(在院患者延日数の数え方)。ガントの帯は見た目のため、退院で終わる
// 区間だけ退院日まで延ばす(移動で終わる区間は移動の前日まで)。

export interface BedSegment {
  key: string;
  encounter: fhir4.Encounter;
  patientId: string;
  bedId: string;
  /** その床に入った日。 */
  start: string;
  /** その床を出た日(移動日・退院日)。まだ居れば null。 */
  until: string | null;
  /** 退院で終わった区間か(帯を退院日まで延ばす)。 */
  discharged: boolean;
  /** 入院の最初の床か(入棟を「入院」と「転入」に分けるため)。 */
  first: boolean;
  /** いま居る床で、退院予定(または転棟予定の前日)があればその日。帯の予定部分の終わり。 */
  plannedLast?: string;
  /** 予定の帯(入院予定・転棟予定先)。実際の区間は undefined。 */
  plan?: "admission" | "transfer";
}

function dateOf(value: string | undefined): string {
  return value?.slice(0, 10) ?? "";
}

/** 入院中・退院済の入院から床の区間を起こす(古い順)。予定の帯は含まない。 */
export function encounterBedSegments(encounter: fhir4.Encounter): BedSegment[] {
  if (encounter.status !== ADMISSION_STATUS && encounter.status !== DISCHARGED_STATUS) return [];
  const patientId = encounterPatientId(encounter) ?? "";
  const admission = dateOf(encounter.period?.start);
  const discharge = encounter.status === DISCHARGED_STATUS ? dateOf(encounter.period?.end) : "";
  // 入院予定の名残(physicalType 付きの病棟・病室)は床の履歴ではないので除く。
  const beds = (encounter.location ?? []).filter(
    (entry) => !entry.physicalType?.coding?.some((c) => c.system === PHYSICAL_TYPE_SYSTEM),
  );
  const segments: BedSegment[] = [];
  // 末尾(いちばん古い床)から順に起こす。
  for (let index = beds.length - 1; index >= 0; index -= 1) {
    const entry = beds[index];
    const bedId = referenceId(entry.location?.reference);
    if (!bedId) continue;
    const start = dateOf(entry.period?.start) || admission;
    const isCurrent = index === 0;
    const until = isCurrent ? discharge || null : dateOf(entry.period?.end) || dateOf(beds[index - 1]?.period?.start) || null;
    if (!start) continue;
    segments.push({
      key: `${encounter.id}:${index}`,
      encounter,
      patientId,
      bedId,
      start,
      until,
      discharged: isCurrent && Boolean(discharge),
      first: index === beds.length - 1,
    });
  }
  return segments;
}

/**
 * ガントに載せる帯。実際の区間に加えて、いま居る床の予定(退院予定・転棟予定の前日)と、
 * 転棟予定先・入院予定の床の予定の帯を足す。
 */
export function scheduleSegments(
  encounters: fhir4.Encounter[],
  plannedAdmissions: fhir4.Encounter[],
): BedSegment[] {
  const segments: BedSegment[] = [];
  for (const encounter of encounters) {
    const own = encounterBedSegments(encounter);
    const current = own[own.length - 1];
    if (current && current.until === null) {
      const transfer = encounterTransferPlan(encounter);
      const discharge = encounterDischargePlan(encounter);
      const dischargeDate = dateOf(discharge?.at);
      if (transfer?.date && transfer.date > current.start) {
        current.plannedLast = addDays(transfer.date, -1);
        if (transfer.bedId) {
          segments.push({
            key: `${encounter.id}:transfer-plan`,
            encounter,
            patientId: current.patientId,
            bedId: transfer.bedId,
            start: transfer.date,
            until: null,
            discharged: false,
            first: false,
            plannedLast: dischargeDate && dischargeDate >= transfer.date ? dischargeDate : undefined,
            plan: "transfer",
          });
        }
      } else if (dischargeDate && dischargeDate >= current.start) {
        current.plannedLast = dischargeDate;
      }
    }
    segments.push(...own);
  }
  for (const encounter of plannedAdmissions) {
    const date = plannedAdmissionDate(encounter);
    const bedId = plannedBedId(encounter);
    if (!date || !bedId) continue;
    segments.push({
      key: `${encounter.id}:admission-plan`,
      encounter,
      patientId: encounterPatientId(encounter) ?? "",
      bedId,
      start: date,
      until: null,
      discharged: false,
      first: true,
      plannedLast: date,
      plan: "admission",
    });
  }
  return segments;
}

/**
 * 帯の最後の日。続いている区間は予定の終わり(無ければ undefined = 表の右端まで)。退院予定日を
 * 過ぎてもまだ居る入院は、少なくとも今日までは居るので今日で止める。
 */
function lastDayOf(segment: BedSegment, today: string): string | undefined {
  if (segment.until === null) {
    if (!segment.plannedLast || segment.plan) return segment.plannedLast;
    return segment.plannedLast < today ? today : segment.plannedLast;
  }
  return segment.discharged ? segment.until : addDays(segment.until, -1);
}

/** 帯の 1 区切り。actual = 実績、future = 続いている入院の今日より先、planned = 予定の帯。 */
export interface BarPiece {
  from: number;
  /** 含む。 */
  to: number;
  variant: "actual" | "future" | "planned";
}

export interface ScheduleBar {
  segment: BedSegment;
  /** 表の左端(0)からの位置。 */
  from: number;
  to: number;
  pieces: BarPiece[];
  /** 表の左右で切れているか(帯の端を角丸にしない)。 */
  clippedStart: boolean;
  clippedEnd: boolean;
  /** 予定の終わりを持たずに続いている(右端を開いた形にする)。 */
  open: boolean;
  /** 同じ床の中で重ならないよう積む段(0 始まり)。 */
  lane: number;
}

/**
 * 1 つの床の帯を、表の範囲 [from, from + days) に収めて並べる。重なる帯は段を分ける
 * (同じ床に入院予定と退院前の患者が重なるときなど)。
 */
export function bedBars(segments: BedSegment[], from: string, days: number, today: string): ScheduleBar[] {
  const lastIndex = days - 1;
  const todayIndex = diffDays(from, today);
  const bars: ScheduleBar[] = [];
  for (const segment of segments) {
    const startIndex = diffDays(from, segment.start);
    const last = lastDayOf(segment, today);
    const endIndex = last === undefined ? lastIndex : diffDays(from, last);
    if (endIndex < 0 || startIndex > lastIndex || endIndex < startIndex) continue;
    const a = Math.max(0, startIndex);
    const b = Math.min(lastIndex, endIndex);
    let pieces: BarPiece[];
    if (segment.plan) {
      pieces = [{ from: a, to: b, variant: "planned" }];
    } else if (segment.until === null && todayIndex < b) {
      // 続いている入院は今日までが実績、明日からは予定(退院予定まで、無ければ右端まで)。
      const split = Math.max(a - 1, Math.min(b, todayIndex));
      pieces = [
        ...(split >= a ? [{ from: a, to: split, variant: "actual" as const }] : []),
        { from: split + 1, to: b, variant: "future" as const },
      ];
    } else {
      pieces = [{ from: a, to: b, variant: "actual" }];
    }
    bars.push({
      segment,
      from: a,
      to: b,
      pieces,
      clippedStart: startIndex < 0,
      clippedEnd: endIndex > lastIndex,
      open: segment.until === null && last === undefined,
      lane: 0,
    });
  }
  bars.sort((x, y) => x.from - y.from || y.to - x.to);
  const laneEnds: number[] = [];
  for (const bar of bars) {
    let lane = laneEnds.findIndex((end) => end < bar.from);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = bar.to;
    bar.lane = lane;
  }
  return bars;
}

/** ベッドの決まっていない入院予定(病棟だけ決まっているもの)。その病棟の行に日付で並べる。 */
export function unassignedPlannedAdmissions(
  plannedAdmissions: fhir4.Encounter[],
  wardId: string,
): fhir4.Encounter[] {
  return plannedAdmissions.filter(
    (encounter) =>
      plannedWardId(encounter) === wardId && !plannedBedId(encounter) && plannedAdmissionDate(encounter),
  );
}

// ---- 病床状況の集計 ----

/** ベッド 1 床の所属(api/queries/encounter.ts の BedWard と同じ形の要るところだけ)。 */
export interface BedPlace {
  wardId: string;
  roomClass: string;
  usable: boolean;
}

export interface WardBedStats {
  wardId: string;
  /** 病棟のベッド数(休止・閉鎖を含む)。 */
  beds: number;
  /** 使えないベッド(ベッドか病室が有効でない)。 */
  unusable: number;
  /** その日の 24 時に在院している患者。 */
  occupied: number;
  /** 使えるベッドのうち空いている数を病室の区分ごとに。 */
  emptyByRoomClass: Map<string, number>;
  admissions: number;
  discharges: number;
  transfersIn: number;
  transfersOut: number;
  /** 翌日の入院予定(この病棟が予定先)。 */
  plannedAdmissionsNext: number;
  /** 翌日の退院予定(いまこの病棟に居る患者)。 */
  plannedDischargesNext: number;
  /** 期間の在院患者延日数(夜の数)。 */
  patientDays: number;
  /** 期間の新入棟(入院 + 転入)と新退棟(退院 + 転出)。 */
  periodIn: number;
  periodOut: number;
  /** 期間の入院と退院(転出入を除く)。病院全体の平均在院日数に使う。 */
  periodAdmissions: number;
  periodDischarges: number;
}

/** 病床利用率(%)。期間の在院患者延日数 ÷ (使えるベッド数 × 日数)。 */
export function occupancyRate(stats: WardBedStats, periodDays: number): number | null {
  const usable = stats.beds - stats.unusable;
  if (usable <= 0 || periodDays <= 0) return null;
  return (stats.patientDays / (usable * periodDays)) * 100;
}

/** 平均在院日数。在院患者延日数 ÷ ((新入棟 + 新退棟) ÷ 2)。入退棟が無ければ出さない。 */
export function averageStay(stats: WardBedStats): number | null {
  const moves = (stats.periodIn + stats.periodOut) / 2;
  return moves > 0 ? stats.patientDays / moves : null;
}

/**
 * 病棟ごとの集計。date はその日(在院・入退院・翌日の予定)、periodStart〜date は延日数と
 * 入退棟の期間(両端を含む)。
 */
export function wardBedStats(args: {
  encounters: fhir4.Encounter[];
  plannedAdmissions: fhir4.Encounter[];
  bedPlaces: Map<string, BedPlace>;
  date: string;
  periodStart: string;
}): Map<string, WardBedStats> {
  const { encounters, plannedAdmissions, bedPlaces, date, periodStart } = args;
  const next = addDays(date, 1);
  const byWard = new Map<string, WardBedStats>();
  const statsOf = (wardId: string) => {
    let stats = byWard.get(wardId);
    if (!stats) {
      stats = {
        wardId,
        beds: 0,
        unusable: 0,
        occupied: 0,
        emptyByRoomClass: new Map(),
        admissions: 0,
        discharges: 0,
        transfersIn: 0,
        transfersOut: 0,
        plannedAdmissionsNext: 0,
        plannedDischargesNext: 0,
        patientDays: 0,
        periodIn: 0,
        periodOut: 0,
        periodAdmissions: 0,
        periodDischarges: 0,
      };
      byWard.set(wardId, stats);
    }
    return stats;
  };

  for (const place of bedPlaces.values()) {
    const stats = statsOf(place.wardId);
    stats.beds += 1;
    if (!place.usable) stats.unusable += 1;
  }

  const occupiedBeds = new Set<string>();
  const inPeriod = (day: string) => periodStart <= day && day <= date;
  for (const encounter of encounters) {
    const segments = encounterBedSegments(encounter);
    segments.forEach((segment, index) => {
      const wardId = bedPlaces.get(segment.bedId)?.wardId;
      if (!wardId) return;
      const stats = statsOf(wardId);
      const previousWard = index > 0 ? bedPlaces.get(segments[index - 1].bedId)?.wardId : undefined;
      const nextSegment = segments[index + 1];
      const nextWard = nextSegment ? bedPlaces.get(nextSegment.bedId)?.wardId : undefined;
      // 入棟: 入院の最初の床か、別の病棟から移ってきた床。同じ病棟の中の転床は数えない。
      const entered = segment.first || previousWard !== wardId;
      const left = segment.until !== null && (segment.discharged || nextWard !== wardId);

      if (segment.start === date && entered) {
        if (segment.first) stats.admissions += 1;
        else stats.transfersIn += 1;
      }
      if (left && segment.until === date) {
        if (segment.discharged) stats.discharges += 1;
        else stats.transfersOut += 1;
      }
      if (entered && inPeriod(segment.start)) {
        stats.periodIn += 1;
        if (segment.first) stats.periodAdmissions += 1;
      }
      if (left && segment.until && inPeriod(segment.until)) {
        stats.periodOut += 1;
        if (segment.discharged) stats.periodDischarges += 1;
      }

      // 夜の数(期間と区間の重なり)。
      const from = segment.start > periodStart ? segment.start : periodStart;
      const endExclusive = segment.until === null || segment.until > addDays(date, 1) ? addDays(date, 1) : segment.until;
      const nights = diffDays(from, endExclusive);
      if (nights > 0) stats.patientDays += nights;

      if (segment.start <= date && (segment.until === null || segment.until > date)) {
        stats.occupied += 1;
        occupiedBeds.add(segment.bedId);
      }
      if (
        segment.until === null &&
        encounterDischargePlan(encounter)?.at.slice(0, 10) === next &&
        index === segments.length - 1
      ) {
        stats.plannedDischargesNext += 1;
      }
    });
  }

  for (const [bedId, place] of bedPlaces) {
    if (!place.usable || occupiedBeds.has(bedId)) continue;
    const stats = statsOf(place.wardId);
    stats.emptyByRoomClass.set(place.roomClass, (stats.emptyByRoomClass.get(place.roomClass) ?? 0) + 1);
  }

  for (const encounter of plannedAdmissions) {
    const wardId = plannedWardId(encounter);
    if (wardId && plannedAdmissionDate(encounter) === next) statsOf(wardId).plannedAdmissionsNext += 1;
  }

  return byWard;
}

/**
 * ベッドの集合(病棟、または看護必要度の届出単位)に日ごとに居た患者(その日にそのベッドを使っていた患者。
 * 入院日・退院日・移動日を含む)。看護必要度の集計の「評価すべき患者」に使う。期間は [from, to](両端を含む)。
 */
export function patientsByDayAtBeds(args: {
  encounters: fhir4.Encounter[];
  bedIds: Set<string>;
  from: string;
  to: string;
}): Map<string, Set<string>> {
  const { encounters, bedIds, from, to } = args;
  const byDay = new Map<string, Set<string>>();
  for (let day = from; day <= to; day = addDays(day, 1)) byDay.set(day, new Set());
  for (const encounter of encounters) {
    for (const segment of encounterBedSegments(encounter)) {
      if (!bedIds.has(segment.bedId)) continue;
      const last = segment.until ?? to;
      for (let day = segment.start < from ? from : segment.start; day <= last && day <= to; day = addDays(day, 1)) {
        byDay.get(day)?.add(segment.patientId);
      }
    }
  }
  return byDay;
}

/** 病棟に日ごとに居た患者(patientsByDayAtBeds を病棟のベッドで)。 */
export function wardPatientsByDay(args: {
  encounters: fhir4.Encounter[];
  bedPlaces: Map<string, { wardId: string }>;
  wardId: string;
  from: string;
  to: string;
}): Map<string, Set<string>> {
  const bedIds = new Set<string>();
  for (const [bedId, place] of args.bedPlaces) if (place.wardId === args.wardId) bedIds.add(bedId);
  return patientsByDayAtBeds({ encounters: args.encounters, bedIds, from: args.from, to: args.to });
}
