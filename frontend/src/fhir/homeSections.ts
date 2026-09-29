import type { BedWard } from "../api/queries/encounter";
import { ADMISSION_STATUS, encounterAttendingId, encounterBedId, encounterBedLabel, encounterNurseIds, encounterPatientId } from "./encounterHelpers";
import { appointmentActorId } from "./appointmentHelpers";
import { isDoctorRoleCode } from "./practitionerRoleHelpers";

// ホーム(トップページ)の「誰に何を出すか」。職種(所属ロールの code)から表示する
// セクションと絞り込みを決める。hook を持たない純関数だけにして、画面(pages/HomePage.tsx)
// はここで決めた profile に従って部品を並べるだけにする。

export type HomeKind = "administrator" | "doctor" | "nurse" | "department" | "clerk" | "unknown";

export type HomeSectionKey = "notifications" | "outpatient" | "inpatient" | "worklists" | "launcher";

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
  | "rehab"
  | "nutritionGuidance";

export interface HomeWorklistDef {
  label: string;
  path: string;
  /** このカードを出す職種。 */
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
  rehab: { label: "リハビリ", path: "/rehab-worklist", roleCodes: REHAB_ROLE_CODES },
  nutritionGuidance: {
    label: "栄養指導",
    path: "/nutrition-guidance-worklist",
    roleCodes: ["dietitian"],
  },
};

export const HOME_WORKLIST_KEYS = Object.keys(HOME_WORKLISTS) as HomeWorklistKey[];

const NURSE_ROLE_CODES: readonly string[] = ["nurse", "public-health-nurse", "midwife"];
const CLERK_ROLE_CODES: readonly string[] = ["clerk", "medical-clerk"];

export interface HomeProfile {
  kind: HomeKind;
  sections: HomeSectionKey[];
  worklists: HomeWorklistKey[];
  /** 本日の外来を自分の予約に絞る(医師)。false は全体。 */
  outpatientMine: boolean;
  /** 担当入院患者の絞り方。出さない職種は null。 */
  inpatientBy: "attending" | "nurse" | null;
}

/**
 * ログインした人の職種からホームの構成を決める。
 *
 *   administrator(医療従事者に紐付かない) … ランチャーだけ
 *   医師・歯科医師                        … 通知 / 自分の外来予約 / 主治医の入院患者
 *   看護師・保健師・助産師                … 通知 / 担当看護師の入院患者
 *   部門の職種(HOME_WORKLISTS に載る)     … 通知 / 自部門のワークリスト件数
 *   事務職員・それ以外・職種未登録        … 通知 / 本日の外来(全体)
 *
 * 所属科は絞り込みに使わない(医師の外来・入院は医師 id で絞る。科で絞ると他科で
 * 診た予約が落ちる)。
 */
export function homeProfileOf(input: {
  administrator: boolean;
  practitionerId: string | null;
  roleCode: string | undefined;
}): HomeProfile {
  if (input.administrator || !input.practitionerId) {
    return {
      kind: "administrator",
      sections: ["launcher"],
      worklists: [],
      outpatientMine: false,
      inpatientBy: null,
    };
  }
  const code = input.roleCode;
  if (isDoctorRoleCode(code)) {
    return {
      kind: "doctor",
      sections: ["notifications", "outpatient", "inpatient", "launcher"],
      worklists: [],
      outpatientMine: true,
      inpatientBy: "attending",
    };
  }
  if (code && NURSE_ROLE_CODES.includes(code)) {
    return {
      kind: "nurse",
      sections: ["notifications", "inpatient", "launcher"],
      worklists: [],
      outpatientMine: false,
      inpatientBy: "nurse",
    };
  }
  const worklists = code
    ? HOME_WORKLIST_KEYS.filter((key) => HOME_WORKLISTS[key].roleCodes.includes(code))
    : [];
  if (worklists.length > 0) {
    return {
      kind: "department",
      sections: ["notifications", "worklists", "launcher"],
      worklists,
      outpatientMine: false,
      inpatientBy: null,
    };
  }
  return {
    kind: code && CLERK_ROLE_CODES.includes(code) ? "clerk" : "unknown",
    sections: ["notifications", "outpatient", "launcher"],
    worklists: [],
    outpatientMine: false,
    inpatientBy: null,
  };
}

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
}

export interface HomeInpatientGroup {
  /** 病棟が引けないベッドは null(「病棟不明」)。 */
  wardId: string | null;
  wardName: string;
  rows: HomeInpatientRow[];
}

/**
 * 在院中の入院を自分の担当(主治医 / 担当看護師)に絞り、病棟ごとにまとめる。
 * 病棟名順、行はベッド表示名順。病棟が引けないベッドは末尾に「病棟不明」でまとめる。
 */
export function homeInpatientGroups(
  encounters: Iterable<fhir4.Encounter>,
  patientsById: Map<string, fhir4.Patient>,
  bedWards: Map<string, BedWard>,
  by: "attending" | "nurse",
  practitionerId: string,
): HomeInpatientGroup[] {
  const groups = new Map<string | null, HomeInpatientGroup>();
  for (const encounter of encounters) {
    if (encounter.status !== ADMISSION_STATUS) continue;
    const mine =
      by === "attending"
        ? encounterAttendingId(encounter) === practitionerId
        : encounterNurseIds(encounter).includes(practitionerId);
    if (!mine) continue;
    const bedId = encounterBedId(encounter);
    const ward = bedId ? bedWards.get(bedId) : undefined;
    const key = ward?.wardId ?? null;
    const group = groups.get(key) ?? { wardId: key, wardName: ward?.wardName ?? "病棟不明", rows: [] };
    const patientId = encounterPatientId(encounter);
    group.rows.push({
      encounter,
      patient: patientId ? patientsById.get(patientId) : undefined,
      patientId,
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
