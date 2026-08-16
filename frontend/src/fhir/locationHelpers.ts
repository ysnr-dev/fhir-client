// 場所(Location)の組み立て・復元。診察室・撮影室のような「院内の部屋」を登録し、
// 予約枠(Schedule.actor)の主体として使う。
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

export const LOCATION_TYPE_OPTIONS = [
  { code: "OF", label: "外来(診察室)" },
  { code: "RADDX", label: "放射線(撮影室)" },
  { code: "DX", label: "検査・処置室" },
  { code: "ER", label: "救急" },
  { code: "HU", label: "病棟" },
] as const;

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
}

export const emptyLocationForm: LocationFormValues = {
  name: "",
  typeCode: "OF",
  status: "active",
  managingOrganizationId: "",
  description: "",
};

export function validateLocationForm(values: LocationFormValues): string | null {
  if (!values.name.trim()) return "名称は必須です。";
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
  };
}

export function locationTypeCode(location: fhir4.Location): string | undefined {
  const coding = location.type?.[0]?.coding;
  return coding?.find((c) => c.system === LOCATION_TYPE_SYSTEM)?.code ?? coding?.[0]?.code;
}

export function locationDisplayName(location: fhir4.Location): string {
  return location.name || location.id || "(名称未登録)";
}
