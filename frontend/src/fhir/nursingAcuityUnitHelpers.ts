import { locationDisplayName } from "./locationHelpers";
import {
  acuityCriteria,
  acuityFormOf,
  type AcuityCriteria,
  type AcuityForm,
  type AcuityUnitSetting,
  type NursingAcuitySettings,
} from "./nursingAcuityHelpers";

// 看護必要度の届出単位(docs/nursing-acuity-design.md §8)。
//
// 評価・集計・届出は「届出単位」ごとに行う。単位は病棟(既定)か、病棟の中の病室(ICU・HCU など、
// 病棟から切り出して別の入院料を届け出る区画)。施設設定 nursing_acuity.units に Location id をキーに持ち、
// 設定の無い病棟はそのまま 1 つの単位になる(評価票の版は設定の form、基準は ratio1 / ratio2)。
// 病室単位に属するベッドは病棟の単位から外す。

/** 届出区分。label は届出様式(様式10・様式43)の書き方。 */
export interface AcuityCategoryOption {
  code: string;
  label: string;
  /** 評価票の版。 */
  formCode: string;
  /** 救急患者応需係数を割合に足す区分か。 */
  coefficient: boolean;
  /** 割合2(基準②)も用いる区分か。 */
  ratio2: boolean;
  /**
   * 該当患者割合の基準値(%)の既定。評価方式(Ⅰ / Ⅱ)ごとに [割合1, 割合2]。null は基準を持たない
   * (解説記事で確認した値。告示の原文は未確認なので施設設定で直せる)。
   */
  thresholds: Record<"I" | "II", [number | null, number | null]>;
}

export const ACUITY_CATEGORY_OPTIONS: AcuityCategoryOption[] = [
  { code: "none", label: "届出なし", formCode: "general-2026", coefficient: false, ratio2: true, thresholds: { I: [null, null], II: [null, null] } },
  { code: "acute-hospital-a", label: "急病A", formCode: "general-2026", coefficient: true, ratio2: true, thresholds: { I: [28, 35], II: [27, 34] } },
  { code: "acute-hospital-b", label: "急病B", formCode: "general-2026", coefficient: true, ratio2: true, thresholds: { I: [28, 35], II: [27, 34] } },
  { code: "acute-1", label: "急1", formCode: "general-2026", coefficient: true, ratio2: true, thresholds: { I: [28, 35], II: [27, 34] } },
  { code: "acute-2", label: "急2", formCode: "general-2026", coefficient: true, ratio2: false, thresholds: { I: [28, null], II: [27, null] } },
  { code: "acute-3", label: "急3", formCode: "general-2026", coefficient: true, ratio2: false, thresholds: { I: [24, null], II: [23, null] } },
  { code: "acute-4", label: "急4", formCode: "general-2026", coefficient: true, ratio2: false, thresholds: { I: [20, null], II: [19, null] } },
  { code: "acute-5", label: "急5", formCode: "general-2026", coefficient: true, ratio2: false, thresholds: { I: [15, null], II: [14, null] } },
  { code: "acute-6", label: "急6", formCode: "general-2026", coefficient: false, ratio2: false, thresholds: { I: [null, null], II: [null, null] } },
  { code: "regional-1", label: "地域1", formCode: "general-2026", coefficient: true, ratio2: false, thresholds: { I: [null, null], II: [null, null] } },
  { code: "specific-7to1", label: "特A一般7対1", formCode: "general-2026", coefficient: true, ratio2: true, thresholds: { I: [null, null], II: [27, 34] } },
  { code: "specialty-7to1", label: "専門7対1", formCode: "general-2026", coefficient: false, ratio2: true, thresholds: { I: [null, null], II: [21, 28] } },
  { code: "er-1", label: "救命1", formCode: "hcu-2026", coefficient: false, ratio2: false, thresholds: { I: [null, null], II: [null, null] } },
  { code: "er-2", label: "救命2", formCode: "icu-2026", coefficient: false, ratio2: false, thresholds: { I: [null, null], II: [null, null] } },
  { code: "icu-1", label: "ICU管理料1", formCode: "icu-2026", coefficient: false, ratio2: false, thresholds: { I: [80, null], II: [80, null] } },
  { code: "icu-2", label: "ICU管理料2", formCode: "icu-2026", coefficient: false, ratio2: false, thresholds: { I: [70, null], II: [70, null] } },
  { code: "icu-3", label: "ICU管理料3", formCode: "icu-2026", coefficient: false, ratio2: false, thresholds: { I: [70, null], II: [70, null] } },
  { code: "hcu-1", label: "HCU管理料1", formCode: "hcu-2026", coefficient: false, ratio2: true, thresholds: { I: [20, 80], II: [20, 80] } },
  { code: "hcu-2", label: "HCU管理料2", formCode: "hcu-2026", coefficient: false, ratio2: true, thresholds: { I: [20, 65], II: [20, 65] } },
  { code: "hcu-note5", label: "HCU注5", formCode: "hcu-2026", coefficient: false, ratio2: true, thresholds: { I: [null, null], II: [null, null] } },
];

