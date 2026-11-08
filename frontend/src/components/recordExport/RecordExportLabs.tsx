import type { ReactNode } from "react";
import { buildLabTimeline, isCorrectedReport } from "../../fhir/labResultHelpers";
import { shortDate } from "../../lib/dates";
import { KartePrintMatrix } from "./KartePrintMatrix";

// カルテ印刷の検歴。検体検査の結果を「項目 × 採取日」の累積表にする(検査結果タブの時系列表示と同じ組み立て)。
// 白黒でも読めるよう、判定(H / L)は値の後ろに文字で添え、中間報告・訂正報告は印で示す。

const FIXED_COLUMNS = [
  { label: "項目", width: "18%" },
  { label: "単位", width: "8%" },
  { label: "基準値", width: "10%" },
];
const CHUNK = 8;
const LEGEND = "◦ 中間報告 / ▴ 訂正報告";

interface RecordExportLabsProps {
  header: ReactNode;
  /** 採取日の古い順。 */
  reports: fhir4.DiagnosticReport[];
  observations: fhir4.Observation[];
  aliases: ReadonlyMap<string, string>;
  /** 期間が年をまたぐときは列の日付に年を付ける。 */
  withYear: boolean;
}

export function RecordExportLabs({ header, reports, observations, aliases, withYear }: RecordExportLabsProps) {
  // 組み立ては新しいレポートから読む前提(同じ日の同じ項目は新しい方を採る)。
  const timeline = buildLabTimeline([...reports].reverse(), observations, Number.MAX_SAFE_INTEGER, aliases);
  const marked = timeline.rows.some((row) => row.statuses.size > 0);
  return (
    <KartePrintMatrix
      header={header}
      title="検歴"
      fixedColumns={FIXED_COLUMNS}
      columns={timeline.dates.map((date) => (withYear ? date : shortDate(date)))}
      rows={timeline.rows.map((row) => ({
        key: row.key,
        fixed: [row.name, row.unit, row.referenceRange],
        cells: timeline.dates.map((date) => {
          const value = row.values.get(date);
          if (value === undefined) return "";
          const interpretation = row.interpretations.get(date) ?? "";
          const status = row.statuses.get(date);
          const mark = status ? (isCorrectedReport(status) ? " ▴" : " ◦") : "";
          return (
            <span key={date} className={interpretation ? "karte-print__abnormal" : undefined}>
              {[value, interpretation].filter(Boolean).join(" ")}
              {mark}
            </span>
          );
        }),
      }))}
      chunk={CHUNK}
      empty="期間内の検査結果はありません。"
      legend={marked ? LEGEND : undefined}
    />
  );
}
