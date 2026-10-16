import { useEffect, useMemo, useState } from "react";
import { fetchAttendingPhysicians } from "../api/queries/extractAttending";
import {
  ATTENDING_COLUMN,
  EMPTY_ATTRIBUTE,
  STRATUM_COLUMN,
  type PatientAttribute,
  type RecordTableRow,
} from "../fhir/recordTableHelpers";
import type { AttendingMode } from "../fhir/extractRecordQuery";
import type { RanScope } from "./useExtractPatientScope";

// データ抽出の記録タブの結果に足す患者ごとの属性の列(比較群・担当医。docs/data-extract-design.md §21)。
// 比較群は実行したときの評価から、担当医は結果の患者の外来受診・入院・処方を読んで決める。

interface AttendingState {
  /** 読んだ患者の組(結果が変わったら読み直す)。 */
  signature: string;
  names: Map<string, string>;
  truncated: boolean;
  error: unknown;
}

export interface RecordPatientAttributes {
  attributes: PatientAttribute[];
  running: boolean;
  truncated: boolean;
  error: unknown;
}

/** 属性の列(比較群・担当医)。担当医の名前がまだ無ければ空欄にする。groupLabel は比較群の列の見出し。 */
export function patientAttributesOf(
  groupsOf: Map<string, string[]> | null,
  mode: AttendingMode | null,
  names: Map<string, string> | null,
  groupLabel: string = STRATUM_COLUMN,
): PatientAttribute[] {
  const list: PatientAttribute[] = [];
  if (groupsOf) {
    list.push({ label: groupLabel, valueOf: (id) => groupsOf.get(id)?.join("、") || EMPTY_ATTRIBUTE });
  }
  if (mode) {
    list.push({ label: ATTENDING_COLUMN, valueOf: (id) => (names ? names.get(id) || EMPTY_ATTRIBUTE : "") });
  }
  return list;
}

const NO_ROWS: RecordTableRow[] = [];

export function useRecordPatientAttributes(
  ran: RanScope | null,
  tableRows: RecordTableRow[] | null | undefined,
): RecordPatientAttributes {
  const rows = tableRows ?? NO_ROWS;
  const patientIds = useMemo(() => [...new Set(rows.map((row) => row.patient.patientId))].sort(), [rows]);
  const mode = ran?.attending ?? null;
  const signature = mode
    ? `${mode}|${ran?.range?.from ?? ""}|${ran?.range?.to ?? ""}|${patientIds.join(",")}`
    : "";
  const [attending, setAttending] = useState<AttendingState | null>(null);

  useEffect(() => {
    if (!mode || patientIds.length === 0) return;
    const controller = new AbortController();
    fetchAttendingPhysicians(mode, ran?.range ?? null, patientIds, controller.signal)
      .then((result) => setAttending({ signature, names: result.names, truncated: result.truncated, error: null }))
      .catch((error) => {
        if (!controller.signal.aborted) setAttending({ signature, names: new Map(), truncated: false, error });
      });
    return () => controller.abort();
    // signature が患者・期間・決め方をまとめて表す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const current = attending && attending.signature === signature ? attending : null;
  const groupsOf = ran?.groupsOf ?? null;
  const groupLabel = ran?.groupLabel;
  const attributes = useMemo(
    () => patientAttributesOf(groupsOf, mode, current?.names ?? null, groupLabel),
    [groupsOf, mode, current, groupLabel],
  );

  return {
    attributes,
    running: Boolean(mode) && patientIds.length > 0 && !current,
    truncated: current?.truncated ?? false,
    error: current?.error ?? null,
  };
}
