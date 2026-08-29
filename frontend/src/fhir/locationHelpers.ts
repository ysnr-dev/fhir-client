// 場所(Location)の組み立て・復元。診察室・撮影室のような「院内の部屋」を登録し、
// 予約枠(Schedule.actor)の主体として使う。
//
// 入院の場所(病棟・病室・ベッド)は同じ Location だが、階層を持ち使う場面も
// 違うので wardHelpers.ts と /wards の画面が受け持つ。ここでは扱わない。
//
// 上流 fhir-server の LocationValidator は status / mode の値セットだけを見る
// (JP Core に Location の必須項目は無い)。ここでは部屋を表すのに必要な最小限
// —— 名称・種別・所属医療機関・状態 —— だけを持つ。

// Location.type は HL7 の ServiceDeliveryLocationRoleType(v3-RoleCode)を使う。
const LOCATION_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-RoleCode";

// physicalType は「部屋」で固定する。院内の一区画を表す前提の画面なので、
// 建物・フロアの登録は想定しない。
const PHYSICAL_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/location-physical-type";
const ROOM_PHYSICAL_TYPE = { code: "ro", display: "Room" };

/**
 * 一覧・セレクト・カレンダーの列に並べるときの順。小さいほど先。
 *
 * ［提案］backend のマスタを起こさず、**部屋そのものの拡張**として持つ。並び順は
 * 部屋の属性で、部屋を消せば一緒に消えるのが自然 —— location_id で紐づく別テーブル
 * だと孤児行の掃除が要る。施設で 1 つの並びになるのも都合がよい(端末ごとの好みでは
 * なく、手術室の並びは手術部で共有された前提)。
 *
 * ［事実］上流は独自拡張の Location を素通しし、往復もする(2026-08-28 に確認)。
 * ［実装］上流は独自拡張で _sort できないので、並べ替えは読み手側(sortLocations)。
 */
const DISPLAY_ORDER_EXT_URL = "http://fhir-client.local/StructureDefinition/location-display-order";

export const LOCATION_TYPE_OPTIONS = [
  { code: "OF", label: "外来(診察室)" },
  { code: "RADDX", label: "放射線(撮影室)" },
  { code: "DX", label: "検査・処置室" },
  { code: "ER", label: "救急" },
  { code: "SU", label: "手術室" },
  // リハビリ室。リハビリの予約枠(Schedule.actor)の主体になる。v3-RoleCode の
  // RHU(Rehabilitation hospital unit)を当てる。
  { code: "RHU", label: "リハビリ室" },
] as const;

// 一覧・選択肢はこのコードでの OR 検索で引く(入院の場所を混ぜないため。
// useLocationSearch 参照)。種別を増やすときはここに足すだけでよい。
export const LOCATION_TYPE_CODES = LOCATION_TYPE_OPTIONS.map((o) => o.code);

export const LOCATION_STATUS_OPTIONS = [
  { code: "active", label: "使用中" },
  { code: "suspended", label: "一時停止" },
  { code: "inactive", label: "使用しない" },
] as const;

export function locationTypeLabel(code: string | undefined): string {
  if (!code) return "-";
  return LOCATION_TYPE_OPTIONS.find((o) => o.code === code)?.label ?? code;
}

export function locationStatusLabel(status: string | undefined): string {
  if (!status) return "-";
  return LOCATION_STATUS_OPTIONS.find((o) => o.code === status)?.label ?? status;
}

export interface LocationFormValues {
  name: string;
  typeCode: string;
  status: string;
  /** 所属医療機関の Organization.id。任意。 */
  managingOrganizationId: string;
  description: string;
  /** 表示順。空なら未設定(名称順で末尾に回る)。 */
  displayOrder: string;
}

export const emptyLocationForm: LocationFormValues = {
  name: "",
  typeCode: "OF",
  status: "active",
  managingOrganizationId: "",
  description: "",
  displayOrder: "",
};

export function validateLocationForm(values: LocationFormValues): string | null {
  if (!values.name.trim()) return "名称は必須です。";
  // 種別は一覧の絞り込みキーでもあるので必須。未設定だと /locations に出てこない。
  if (!values.typeCode) return "種別は必須です。";
  if (values.displayOrder.trim()) {
    const order = Number(values.displayOrder);
    if (!Number.isInteger(order) || order < 0) return "表示順は 0 以上の整数で入力してください。";
  }
  return null;
}

export function buildLocation(values: LocationFormValues, id?: string): fhir4.Location {
  const location: fhir4.Location = {
    resourceType: "Location",
    status: values.status as fhir4.Location["status"],
    name: values.name.trim(),
    // 部屋そのもの(instance)であって、部屋の種類(kind)ではない。
    mode: "instance",
    physicalType: {
      coding: [
        {
          system: PHYSICAL_TYPE_SYSTEM,
          code: ROOM_PHYSICAL_TYPE.code,
          display: ROOM_PHYSICAL_TYPE.display,
        },
      ],
    },
  };

  if (id) location.id = id;

  if (values.description.trim()) location.description = values.description.trim();

  if (values.typeCode) {
    location.type = [
      {
        coding: [
          {
            system: LOCATION_TYPE_SYSTEM,
            code: values.typeCode,
            display: locationTypeLabel(values.typeCode),
          },
        ],
      },
    ];
  }

  if (values.managingOrganizationId) {
    location.managingOrganization = {
      reference: `Organization/${values.managingOrganizationId}`,
    };
  }

  // 更新は PUT で丸ごと置き換わる。表示順はここで必ず載せ直す
  // (この関数がリソースを組み立て直す唯一の場所なので、落とすと編集のたびに消える)。
  if (values.displayOrder.trim()) {
    location.extension = [
      { url: DISPLAY_ORDER_EXT_URL, valueInteger: Number(values.displayOrder) },
    ];
  }

  return location;
}

export function parseLocation(location: fhir4.Location): LocationFormValues {
  return {
    name: location.name ?? "",
    typeCode: locationTypeCode(location) ?? "",
    status: location.status ?? "active",
    managingOrganizationId:
      location.managingOrganization?.reference?.split("/").pop() ?? "",
    description: location.description ?? "",
    displayOrder: locationDisplayOrder(location)?.toString() ?? "",
  };
}

/** 表示順。未設定なら null。 */
export function locationDisplayOrder(location: fhir4.Location): number | null {
  const value = location.extension?.find((e) => e.url === DISPLAY_ORDER_EXT_URL)?.valueInteger;
  return typeof value === "number" ? value : null;
}

/**
 * 表示順 → 名称の順に並べた新しい配列。
 *
 * 未設定は末尾へ回す。設定済みと混ぜて 0 扱いにすると、1 つ設定しただけで
 * 他の部屋が押し出されて並びが変わってしまう。
 */
export function sortLocations<T extends fhir4.Location>(locations: T[]): T[] {
  return [...locations].sort((a, b) => {
    const orderA = locationDisplayOrder(a);
    const orderB = locationDisplayOrder(b);
    if (orderA !== orderB) {
      if (orderA == null) return 1;
      if (orderB == null) return -1;
      return orderA - orderB;
    }
    return locationDisplayName(a).localeCompare(locationDisplayName(b), "ja");
  });
}

export function locationTypeCode(location: fhir4.Location): string | undefined {
  const coding = location.type?.[0]?.coding;
  return coding?.find((c) => c.system === LOCATION_TYPE_SYSTEM)?.code ?? coding?.[0]?.code;
}

export function locationDisplayName(location: fhir4.Location): string {
  return location.name || location.id || "(名称未登録)";
}
