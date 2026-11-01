import { useState } from "react";
import { useReportExplanation } from "../api/queries";
import { ResultExplanationModal } from "./ResultExplanationModal";

// 患者説明(fhir/resultExplanationHelpers)。カルテの検査結果タブの見出し行で、確認の隣に置く。
// 台帳が無いレポート(中間報告・台帳を入れる前に確定したもの)では何も出さない。
// 記録した人・日はツールチップで読む(確認済みの印と同じ)。記録の取消は検査結果フォローの一覧で行う。

export function ResultExplanationAction({ reportId }: { reportId: string }) {
  const explanation = useReportExplanation(reportId);
  const [recording, setRecording] = useState(false);
  const row = explanation.data;
  if (!row) return null;

  if (row.status === "completed") {
    const detail = [row.explainedOn && `説明日 ${row.explainedOn}`, row.memo].filter(Boolean).join(" / ");
    return (
      <div className="result-review">
        <span
          className="result-review__done"
          title={`${row.recordedBy} が ${row.recordedOn} に記録しました${detail ? `(${detail})` : ""}`}
        >
          {row.resolution || "説明済"}
        </span>
      </div>
    );
  }

  return (
    <div className="result-review">
      <button type="button" onClick={() => setRecording(true)}>
        患者説明
      </button>
      {recording && <ResultExplanationModal row={row} onClose={() => setRecording(false)} />}
    </div>
  );
}
