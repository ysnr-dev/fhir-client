// 病棟・病室・ベッド(Location)の組み立て・復元。入院患者を「どこに寝かせているか」
// で扱うための場所マスタで、Location を 3 階層に積む。
//
//   病棟   physicalType=wa / type=HU            例: 東3階病棟
//     └ 病室   physicalType=ro / type=区分       例: 301号室   partOf=病棟
//         └ ベッド physicalType=bd               例: "1"        partOf=病室
//
// 診察室・撮影室(locationHelpers.ts、画面は /locations)とは別物として扱う。
// あちらは partOf を持たない単独の部屋なので、両者が一覧で混ざらないよう
// useLocationSearch 側で partof:missing と病棟(HU)の除外をかけている。
//
// ベッドの name は病室内の番号だけ("1", "2", ...)にしてある。「301号室 ベッド1」
// のような表示名は病室名と合成して作る(bedDisplayName)。name に病室名を含めると
// 病室名を変えるたびに配下のベッドを全部書き換える羽目になるため。
//
// ベッド数は病室リソースに持たせず、配下のベッドの件数から数える。数と実体を
// 二重に持つと必ずどこかでずれるので、実体だけを正とする。

// physicalType は Encounter.location(入院予定の病棟・病室・ベッドの区別)でも使う。
export const PHYSICAL_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/location-physical-type";
export const WARD_PHYSICAL_TYPE = { code: "wa", display: "Ward" };
export const ROOM_PHYSICAL_TYPE = { code: "ro", display: "Room" };
export const BED_PHYSICAL_TYPE = { code: "bd", display: "Bed" };

// 病棟の種別。診察室と同じ v3-RoleCode の HU(Hospital unit)。
const WARD_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-RoleCode";
export const WARD_TYPE_CODE = "HU";

// 病室の区分。該当する標準コードが無いのでローカル CodeSystem を建てる。
export const ROOM_CLASS_SYSTEM = "http://fhir-client.local/CodeSystem/room-class";

export const ROOM_CLASS_OPTIONS = [
  { code: "general", label: "一般室" },
  { code: "private", label: "個室" },
  { code: "special", label: "特別室" },
  { code: "icu", label: "ICU(集中治療室)" },
  { code: "hcu", label: "HCU(高度治療室)" },
  { code: "ccu", label: "CCU(循環器疾患集中治療室)" },
  { code: "scu", label: "SCU(脳卒中集中治療室)" },
] as const;

/** 病室に付けられるベッド数の上限。番号は 1 から連番で振る。 */
export const MAX_BED_COUNT = 99;

export function roomClassLabel(code: string | undefined): string {
  if (!code) return "-";
  return ROOM_CLASS_OPTIONS.find((o) => o.code === code)?.label ?? code;
}

// ---- 病棟 ----

export interface WardFormValues {
  name: string;
  status: string;
  /** 所属医療機関の Organization.id。自院設定済みなら自院で固定する。 */
  managingOrganizationId: string;
  description: string;
}

export const emptyWardForm: WardFormValues = {
  name: "",
  status: "active",
  managingOrganizationId: "",
  description: "",
};

export function validateWardForm(values: WardFormValues): string | null {
  if (!values.name.trim()) return "病棟名は必須です。";
  return null;
}

export function buildWard(values: WardFormValues, id?: string): fhir4.Location {
  const ward: fhir4.Location = {
    resourceType: "Location",
    status: values.status as fhir4.Location["status"],
    name: values.name.trim(),
    // 病棟そのもの(instance)であって、病棟という種類(kind)ではない。
    mode: "instance",
    type: [
      {
        coding: [{ system: WARD_TYPE_SYSTEM, code: WARD_TYPE_CODE, display: "病棟" }],
      },
    ],
    physicalType: {
      coding: [
        {
          system: PHYSICAL_TYPE_SYSTEM,
          code: WARD_PHYSICAL_TYPE.code,
          display: WARD_PHYSICAL_TYPE.display,
        },
      ],
    },
  };

  if (id) ward.id = id;
  if (values.description.trim()) ward.description = values.description.trim();
  if (values.managingOrganizationId) {
    ward.managingOrganization = { reference: `Organization/${values.managingOrganizationId}` };
  }

  return ward;
}

export function parseWard(ward: fhir4.Location): WardFormValues {
  return {
    name: ward.name ?? "",
    status: ward.status ?? "active",
    managingOrganizationId: ward.managingOrganization?.reference?.split("/").pop() ?? "",
    description: ward.description ?? "",
  };
}

// ---- 病室 ----

export interface RoomFormValues {
  name: string;
  /** ROOM_CLASS_OPTIONS のコード。 */
  roomClass: string;
  /** ベッド数。保存時に配下のベッドをこの数に合わせる。 */
  bedCount: string;
  status: string;
  managingOrganizationId: string;
  description: string;
}

export const emptyRoomForm: RoomFormValues = {
  name: "",
  roomClass: "general",
  bedCount: "1",
  status: "active",
  managingOrganizationId: "",
  description: "",
};

