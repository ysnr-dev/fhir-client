import { buildError, masterFetch } from "./core";

// カルテの重要日。患者と診療日につき 1 つで、利用者の間で共有する(docs/features/karte.md)。

export type KarteImportantDaySeverity = "high" | "medium" | "low";

export interface KarteImportantDay {
  patient_id: string;
  /** 診療日(YYYY-MM-DD)。 */
  day: string;
  severity: KarteImportantDaySeverity;
  comment: string | null;
  set_by_id: string | null;
  set_by_name: string | null;
  updated_at: string | null;
}

const PATH = "/master/karte_important_days";

export async function fetchKarteImportantDays(patientId: string): Promise<KarteImportantDay[]> {
  const res = await masterFetch(`${PATH}?patient_id=${encodeURIComponent(patientId)}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as KarteImportantDay[];
}

export async function saveKarteImportantDay(
  patientId: string,
  day: string,
  input: { severity: KarteImportantDaySeverity; comment: string; setByName: string | null },
): Promise<KarteImportantDay> {
  const res = await masterFetch(`${PATH}/${encodeURIComponent(day)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patient_id: patientId,
      severity: input.severity,
      comment: input.comment,
      set_by_name: input.setByName,
    }),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as KarteImportantDay;
}

export async function deleteKarteImportantDay(patientId: string, day: string): Promise<void> {
  const res = await masterFetch(
    `${PATH}/${encodeURIComponent(day)}?patient_id=${encodeURIComponent(patientId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw await buildError(res);
}
