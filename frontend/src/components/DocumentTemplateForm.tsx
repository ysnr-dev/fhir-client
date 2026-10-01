import { useMemo, useState } from "react";
import type { DocumentTemplatePayload, DocumentTemplateSummary } from "../api/adminClient";
import {
  useCreateDocumentTemplate,
  useDocumentTemplateFile,
  useFileCategories,
  useUpdateDocumentTemplate,
} from "../api/adminQueries";
import { extractPlaceholders, officeTemplateKindOf } from "../fhir/officeTemplate";
import { formatFileSize } from "../fhir/patientFileHelpers";
import { readFileAsDataUrl } from "../fhir/schemaImage";
import { DocumentPlaceholderList } from "./DocumentPlaceholderList";
import { ErrorBanner } from "./ErrorBanner";

/** backend(DocumentTemplate::DATA_MAX_BYTESIZE)と同じ上限。 */
const TEMPLATE_MAX_BYTES = 5 * 1024 * 1024;

interface Props {
  /** 渡されたら編集、無ければ新規登録。 */
  template?: DocumentTemplateSummary;
  onSaved: () => void;
  onCancel: () => void;
}

interface SelectedFile {
  name: string;
  /** 本体(base64)。 */
  data: string;
  placeholders: string[];
}

function placeholdersOf(fileName: string, bytes: Uint8Array): string[] | null {
  const kind = officeTemplateKindOf(fileName, bytes);
  return kind ? extractPlaceholders(bytes, kind) : null;
}

// Word / Excel の様式ファイルを文書テンプレートとして登録するフォーム。
// ファイルを選んだ時点で中のプレースホルダーを読み取って並べる。
export function DocumentTemplateForm({ template, onSaved, onCancel }: Props) {
  const [name, setName] = useState(template?.name ?? "");
  const [categoryId, setCategoryId] = useState(
    template?.file_category_id ? String(template.file_category_id) : "",
  );
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const { data: categories = [] } = useFileCategories();
  const create = useCreateDocumentTemplate();
  const update = useUpdateDocumentTemplate();
  const saving = create.isPending || update.isPending;

  // 編集でファイルを選び直していない間は、登録済みの本体のプレースホルダーを出す。
  const stored = useDocumentTemplateFile(file ? undefined : template);
  const storedPlaceholders = useMemo(
    () => (template && stored.data ? placeholdersOf(template.file_name, stored.data) : null),
    [template, stored.data],
  );
  const placeholders = file?.placeholders ?? storedPlaceholders;

  async function handleFile(selected: File | undefined) {
    setValidationError(null);
    setFile(null);
    if (!selected) return;
    if (selected.size > TEMPLATE_MAX_BYTES) {
      return setValidationError(
        `${formatFileSize(TEMPLATE_MAX_BYTES)}を超えるファイルは登録できません。`,
      );
    }
    const found = placeholdersOf(selected.name, new Uint8Array(await selected.arrayBuffer()));
    if (!found) {
      return setValidationError("Word(.docx)または Excel(.xlsx)のファイルを選択してください。");
    }
    const dataUrl = await readFileAsDataUrl(selected);
    setFile({
      name: selected.name,
      data: dataUrl.slice(dataUrl.indexOf(",") + 1),
      placeholders: found,
    });
    if (!name) setName(selected.name.replace(/\.[^.]+$/, ""));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setValidationError(null);

    if (!name.trim()) return setValidationError("名称を入力してください。");
    if (!template && !file) return setValidationError("ファイルを選択してください。");

    const payload: DocumentTemplatePayload = {
      name: name.trim(),
      file_category_id: categoryId ? Number(categoryId) : null,
    };
    if (file) {
      payload.file_name = file.name;
      payload.file_data = file.data;
    }

    try {
      if (template) {
        await update.mutateAsync({ id: template.id, payload });
      } else {
        await create.mutateAsync(payload);
      }
      onSaved();
    } catch {
      // エラーは mutation の error として ErrorBanner に表示される
    }
  }

  return (
    <form className="patient-form report-layout-form" onSubmit={handleSubmit}>
      <fieldset disabled={saving}>
        <legend>{template ? "文書テンプレートの編集" : "文書テンプレートの登録"}</legend>

        <label>
          名称
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label>
          カテゴリ
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">(未設定)</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          ファイル
          <input
            type="file"
            accept=".docx,.xlsx"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
        </label>
        {template && !file && (
          <p className="report-layout-form__file">登録済み: {template.file_name}</p>
        )}

        {placeholders && (
          <div className="document-template-form__placeholders">
            <span>プレースホルダー</span>
            <DocumentPlaceholderList tokens={placeholders} />
          </div>
        )}

        {validationError && <p className="error-banner">{validationError}</p>}
        <ErrorBanner error={stored.error} />
        <ErrorBanner error={create.error} />
        <ErrorBanner error={update.error} />

        <div className="patient-form__actions">
          <button type="submit">{saving ? "保存中..." : "保存"}</button>
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
        </div>
      </fieldset>
    </form>
  );
}
