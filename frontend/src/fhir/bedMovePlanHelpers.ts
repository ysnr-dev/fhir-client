import { locationDisplayName } from "./locationHelpers";
import {
  buildBedTransferEncounter,
  buildEncountersUpdateBundle,
  encounterBedId,
  validateBedTransfer,
} from "./encounterHelpers";
import { bedDisplayName } from "./wardHelpers";

// 病棟マップの転床の「移動プラン」。
//
// ベッドカードを掴んで落としても、その場では書き込まない。落とすたびに保留中の移動
// (PendingMove)を積み、入れ替え・一時退避を組み立ててから、転床日を決めて一括で
// 確定する(1 つの transaction)。手術カレンダーの「ドロップで即書き込みにはしない」
// (docs/surgery-calendar-design.md §2.3)と同じ考え方で、途中の状態は画面の中だけにある。
//
// 「一時退避(ワークスペース)」は行き先を決めていない状態。A と B を入れ替えるのに
// A をいったん退避させ、B を A の床へ、A を B の床へ、と順に動かせる。退避のまま
// では確定できない(FHIR に「床の無い入院」を書くことになるため)。

export const WORKSPACE = "workspace" as const;
export type MoveDestination = string | typeof WORKSPACE;

export interface PendingMove {
  encounter: fhir4.Encounter;
  /** サーバー上の今の床(プランを始めた時点)。 */
  fromBedId: string;
  toBedId: MoveDestination;
}

/** 入院(Encounter.id)ごとに 1 件。同じ患者を何度動かしても最後の行き先だけ持つ。 */
export type MovePlan = Map<string, PendingMove>;

export interface AppliedMoves {
  /** プランを当てはめたあとの見かけ上の割当。 */
  byBed: Map<string, fhir4.Encounter>;
  /** 退避中の患者。 */
  workspace: fhir4.Encounter[];
  /** 元の床(bedId)→ そこから動いた移動。 */
  moveByFromBed: Map<string, PendingMove>;
  /** 移動先の床(bedId)→ そこへ来る移動。 */
  moveByToBed: Map<string, PendingMove>;
}

export function emptyMovePlan(): MovePlan {
  return new Map();
}

export function applyMoves(byBedOriginal: Map<string, fhir4.Encounter>, plan: MovePlan): AppliedMoves {
  const byBed = new Map(byBedOriginal);
  const workspace: fhir4.Encounter[] = [];
  const moveByFromBed = new Map<string, PendingMove>();
  const moveByToBed = new Map<string, PendingMove>();

  for (const move of plan.values()) {
    if (byBed.get(move.fromBedId)?.id === move.encounter.id) byBed.delete(move.fromBedId);
    moveByFromBed.set(move.fromBedId, move);
  }
  for (const move of plan.values()) {
    if (move.toBedId === WORKSPACE) {
      workspace.push(move.encounter);
    } else {
      byBed.set(move.toBedId, move.encounter);
      moveByToBed.set(move.toBedId, move);
    }
  }
  return { byBed, workspace, moveByFromBed, moveByToBed };
}

/** その入院が今(プラン上で)どこに居るか。 */
function currentPlace(plan: MovePlan, encounter: fhir4.Encounter): MoveDestination {
  return plan.get(encounter.id ?? "")?.toBedId ?? encounterBedId(encounter) ?? "";
}

function withMove(plan: MovePlan, encounter: fhir4.Encounter, toBedId: MoveDestination): MovePlan {
  const next = new Map(plan);
  const id = encounter.id ?? "";
  const fromBedId = encounterBedId(encounter) ?? "";
  // 元の床へ戻したら移動は無かったことにする。
  if (toBedId === fromBedId) next.delete(id);
  else next.set(id, { encounter, fromBedId, toBedId });
  return next;
}

/**
 * 床へ落とす。空いていればそこへ。誰かが居れば入れ替え(相手は自分が居た場所へ。
 * 自分が退避中だったなら相手を退避へ)。
 */
export function dropOnBed(
  plan: MovePlan,
  byBedOriginal: Map<string, fhir4.Encounter>,
  encounter: fhir4.Encounter,
  toBedId: string,
): MovePlan {
  const place = currentPlace(plan, encounter);
  if (place === toBedId) return plan;

  const occupant = applyMoves(byBedOriginal, plan).byBed.get(toBedId);
  let next = withMove(plan, encounter, toBedId);
  if (occupant && occupant.id !== encounter.id) {
    next = withMove(next, occupant, place);
  }
  return next;
}

