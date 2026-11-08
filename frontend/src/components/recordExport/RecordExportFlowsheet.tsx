import type { ReactNode } from "react";
import { buildVitalFlowsheet, type VitalThresholdSettings } from "../../fhir/vitalHelpers";
import { clockTime, localDay, shortDate } from "../../lib/dates";
import { KartePrintMatrix } from "./KartePrintMatrix";

// カルテ印刷の経過表。バイタル・看護観察などの測定値を「項目 × 測定日時」の表にする
// (経過表と同じ組み立て)。しきい値を外れた値は文字(H / L)を添える。

const FIXED_COLUMNS = [
  { label: "項目", width: "16%" },
  { label: "単位", width: "8%" },
];
const CHUNK = 10;

interface RecordExportFlowsheetProps {
  header: ReactNode;
  observations: fhir4.Observation[];
  thresholds: VitalThresholdSettings;
  withYear: boolean;
}

export function RecordExportFlowsheet({ header, observations, thresholds, withYear }: RecordExportFlowsheetProps) {
  const flowsheet = buildVitalFlowsheet(observations, thresholds);
  return (
    <KartePrintMatrix
      header={header}
      title="経過表"
      fixedColumns={FIXED_COLUMNS}
      columns={flowsheet.columns.map((at) => {
        const day = localDay(at);
        return `${withYear ? day : shortDate(day)}\n${clockTime(at)}`;
      })}
      rows={flowsheet.rows.map((row) => ({
        key: row.key,
        fixed: [row.name, row.unit],
        cells: flowsheet.columns.map((at) => {
          const value = row.values.get(at);
          if (value === undefined) return "";
          const interpretation = row.interpretations.get(at) ?? "";
          return (
            <span key={at} className={interpretation ? "karte-print__abnormal" : undefined}>
              {[value, interpretation].filter(Boolean).join(" ")}
            </span>
          );
        }),
      }))}
      chunk={CHUNK}
      empty="期間内の測定はありません。"
    />
  );
}
