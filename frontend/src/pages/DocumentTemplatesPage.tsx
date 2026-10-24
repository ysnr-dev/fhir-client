import { lazy, Suspense, useState } from "react";
import type { DocumentTemplateSummary } from "../api/adminClient";
import { useDocumentTemplates } from "../api/adminQueries";
import { DocumentTemplateForm } from "../components/DocumentTemplateForm";
import { DocumentTemplateTable } from "../components/DocumentTemplateTable";
import { ErrorBanner } from "../components/ErrorBanner";
import { PopulateExpressionModal } from "../components/PopulateExpressionModal";

// デザイナは pdfjs を使うので、開くときだけ読み込む。
const DocumentFormDesigner = lazy(() => import("../components/documentForm/DocumentFormDesigner"));

type FormMode = { kind: "office" } | { kind: "form" } | { kind: "edit"; template: DocumentTemplateSummary };

// 文書テンプレートの管理画面(docs/document-template-design.md)。Word / Excel の様式ファイルと、
// PDF / 画像の様式に項目を置いたもの(デザイナ)の 2 種類を登録する。
// 登録したテンプレートはカルテの「文書作成」から患者に適用する。
export function DocumentTemplatesPage() {
  const { data, isLoading, error } = useDocumentTemplates();
  const [mode, setMode] = useState<FormMode | null>(null);
  const [variablesOpen, setVariablesOpen] = useState(false);

  function closeForm() {
    setMode(null);
  }

  const designerOpen = mode?.kind === "form" || (mode?.kind === "edit" && mode.template.kind === "form");

  return (
    <div className="page">
      <div className="page__header">
        <h1>文書テンプレート</h1>
        <div>
          <button type="button" onClick={() => setVariablesOpen(true)}>
            変数一覧
          </button>
          {!mode && (
            <>
              <button type="button" onClick={() => setMode({ kind: "office" })}>
                Word / Excel
              </button>
              <button type="button" onClick={() => setMode({ kind: "form" })}>
                様式
              </button>
            </>
          )}
        </div>
      </div>

      {mode && !designerOpen && (
        <DocumentTemplateForm
          key={mode.kind === "edit" ? mode.template.id : "new"}
          template={mode.kind === "edit" ? mode.template : undefined}
          onSaved={closeForm}
          onCancel={closeForm}
        />
      )}
      {mode && designerOpen && (
        <Suspense fallback={<p>読み込み中...</p>}>
          <DocumentFormDesigner
            key={mode.kind === "edit" ? mode.template.id : "new"}
            template={mode.kind === "edit" ? mode.template : undefined}
            onSaved={closeForm}
            onCancel={closeForm}
          />
        </Suspense>
      )}

      {isLoading && <p>読み込み中...</p>}
      <ErrorBanner error={error} />
      {data && !designerOpen && (
        <DocumentTemplateTable templates={data} onEdit={(template) => setMode({ kind: "edit", template })} />
      )}

      {variablesOpen && (
        <PopulateExpressionModal placeholder onClose={() => setVariablesOpen(false)} />
      )}
    </div>
  );
}
