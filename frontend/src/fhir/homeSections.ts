import type { BedWard } from "../api/queries/encounter";
import { ADMISSION_STATUS, encounterAttendingId, encounterBedId, encounterBedLabel, encounterNurseIds, encounterPatientId } from "./encounterHelpers";
import { appointmentActorId } from "./appointmentHelpers";

// ホーム(トップページ)のカードが使う純関数。部門ワークリストの対応表、Task の状態の集計、
// 外来・入院の絞り込み。どのカードを並べるか(既定と保存した設定)は fhir/homeCards.ts。

/** 部門ワークリスト件数のカード。職種→部門の対応は HOME_WORKLISTS 1 か所で持つ。 */
export type HomeWorklistKey =
  | "lab"
  | "physio"
  | "patho"
  | "transfusion"
  | "rad"
  | "radiotherapy"
  | "rx"
  | "injection"
  | "broughtMed"
  | "medicationGuidance"
  | "antimicrobial"
  | "rehab"
  | "nutritionGuidance"
  | "endoscopy"
  | "treatment"
  | "surgery";

export interface HomeWorklistDef {
  label: string;
  path: string;
  /** 既定でこのカードを出す職種。空なら編集で足したときだけ出る。 */
  roleCodes: readonly string[];
}

const LAB_ROLE_CODES = ["medical-technologist", "laboratory-technician"] as const;
const REHAB_ROLE_CODES = ["physio", "occupational", "speech"] as const;

export const HOME_WORKLISTS: Record<HomeWorklistKey, HomeWorklistDef> = {
  lab: { label: "検体検査", path: "/lab-worklist", roleCodes: LAB_ROLE_CODES },
  physio: { label: "生理検査", path: "/physio-worklist", roleCodes: LAB_ROLE_CODES },
  patho: { label: "病理検査", path: "/patho-worklist", roleCodes: LAB_ROLE_CODES },
  transfusion: { label: "輸血", path: "/transfusion-worklist", roleCodes: LAB_ROLE_CODES },
  rad: { label: "放射線検査", path: "/rad-worklist", roleCodes: ["radiological-technologist"] },
  radiotherapy: {
    label: "放射線治療",
    path: "/radiotherapy-worklist",
    roleCodes: ["radiological-technologist"],
  },
  rx: { label: "処方", path: "/rx-worklist", roleCodes: ["pharmacist"] },
  injection: { label: "注射", path: "/injection-worklist", roleCodes: ["pharmacist"] },
  broughtMed: { label: "持参薬鑑別", path: "/brought-med-worklist", roleCodes: ["pharmacist"] },
  medicationGuidance: {
    label: "服薬指導",
    path: "/medication-guidance-worklist",
    roleCodes: ["pharmacist"],
  },
  antimicrobial: { label: "特定抗菌薬の届出", path: "/ast-worklist?tab=notify", roleCodes: ["pharmacist"] },
  rehab: { label: "リハビリ", path: "/rehab-worklist", roleCodes: REHAB_ROLE_CODES },
  nutritionGuidance: {
    label: "栄養指導",
    path: "/nutrition-guidance-worklist",
    roleCodes: ["dietitian"],
  },
  endoscopy: { label: "内視鏡", path: "/endoscopy-worklist", roleCodes: [] },
  treatment: { label: "処置", path: "/treatment-worklist", roleCodes: [] },
  surgery: { label: "手術", path: "/surgery-worklist", roleCodes: [] },
};

export const HOME_WORKLIST_KEYS = Object.keys(HOME_WORKLISTS) as HomeWorklistKey[];

// ---- 部門ワークリストの件数 ----

export interface TaskStatusSummary {
  /** 未処理(completed / cancelled 以外)。カードの大きな数字。 */
  open: number;
  /** 状態コードごとの件数。 */
  byStatus: Map<string, number>;
}

/** Task の状態(Task 無しは requested として渡す)を数える。 */
export function summarizeTaskStatuses(statuses: string[]): TaskStatusSummary {
  const byStatus = new Map<string, number>();
  let open = 0;
  for (const status of statuses) {
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    if (status !== "completed" && status !== "cancelled") open += 1;
  }
  return { open, byStatus };
}

// ---- 本日の外来 ----

/** 医師は自分が担当医の予約だけ。それ以外は全件。 */
export function homeOutpatientRows<T extends { appointment: fhir4.Appointment }>(
  rows: T[],
  practitionerId: string | null,
): T[] {
  if (!practitionerId) return rows;
  return rows.filter((row) => appointmentActorId(row.appointment, "Practitioner") === practitionerId);
}

// ---- 担当入院患者 ----

export interface HomeInpatientRow {
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
  patientId?: string;
  /** 病室名。ベッドから病室が引けないときは "-"。 */
  roomName: string;
}

export interface HomeInpatientGroup {
  /** 病棟が引けないベッドは null(「病棟不明」)。 */
  wardId: string | null;
  wardName: string;
  rows: HomeInpatientRow[];
}

/**
 * 在院中の入院を自分の担当(主治医 / 担当看護師)に絞り、病棟ごとにまとめる。看護師は
 * 入院の担当看護師に加えて、その日の業務分担で受け持つ患者(assignedPatientIds)も担当に数える。
 * 病棟名順、行はベッド表示名順。病棟が引けないベッドは末尾に「病棟不明」でまとめる。
 */
export function homeInpatientGroups(
  encounters: Iterable<fhir4.Encounter>,
  patientsById: Map<string, fhir4.Patient>,
  bedWards: Map<string, BedWard>,
  by: "attending" | "nurse",
  practitionerId: string,
  assignedPatientIds: ReadonlySet<string> = new Set(),
): HomeInpatientGroup[] {
  const groups = new Map<string | null, HomeInpatientGroup>();
  for (const encounter of encounters) {
    if (encounter.status !== ADMISSION_STATUS) continue;
    const patientId = encounterPatientId(encounter);
    const mine =
      by === "attending"
        ? encounterAttendingId(encounter) === practitionerId
        : encounterNurseIds(encounter).includes(practitionerId) ||
          Boolean(patientId && assignedPatientIds.has(patientId));
    if (!mine) continue;
    const bedId = encounterBedId(encounter);
    const ward = bedId ? bedWards.get(bedId) : undefined;
    const key = ward?.wardId ?? null;
    const group = groups.get(key) ?? { wardId: key, wardName: ward?.wardName ?? "病棟不明", rows: [] };
    group.rows.push({
      encounter,
      patient: patientId ? patientsById.get(patientId) : undefined,
      patientId,
      roomName: ward?.roomName || "-",
    });
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort((a, b) =>
        encounterBedLabel(a.encounter).localeCompare(encounterBedLabel(b.encounter), "ja", {
          numeric: true,
        }),
      ),
    }))
    .sort((a, b) => {
      if (a.wardId === null) return 1;
      if (b.wardId === null) return -1;
      return a.wardName.localeCompare(b.wardName, "ja");
    });
}
