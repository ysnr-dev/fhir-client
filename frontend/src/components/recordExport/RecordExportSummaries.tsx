import type { ReactNode } from "react";
import { ClinicalNoteDetailPanel } from "../ClinicalNoteDetailPanel";
import { KartePrintEmptyRow, KartePrintSheet } from "./KartePrintSheet";

// カルテ印刷の退院時サマリー。期間に重なる入院のものを記録日の順に、診療記録の詳細と同じ描き方で出す。

export function RecordExportSummaries({ header, summaries }: { header: ReactNode; summaries: fhir4.Composition[] }) {
  return (
    <KartePrintSheet header={header} title="退院時サマリー">
      {summaries.length === 0 ? (
        <KartePrintEmptyRow span={1}>期間内の退院時サマリーはありません。</KartePrintEmptyRow>
      ) : (
        summaries.map((summary) => (
          <tr key={summary.id} className="karte-print__summary">
            <td>
              <ClinicalNoteDetailPanel note={summary} hideCountersign />
            </td>
          </tr>
        ))
      )}
    </KartePrintSheet>
  );
}