export function validateRoomForm(values: RoomFormValues): string | null {
  if (!values.name.trim()) return "病室名は必須です。";
  if (!values.roomClass) return "区分は必須です。";
  const count = Number(values.bedCount);
  if (!/^\d+$/.test(values.bedCount.trim()) || !Number.isInteger(count)) {
    return "ベッド数は整数で入力してください。";
  }
  if (count < 1 || count > MAX_BED_COUNT) {
    return `ベッド数は 1〜${MAX_BED_COUNT} で入力してください。`;
  }
  return null;
}

export function buildRoom(
  values: RoomFormValues,
  wardId: string,
  id?: string,
): fhir4.Location {
  const room: fhir4.Location = {
    resourceType: "Location",
    status: values.status as fhir4.Location["status"],
    name: values.name.trim(),
    mode: "instance",
    type: [
      {
        coding: [
          {
            system: ROOM_CLASS_SYSTEM,
            code: values.roomClass,
            display: roomClassLabel(values.roomClass),
          },
        ],
      },
    ],
    physicalType: {
      coding: [
        {
          system: PHYSICAL_TYPE_SYSTEM,
          code: ROOM_PHYSICAL_TYPE.code,
          display: ROOM_PHYSICAL_TYPE.display,
        },
      ],
    },
    partOf: { reference: `Location/${wardId}` },
  };

  if (id) room.id = id;
  if (values.description.trim()) room.description = values.description.trim();
  if (values.managingOrganizationId) {
    room.managingOrganization = { reference: `Organization/${values.managingOrganizationId}` };
  }

  return room;
}

export function parseRoom(room: fhir4.Location, bedCount: number): RoomFormValues {
  return {
    name: room.name ?? "",
    roomClass: roomClassCode(room) ?? "general",
    bedCount: String(bedCount),
    status: room.status ?? "active",
    managingOrganizationId: room.managingOrganization?.reference?.split("/").pop() ?? "",
    description: room.description ?? "",
  };
}

export function roomClassCode(room: fhir4.Location): string | undefined {
  const coding = room.type?.[0]?.coding;
  return coding?.find((c) => c.system === ROOM_CLASS_SYSTEM)?.code ?? coding?.[0]?.code;
}

// ---- ベッド ----

export function buildBed(
  number: number,
  roomReference: string,
  managingOrganizationId: string,
): fhir4.Location {
  const bed: fhir4.Location = {
    resourceType: "Location",
    status: "active",
    // 病室内の番号だけを持たせる(ファイル冒頭のコメント参照)。
    name: String(number),
    mode: "instance",
    physicalType: {
      coding: [
        {
          system: PHYSICAL_TYPE_SYSTEM,
          code: BED_PHYSICAL_TYPE.code,
          display: BED_PHYSICAL_TYPE.display,
        },
      ],
    },
    partOf: { reference: roomReference },
  };

  if (managingOrganizationId) {
    bed.managingOrganization = { reference: `Organization/${managingOrganizationId}` };
  }

  return bed;
}

/** ベッドの name("1")を番号として読む。番号として読めなければ undefined。 */
export function bedNumber(bed: fhir4.Location): number | undefined {
  const name = bed.name?.trim();
  if (!name || !/^\d+$/.test(name)) return undefined;
  const value = Number(name);
  return value >= 1 ? value : undefined;
}

/** 一覧に出す表示名。ベッド単体では番号しか持たないので病室名と合成する。 */
export function bedDisplayName(bed: fhir4.Location, roomName: string): string {
  const number = bedNumber(bed);
  return number ? `${roomName} ベッド${number}` : `${roomName} ${bed.name ?? bed.id ?? ""}`.trim();
}

/** partOf の参照先 Location.id を取り出す。 */
export function partOfId(location: fhir4.Location): string | undefined {
  return location.partOf?.reference?.split("/").pop() || undefined;
}