export function dropOnWorkspace(plan: MovePlan, encounter: fhir4.Encounter): MovePlan {
  if (currentPlace(plan, encounter) === WORKSPACE) return plan;
  return withMove(plan, encounter, WORKSPACE);
}

export function cancelMove(plan: MovePlan, encounterId: string): MovePlan {
  if (!plan.has(encounterId)) return plan;
  const next = new Map(plan);
  next.delete(encounterId);
  return next;
}

export interface BedPlace {
  bed: fhir4.Location;
  room: fhir4.Location;
}

export function bedPlaceLabel(place: BedPlace | undefined): string {
  return place ? bedDisplayName(place.bed, locationDisplayName(place.room)) : "(不明なベッド)";
}

export interface MovePlanIssue {
  encounterId: string;
  message: string;
}

/**
 * 確定できるかの検証。退避のままの患者、行き先の重なり、動かない人の床への移動、
 * この病棟に無い床、転床日の前後関係(validateBedTransfer)。
 */
export function validateMovePlan(
  plan: MovePlan,
  byBedOriginal: Map<string, fhir4.Encounter>,
  bedPlaces: Map<string, BedPlace>,
  date: string,
  patientName: (encounter: fhir4.Encounter) => string,
): MovePlanIssue[] {
  const issues: MovePlanIssue[] = [];
  const destinations = new Map<string, PendingMove>();

  for (const move of plan.values()) {
    const encounterId = move.encounter.id ?? "";
    const name = patientName(move.encounter);
    if (move.toBedId === WORKSPACE) {
      issues.push({ encounterId, message: `${name} が退避中のままです。行き先の床へ置いてください。` });
      continue;
    }
    const place = bedPlaces.get(move.toBedId);
    if (!place) {
      issues.push({ encounterId, message: `${name} の移動先がこの病棟にありません。` });
      continue;
    }
    const other = destinations.get(move.toBedId);
    if (other) {
      issues.push({
        encounterId,
        message: `${name} と ${patientName(other.encounter)} の移動先が同じ床(${bedPlaceLabel(place)})です。`,
      });
    }
    destinations.set(move.toBedId, move);

    const occupant = byBedOriginal.get(move.toBedId);
    if (occupant && occupant.id !== move.encounter.id && !plan.has(occupant.id ?? "")) {
      issues.push({
        encounterId,
        message: `${bedPlaceLabel(place)} には ${patientName(occupant)} が居ます(動かすか、別の床にしてください)。`,
      });
    }

    const error = validateBedTransfer(move.encounter, { date, roomId: place.room.id ?? "", bedId: move.toBedId });
    if (error) issues.push({ encounterId, message: `${name}: ${error}` });
  }
  return issues;
}

/**
 * 各入院に転床を当てはめて 1 つの transaction にする。encounters には確定直前に
 * 引き直した最新の Encounter を渡す(古いものを PUT すると他端末の変更を潰す)。
 */
export function buildMovePlanBundle(
  plan: MovePlan,
  bedPlaces: Map<string, BedPlace>,
  date: string,
  latestById: Map<string, fhir4.Encounter>,
): fhir4.Bundle {
  const encounters: fhir4.Encounter[] = [];
  for (const move of plan.values()) {
    if (move.toBedId === WORKSPACE) continue;
    const latest = latestById.get(move.encounter.id ?? "") ?? move.encounter;
    encounters.push(buildBedTransferEncounter(latest, move.toBedId, bedPlaceLabel(bedPlaces.get(move.toBedId)), date));
  }
  return buildEncountersUpdateBundle(encounters);
}

/**
 * 確定直前の食い違いの検出。プランを組んでいる間に他の端末で入院が動いていたら、
 * 元の床が変わっているか versionId が進んでいる。
 */
export function findStaleMoves(
  plan: MovePlan,
  latest: { byBed: Map<string, fhir4.Encounter>; encounters: fhir4.Encounter[] },
): PendingMove[] {
  const latestById = new Map(latest.encounters.map((e) => [e.id ?? "", e]));
  return [...plan.values()].filter((move) => {
    const current = latestById.get(move.encounter.id ?? "");
    if (!current) return true;
    if (encounterBedId(current) !== move.fromBedId) return true;
    return (current.meta?.versionId ?? "") !== (move.encounter.meta?.versionId ?? "");
  });
}
