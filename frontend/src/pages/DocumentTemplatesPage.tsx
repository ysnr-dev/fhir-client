import { lazy, Suspense, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { DocumentTemplateKind, DocumentTemplateSummary } from "../api/adminClient";
import { useDocumentTemplates } from "../api/adminQueries";
import { DocumentTemplateForm } from "../components/DocumentTemplateForm";
import { DocumentTemplateTable } from "../components/DocumentTemplateTable";
import { ErrorBanner } from "../components/ErrorBanner";
import { PopulateExpressionModal } from "../components/PopulateExpressionModal";

// デザイナは pdfjs を使うので、開くときだけ読み込む。
const DocumentFormDesigner = lazy(() => import("../components/documentForm/DocumentFormDesigner"));

type FormMode = { kind: "create" } | { kind: "edit"; template: DocumentTemplateSummary };

const TABS: { kind: DocumentTemplateKind; label: string }[] = [
  { kind: "form", label: "様式" },
  { kind: "office", label: "Word / Excel" },
];

function tabOf(value: string | null): DocumentTemplateKind {
  return value === "office" ? "office" : "form";
}

// 文書テンプレートの管理画面(docs/document-template-design.md)。PDF / 画像の様式に項目を置いたもの(デザイナ)と、
// Word / Excel の様式ファイルをタブで分けて登録する。選んだタブは URL(?tab=)に持つ。
// 登録したテンプレートはカルテの「文書作成」から患者に適用する。
export function DocumentTemplatesPage() {
  const { data, isLoading, error } = useDocumentTemplates();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabOf(searchParams.get("tab"));
  const [mode, setMode] = useState<FormMode | null>(null);
  const [variablesOpen, setVariablesOpen] = useState(false);

  function closeForm() {
    setMode(null);
  }

  function changeTab(next: DocumentTemplateKind) {
    setMode(null);
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        params.set("tab", next);
        return params;
      },
      { replace: true },
    );
  }

  const templates = (data ?? []).filter((template) => template.kind === tab);
  const editing = mode?.kind === "edit" ? mode.template : undefined;

  return (
    <div className="page">
      <div className="page__header">
        <h1>文書テンプレート</h1>
        <div>
          <button type="button" onClick={() => setVariablesOpen(true)}>
            変数一覧
          </button>
          {!mode && (
            <button type="button" onClick={() => setMode({ kind: "create" })}>
              新規登録
            </button>
          )}
        </div>
      </div>

      <div className="order-select__tabs" role="tablist">
        {TABS.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={tab === kind}
            className={tab === kind ? "order-select__tab is-active" : "order-select__tab"}
            onClick={() => changeTab(kind)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode && tab === "office" && (
        <DocumentTemplateForm
          key={editing?.id ?? "new"}
          template={editing}
          onSaved={closeForm}
          onCancel={closeForm}
        />
      )}
      {mode && tab === "form" && (
        <Suspense fallback={<p>読み込み中...</p>}>
          <DocumentFormDesigner key={editing?.id ?? "new"} template={editing} onSaved={closeForm} onCancel={closeForm} />
        </Suspense>
      )}

      {isLoading && <p>読み込み中...</p>}
      <ErrorBanner error={error} />
      {/* デザイナは幅を使うので、開いている間は一覧を畳む。 */}
      {data && !(mode && tab === "form") && (
        <DocumentTemplateTable templates={templates} onEdit={(template) => setMode({ kind: "edit", template })} />
      )}

      {variablesOpen && (
        <PopulateExpressionModal placeholder onClose={() => setVariablesOpen(false)} />
      )}
    </div>
  );
}