export function acuityCategoryOf(code: string | undefined): AcuityCategoryOption | undefined {
  return ACUITY_CATEGORY_OPTIONS.find((option) => option.code === code);
}

/** 届出単位にできる病室の区分(病棟から切り出す区画)。 */
export const ACUITY_UNIT_ROOM_CLASSES = ["icu", "hcu", "ccu", "scu"];

/** ベッドの属する病棟・病室(api/queries/encounter の BedWard と同じ形)。 */
export interface UnitBedPlace {
  wardId: string;
  wardName: string;
  roomId: string;
  roomName: string;
  roomClass: string;
  usable: boolean;
}

/** 届出単位 1 つ。評価・集計・届出の軸。 */
export interface AcuityUnit {
  /** 病棟か病室の Location id。評価の order-ward 拡張に焼く id でもある。 */
  id: string;
  name: string;
  kind: "ward" | "room";
  /** 病室単位なら属する病棟の id、病棟単位なら自分の id。 */
  wardId: string;
  /** 届出区分(未設定は undefined)。 */
  category?: AcuityCategoryOption;
  method: "I" | "II";
  form: AcuityForm;
  criteria: AcuityCriteria;
  bedIds: Set<string>;
  /** 届出病床数(設定が無ければ使えるベッドの数)。 */
  beds: number;
  /** 該当患者割合の基準値(%)。null は基準を持たない。 */
  thresholds: [number | null, number | null];
  /** 救急患者応需係数を割合に足すか。 */
  coefficientApplies: boolean;
  /** 施設設定に行があるか。 */
  configured: boolean;
}

function unitOf(args: {
  id: string;
  name: string;
  kind: "ward" | "room";
  wardId: string;
  setting: AcuityUnitSetting | undefined;
  settings: NursingAcuitySettings;
  bedIds: Set<string>;
  usableBeds: number;
}): AcuityUnit {
  const { id, name, kind, wardId, setting, settings, bedIds, usableBeds } = args;
  const category = acuityCategoryOf(setting?.category);
  const method = setting?.method ?? "I";
  const form = acuityFormOf(category?.formCode ?? settings.form);
  const criteria = acuityCriteria(form, settings);
  const defaults = category?.thresholds[method] ?? [null, null];
  return {
    id,
    name,
    kind,
    wardId,
    category,
    method,
    form,
    criteria: category && !category.ratio2 ? { ratio1: criteria.ratio1, ratio2: [] } : criteria,
    bedIds,
    beds: setting?.beds ?? usableBeds,
    thresholds: [setting?.ratio1 ?? defaults[0], setting?.ratio2 ?? defaults[1]],
    coefficientApplies: category?.coefficient ?? false,
    configured: Boolean(setting),
  };
}

/**
 * 施設設定と病棟・ベッドの一覧から届出単位を組む。病室単位のベッドを先に割り当て、残りを病棟の単位へ。
 * 並びは病棟の順で、病室単位はその病棟の後ろ。設定にあるが見つからない Location は、ベッド無しの単位として
 * 残す(施設設定で消せるように)。
 */
