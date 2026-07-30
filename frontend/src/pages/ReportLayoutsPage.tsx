import { useState } from "react";
import type { ReportLayoutSummary } from "../api/adminClient";
import { useReportLayouts } from "../api/adminQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { ReportLayoutForm } from "../components/ReportLayoutForm";
import { ReportLayoutTable } from "../components/ReportLayoutTable";

// 帳票レイアウト(.tlf)の管理画面。ThinReports Basic Editor で作成した
// レイアウトをテンプレート(Questionnaire)の canonical に紐付けて登録する。
export function ReportLayoutsPage() {
  const { data, isLoading, error } = useReportLayouts();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ReportLayoutSummary | null>(null);

  function closeForm() {
    setShowForm(false);
    setEditing(null);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>帳票レイアウト</h1>
        {!showForm && !editing && (
          <button type="button" onClick={() => setShowForm(true)}>
            新規登録
          </button>
        )}
      </div>
      <p className="oauth-clients__lead">
        テンプレートの回答(QuestionnaireResponse)を PDF 帳票にするレイアウトを管理します。
        レイアウトは ThinReports Basic Editor で作成し、項目の ID にテンプレートの linkId
        (記号は _ に置換)や予約 ID(pt_name / qr_authored など)を設定します。
      </p>

      {(showForm || editing) && (
        <ReportLayoutForm layout={editing ?? undefined} onSaved={closeForm} onCancel={closeForm} />
      )}

      {isLoading && <p>読み込み中...</p>}
      <ErrorBanner error={error} />
      {data && (
        <ReportLayoutTable
          layouts={data}
          onEdit={(layout) => {
            setShowForm(false);
            setEditing(layout);
          }}
        />
      )}
    </div>
  );
}
