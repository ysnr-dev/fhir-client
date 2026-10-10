import { encounterAttendingId, encounterAttendingName } from "../../fhir/encounterHelpers";
import type { AttendingMode } from "../../fhir/extractRecordQuery";
import { practitionerDisplayName } from "../../fhir/practitionerHelpers";
import { referenceId } from "../../fhir/shared";
import { searchExtractRecords, subjectIdOf } from "./extractRecords";

// データ抽出の記録タブの「担当医」の列(docs/data-extract-design.md §21)。期間内の外来受診・入院・処方の
// 記録から、患者ごとに最も多く現れる医師を 1 人とる(同数なら新しい記録の医師)。

export interface AttendingPhysicians {
  /** 患者 id → 医師の氏名。 */
  names: Map<string, string>;
  /** 記録を読み切れなかった(読めた分から決めた)。 */
  truncated: boolean;
}

interface Appearance {
  physicianId: string;
  name: string;
  date: string;
}

function searchOf(mode: AttendingMode, range: { from?: string; to?: string } | null) {
  const params = new URLSearchParams();
  const dateParam = mode === "prescriber" ? "authoredon" : "date";
  if (range?.from) params.append(dateParam, `ge${range.from}`);
  if (range?.to) params.append(dateParam, `le${range.to}`);
  if (mode === "prescriber") {
    params.set("status:not", "entered-in-error,cancelled");
    params.append("_include", "MedicationRequest:requester");
    return { type: "MedicationRequest" as const, params };
  }
  if (mode === "outpatient") {
    params.set("class", "AMB");
    params.set("status:not", "cancelled,entered-in-error");
  } else {
    params.set("class", "IMP");
    params.set("status", "in-progress,finished");
  }
  params.append("_include", "Encounter:participant");
  return { type: "Encounter" as const, params };
}

function appearanceOf(resource: fhir4.Encounter | fhir4.MedicationRequest): Appearance | null {
  if (resource.resourceType === "MedicationRequest") {
    const physicianId = referenceId(resource.requester?.reference);
    if (!physicianId) return null;
    return { physicianId, name: resource.requester?.display ?? "", date: resource.authoredOn ?? "" };
  }
  const physicianId = encounterAttendingId(resource);
  if (!physicianId) return null;
  const name = encounterAttendingName(resource);
  return { physicianId, name: name === "-" ? "" : name, date: resource.period?.start ?? "" };
}

/** 患者ごとに最も多く現れる医師(同数なら新しい記録の医師)。 */
export function dominantPhysicians(
  records: { patientId: string; appearance: Appearance }[],
  practitionerNames: Map<string, string>,
): Map<string, string> {
  const byPatient = new Map<string, Map<string, { count: number; latest: string; name: string }>>();
  for (const { patientId, appearance } of records) {
    const counts = byPatient.get(patientId) ?? new Map();
    byPatient.set(patientId, counts);
    const current = counts.get(appearance.physicianId) ?? { count: 0, latest: "", name: "" };
    current.count += 1;
    if (appearance.date >= current.latest) current.latest = appearance.date;
    current.name ||= appearance.name;
    counts.set(appearance.physicianId, current);
  }
  const names = new Map<string, string>();
  for (const [patientId, counts] of byPatient) {
    const [id, best] = [...counts].sort(
      ([, a], [, b]) => b.count - a.count || (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0),
    )[0];
    names.set(patientId, practitionerNames.get(id) || best.name || id);
  }
  return names;
}

/** 結果の患者の担当医を読む。patientIds が空なら何も読まない。 */
export async function fetchAttendingPhysicians(
  mode: AttendingMode,
  range: { from?: string; to?: string } | null,
  patientIds: string[],
  signal: AbortSignal,
): Promise<AttendingPhysicians> {
  if (patientIds.length === 0) return { names: new Map(), truncated: false };
  const { type, params } = searchOf(mode, range);
  const result = await searchExtractRecords<fhir4.Encounter | fhir4.MedicationRequest>(
    type,
    params,
    patientIds,
    signal,
  );
  const practitionerNames = new Map<string, string>();
  for (const resource of result.included) {
    if (resource.resourceType === "Practitioner" && resource.id) {
      practitionerNames.set(resource.id, practitionerDisplayName(resource as fhir4.Practitioner));
    }
  }
  const records = result.matches.flatMap((resource) => {
    const appearance = appearanceOf(resource);
    return appearance ? [{ patientId: subjectIdOf(resource), appearance }] : [];
  });
  return { names: dominantPhysicians(records, practitionerNames), truncated: result.truncated };
}
