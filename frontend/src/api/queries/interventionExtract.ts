import { taskPatientId } from "../../fhir/notificationHelpers";
import { RX_VERIFICATION_TASK_CODE } from "../../fhir/rxVerificationHelpers";
import { TASK_CODE_SYSTEM } from "../../fhir/taskHelpers";
import { addDays } from "../../lib/dates";
import { fetchMissingPatients, searchExtractRecords, useRecordExtract } from "./extractRecords";

// 薬剤師介入(処方監査の記録)の抽出(docs/rx-verification-design.md §4.2)。監査済の監査 Task を監査日
// (lastModified)の期間で引く。結果・種別・依頼科の絞り込みは Task の output / input を読んで画面側で行う
// (上流は Task の output・input を検索できない)。

export interface InterventionExtractCriteria {
  from: string;
  to: string;
  patientIds?: string[];
}

export interface InterventionExtractResult {
  tasks: fhir4.Task[];
  patients: Map<string, fhir4.Patient>;
  truncated: boolean;
}

export async function fetchInterventionExtract(
  criteria: InterventionExtractCriteria,
  signal: AbortSignal,
): Promise<InterventionExtractResult> {
  const params = new URLSearchParams();
  params.set("code", `${TASK_CODE_SYSTEM}|${RX_VERIFICATION_TASK_CODE.code}`);
  params.set("status", "completed");
  if (criteria.from) params.append("modified", `ge${criteria.from}`);
  if (criteria.to) params.append("modified", `lt${addDays(criteria.to, 1)}`);
  params.set("_sort", "-modified");
  const page = await searchExtractRecords<fhir4.Task>("Task", params, criteria.patientIds, signal);
  await fetchMissingPatients(page.matches.map(taskPatientId), page.patients, signal);
  return { tasks: page.matches, patients: page.patients, truncated: page.truncated };
}

/** 薬剤師介入の抽出の実行。条件を変えても自動では走らせない。 */
export function useInterventionExtract() {
  return useRecordExtract(fetchInterventionExtract);
}