/** ベッド(または病室)を親の id ごとに数える。一覧のベッド数・病室数の表示用。 */
export function countByParent(children: fhir4.Location[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const child of children) {
    const parent = partOfId(child);
    if (!parent) continue;
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  return counts;
}

// ---- 保存(病室 + ベッドの同期) ----

interface BedDiff {
  /** 新しく作るベッド番号。 */
  create: number[];
  /** 消すベッド。番号の大きい方から。 */
  remove: fhir4.Location[];
}

/**
 * 既存のベッドを目標数 count に合わせるための差分。1..count の欠番を作り、
 * それ以外(番号が範囲外・番号として読めない・番号の重複)を消す。
 * 結果として残るベッドはちょうど count 件、番号は 1..count になる。
 */
export function diffBeds(existingBeds: fhir4.Location[], count: number): BedDiff {
  const kept = new Set<number>();
  const remove: fhir4.Location[] = [];

  for (const bed of existingBeds) {
    const number = bedNumber(bed);
    if (number === undefined || number > count || kept.has(number)) {
      remove.push(bed);
      continue;
    }
    kept.add(number);
  }

  const create: number[] = [];
  for (let n = 1; n <= count; n += 1) {
    if (!kept.has(n)) create.push(n);
  }

  // 消す順は番号の大きい方から(操作の見え方を「後ろから減らす」に揃える)。
  remove.sort((a, b) => (bedNumber(b) ?? Infinity) - (bedNumber(a) ?? Infinity));

  return { create, remove };
}

export interface RoomSaveInput {
  values: RoomFormValues;
  wardId: string;
  /** 編集時のみ。未指定なら新規登録。 */
  roomId?: string;
  /** 編集時の既存ベッド(partof=病室 で引いたもの)。 */
  existingBeds?: fhir4.Location[];
}

/**
 * 病室本体とベッドの増減を 1 つの transaction にまとめる。病室だけ保存されて
 * ベッドが中途半端に残る状態を作らないため、単体 PUT ではなく Bundle で書く
 * (枠の一括操作 useUpdateSlotStatus と同じ理由)。
 *
 * 新規は病室を fullUrl(urn:uuid)で POST し、ベッドの partOf からそれを参照する。
 * 上流が同一 Bundle 内で実 id に解決する。
 */
export function buildRoomSaveBundle(input: RoomSaveInput): fhir4.Bundle {
  const { values, wardId, roomId, existingBeds = [] } = input;
  const count = Number(values.bedCount);
  const organizationId = values.managingOrganizationId;
  const entry: fhir4.BundleEntry[] = [];

  if (roomId) {
    const roomReference = `Location/${roomId}`;
    entry.push({
      resource: buildRoom(values, wardId, roomId),
      request: { method: "PUT", url: roomReference },
    });

    const { create, remove } = diffBeds(existingBeds, count);
    for (const number of create) {
      entry.push({
        resource: buildBed(number, roomReference, organizationId),
        request: { method: "POST", url: "Location" },
      });
    }
    for (const bed of remove) {
      entry.push({ request: { method: "DELETE", url: `Location/${bed.id}` } });
    }
    return { resourceType: "Bundle", type: "transaction", entry };
  }

  const roomReference = `urn:uuid:${crypto.randomUUID()}`;
  entry.push({
    fullUrl: roomReference,
    resource: buildRoom(values, wardId),
    request: { method: "POST", url: "Location" },
  });
  for (let number = 1; number <= count; number += 1) {
    entry.push({
      resource: buildBed(number, roomReference, organizationId),
      request: { method: "POST", url: "Location" },
    });
  }

  return { resourceType: "Bundle", type: "transaction", entry };
}

/** 病室を配下のベッドごと消す transaction Bundle。 */
export function buildRoomDeleteBundle(roomId: string, beds: fhir4.Location[]): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      ...beds
        .filter((bed) => bed.id)
        .map((bed) => ({ request: { method: "DELETE" as const, url: `Location/${bed.id}` } })),
      { request: { method: "DELETE" as const, url: `Location/${roomId}` } },
    ],
  };
}

// ---- 病棟 → 病室 → ベッドの選択(入院予定・入院実施・転室などのモーダル) ----

/** 絞り込みセレクトの選択中の id。未選択は空文字。 */
export interface BedRoomIds {
  wardId: string;
  roomId: string;
  bedId: string;
}

/** 選択した場所の id と表示名。submit 時に resolveBedSelection で作る。 */
export interface BedSelection extends BedRoomIds {
  wardName: string;
  roomName: string;
  /** ベッドの表示(病室内の番号 "1" など)。 */
  bedName: string;
  bed?: fhir4.Location;
}

/** ベッド単体の表示。病室名と合成した bedDisplayName と違い、番号だけを返す。 */
export function bedShortLabel(bed: fhir4.Location): string {
  const number = bedNumber(bed);
  return number != null ? String(number) : (bed.name ?? "-");
}

/**
 * 選択中の id を、useWardOptions / useWardGrid で取ったマスタで表示名付きに解決する。
 * occupiedBedIds を渡すと空床でないベッドは選ばれていないことにする(選択肢からも
 * 消しているが、入院予定からの引き継ぎで埋まっている床の id が入っていることがある)。
 */
export function resolveBedSelection(
  wards: fhir4.Location[],
  grid: { rooms: fhir4.Location[]; bedsByRoom: Map<string, fhir4.Location[]> },
  ids: BedRoomIds,
  occupiedBedIds?: Set<string>,
): BedSelection {
  const ward = wards.find((w) => w.id === ids.wardId);
  const room = grid.rooms.find((r) => r.id === ids.roomId);
  const beds = room ? (grid.bedsByRoom.get(room.id ?? "") ?? []) : [];
  let bed = beds.find((b) => b.id === ids.bedId);
  if (bed?.id && occupiedBedIds?.has(bed.id)) bed = undefined;
  return {
    wardId: ward?.id ?? "",
    wardName: ward ? (ward.name ?? "") : "",
    roomId: room?.id ?? "",
    roomName: room ? (room.name ?? "") : "",
    bedId: bed?.id ?? "",
    bedName: bed ? bedShortLabel(bed) : "",
    bed,
  };
}
