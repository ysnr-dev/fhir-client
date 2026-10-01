import { useState } from "react";
import type { DocumentTemplateSummary } from "../api/adminClient";
import { useDocumentTemplates } from "../api/adminQueries";
import { DocumentTemplateForm } from "../components/DocumentTemplateForm";
import { DocumentTemplateTable } from "../components/DocumentTemplateTable";
import { ErrorBanner } from "../components/ErrorBanner";
import { PopulateExpressionModal } from "../components/PopulateExpressionModal";

// 文書テンプレート(Word / Excel の様式ファイル)の管理画面(docs/document-template-design.md)。
// 登録したテンプレートはカルテの「文書作成」から患者に適用する。
export function DocumentTemplatesPage() {
  const { data, isLoading, error } = useDocumentTemplates();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DocumentTemplateSummary | null>(null);
  const [variablesOpen, setVariablesOpen] = useState(false);

  function closeForm() {
    setShowForm(false);
    setEditing(null);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>文書テンプレート</h1>
        <div>
          <button type="button" onClick={() => setVariablesOpen(true)}>
            変数一覧
          </button>
          {!showForm && !editing && (
            <button type="button" onClick={() => setShowForm(true)}>
              新規登録
            </button>
          )}
        </div>
      </div>

      {(showForm || editing) && (
        <DocumentTemplateForm
          key={editing?.id ?? "new"}
          template={editing ?? undefined}
          onSaved={closeForm}
          onCancel={closeForm}
        />
      )}

      {isLoading && <p>読み込み中...</p>}
      <ErrorBanner error={error} />
      {data && (
        <DocumentTemplateTable
          templates={data}
          onEdit={(template) => {
            setShowForm(false);
            setEditing(template);
          }}
        />
      )}

      {variablesOpen && (
        <PopulateExpressionModal placeholder onClose={() => setVariablesOpen(false)} />
      )}
    </div>
  );
}
