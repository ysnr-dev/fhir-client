import { useState } from "react";
import { useExamReportOrderCandidates } from "../api/queries";
import type { ExamReportConfig } from "../fhir/examReportHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { ExamReportEntry } from "./ExamReportEntryModal";

// カルテの検査結果タブで開く検査レポート(読影・所見)の新規登録。
//
// レポートは実施済みのオーダーに 1 件ずつ付くので、まずオーダーを選ばせる。候補は実施済で
// まだレポートが無いもの。選んだ後は部門一覧のモーダルと同じ本体(ExamReportEntry)を出す。

export function ExamReportCreatePanel({
  config,
  patientId,
  onSaved,
}: {
  config: ExamReportConfig;
  patientId: string;
  onSaved: () => void;
}) {
  const [orderId, setOrderId] = useState("");
  const { candidates, isLoading, error } = useExamReportOrderCandidates(config, patientId);
  const { labels } = config;

  return (
    <div className="exam-report-create">
      <ErrorBanner error={error} />
      <div className="prescription-form">
        <label>
          {`${labels.order}オーダー`}
          <select
            value={orderId}
            disabled={isLoading || candidates.length === 0}
            onChange={(e) => setOrderId(e.target.value)}
          >
            <option value="">
              {isLoading
                ? "読み込み中..."
                : candidates.length === 0
                  ? `${labels.report}の無い実施済の${labels.order}はありません`
                  : "選択してください"}
            </option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* オーダーを選び直したら入力をやり直す(初期値はオーダーから作るため)。 */}
      {orderId && (
        <ExamReportEntry
          key={orderId}
          config={config}
          orderId={orderId}
          patientId={patientId}
          onDone={onSaved}
        />
      )}
    </div>
  );
}