export function resolveAcuityUnits(
  settings: NursingAcuitySettings,
  wards: fhir4.Location[],
  bedPlaces: Map<string, UnitBedPlace>,
): AcuityUnit[] {
  const roomSettings = Object.entries(settings.units).filter(([, setting]) => setting.kind === "room");
  const roomUnits = new Map<string, { bedIds: Set<string>; usable: number; name: string; wardId: string }>();
  for (const [roomId] of roomSettings) roomUnits.set(roomId, { bedIds: new Set(), usable: 0, name: "", wardId: "" });
  const wardBeds = new Map<string, { bedIds: Set<string>; usable: number; name: string }>();
  for (const [bedId, place] of bedPlaces) {
    const room = roomUnits.get(place.roomId);
    if (room) {
      room.bedIds.add(bedId);
      room.name = place.roomName;
      room.wardId = place.wardId;
      if (place.usable) room.usable += 1;
      continue;
    }
    const ward = wardBeds.get(place.wardId) ?? { bedIds: new Set<string>(), usable: 0, name: place.wardName };
    ward.bedIds.add(bedId);
    if (place.usable) ward.usable += 1;
    wardBeds.set(place.wardId, ward);
  }

  const units: AcuityUnit[] = [];
  const wardIds = [
    ...wards.map((ward) => ward.id ?? "").filter(Boolean),
    ...Object.entries(settings.units)
      .filter(([id, setting]) => setting.kind === "ward" && !wards.some((ward) => ward.id === id))
      .map(([id]) => id),
  ];
  for (const wardId of wardIds) {
    const ward = wards.find((w) => w.id === wardId);
    const beds = wardBeds.get(wardId);
    units.push(
      unitOf({
        id: wardId,
        name: ward ? locationDisplayName(ward) : beds?.name || wardId,
        kind: "ward",
        wardId,
        setting: settings.units[wardId],
        settings,
        bedIds: beds?.bedIds ?? new Set(),
        usableBeds: beds?.usable ?? 0,
      }),
    );
    for (const [roomId, setting] of roomSettings) {
      const room = roomUnits.get(roomId);
      if (!room || room.wardId !== wardId) continue;
      units.push(
        unitOf({
          id: roomId,
          name: room.name || roomId,
          kind: "room",
          wardId,
          setting,
          settings,
          bedIds: room.bedIds,
          usableBeds: room.usable,
        }),
      );
      roomUnits.delete(roomId);
    }
  }
  // 病棟が見つからない病室単位(ベッドの無い病室、消した病室)は末尾に。
  for (const [roomId, room] of roomUnits) {
    units.push(
      unitOf({
        id: roomId,
        name: room.name || roomId,
        kind: "room",
        wardId: room.wardId,
        setting: settings.units[roomId],
        settings,
        bedIds: room.bedIds,
        usableBeds: room.usable,
      }),
    );
  }
  return units;
}

/** ベッド id → 届出単位の id。 */
export function unitBedIndex(units: AcuityUnit[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const unit of units) for (const bedId of unit.bedIds) index.set(bedId, unit.id);
  return index;
}

/** 届出単位にできる病室(ICU・HCU などの区分の病室)。施設設定の行の選択肢に使う。 */
export function unitRoomOptions(bedPlaces: Map<string, UnitBedPlace>): { id: string; name: string; wardName: string }[] {
  const rooms = new Map<string, { id: string; name: string; wardName: string }>();
  for (const place of bedPlaces.values()) {
    if (!ACUITY_UNIT_ROOM_CLASSES.includes(place.roomClass) || rooms.has(place.roomId)) continue;
    rooms.set(place.roomId, { id: place.roomId, name: place.roomName, wardName: place.wardName });
  }
  return [...rooms.values()].sort((a, b) => `${a.wardName} ${a.name}`.localeCompare(`${b.wardName} ${b.name}`, "ja", { numeric: true }));
}

/** 該当患者割合(%)が基準値を下回るか。基準を持たなければ null。 */
export function belowThreshold(percent: number | null, threshold: number | null): boolean | null {
  if (percent === null || threshold === null) return null;
  return percent < threshold;
}
