import { useEffect, useMemo, useState } from "react";
import { fetchAttendingPhysicians } from "../api/queries/extractAttending";
import {
  ATTENDING_COLUMN,
  EMPTY_ATTRIBUTE,
  STRATUM_COLUMN,
  type PatientAttribute,
  type RecordTableRow,
} from "../fhir/recordTableHelpers";
import type { ExtractPatientScope } from "./useExtractPatientScope";

// データ抽出の記録タブの結果に足す患者ごとの属性の列(群・担当医。docs/data-extract-design.md §21)。
// 群は実行したときの群分けから、担当医は結果の患者の外来受診・入院・処方を読んで決める。

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

export function useRecordPatientAttributes(
  scope: ExtractPatientScope,
  rows: RecordTableRow[],
): RecordPatientAttributes {
  const ran = scope.ran;
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
  const attributes = useMemo(() => {
    const list: PatientAttribute[] = [];
    if (groupsOf) {
      list.push({ label: STRATUM_COLUMN, valueOf: (id) => groupsOf.get(id)?.join("、") || EMPTY_ATTRIBUTE });
    }
    if (mode) {
      const names = current?.names;
      list.push({ label: ATTENDING_COLUMN, valueOf: (id) => (names ? names.get(id) || EMPTY_ATTRIBUTE : "") });
    }
    return list;
  }, [groupsOf, mode, current]);

  return {
    attributes,
    running: Boolean(mode) && patientIds.length > 0 && !current,
    truncated: current?.truncated ?? false,
    error: current?.error ?? null,
  };
}
