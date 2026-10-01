import { useMemo, useState } from "react";
import { useDocumentTemplateFile, useDocumentTemplates } from "../api/adminQueries";
import { useCurrentPractitioner } from "../api/authQueries";
import { useCreatePatientFiles, usePatient, usePopulateSources } from "../api/queries";
import {
  placeholderValues,
  resolvePlaceholders,
  type PlaceholderStatus,
} from "../fhir/documentPlaceholders";
import {
  extractPlaceholders,
  fillOfficeTemplate,
  OFFICE_CONTENT_TYPES,
  officeTemplateKindOf,
} from "../fhir/officeTemplate";
import { formatFileSize, PATIENT_FILE_MAX_BYTES } from "../fhir/patientFileHelpers";
import { buildPopulateContext } from "../fhir/populateContext";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { readFileAsDataUrl } from "../fhir/schemaImage";
import { today } from "../lib/dates";
import { downloadBlob } from "../lib/download";
import { ErrorBanner } from "./ErrorBanner";

// カルテ右ペインの「文書作成」(docs/document-template-design.md)。
// 文書テンプレート(Word / Excel)を選ぶと、中のプレースホルダーにいまのカルテの値を
// 差し込んだファイルを作り、患者のファイルとして保存したうえでダウンロードさせる。
// 続きは手元の Word / Excel で書き、「ファイル」タブの「差し替え」で戻す。

const STATUS_NOTES: Partial<Record<PlaceholderStatus, string>> = {
  empty: "(該当なし)",
  unknown: "一覧にありません",
  error: "式を評価できません",
};

function extensionOf(fileName: string): string {
  return /\.[^.]+$/.exec(fileName)?.[0].toLowerCase() ?? "";
}

export function DocumentCreatePanel({
  patientId,
  onSaved,
}: {
  patientId: string;
  onSaved: () => void;
}) {
  const templates = useDocumentTemplates(true);
  const { data: patientResult, error: patientError } = usePatient(patientId);
  const populate = usePopulateSources(patientId);
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const createFiles = useCreatePatientFiles();

  const [categoryCode, setCategoryCode] = useState("");
  const [templateId, setTemplateId] = useState("");
  // null の間はテンプレートから決まる既定の表示名を使う。
  const [title, setTitle] = useState<string | null>(null);
  const [date, setDate] = useState(today());
  const [message, setMessage] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  const items = useMemo(() => templates.data ?? [], [templates.data]);
  // 絞り込みに出すのは、テンプレートが 1 件でも入っているカテゴリだけ。
  const categories = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const item of items) {
      if (item.file_category_code) {
        byCode.set(item.file_category_code, item.file_category_name ?? "");
      }
    }
    return [...byCode].map(([code, name]) => ({ code, name }));
  }, [items]);
  const choices = categoryCode
    ? items.filter((item) => item.file_category_code === categoryCode)
    : items;

  const template = items.find((item) => String(item.id) === templateId);
  const file = useDocumentTemplateFile(template);
  const extension = template ? extensionOf(template.file_name) : "";
  const fileTitle = title ?? (template ? `${template.name}${extension}` : "");

  const patient = patientResult?.data;
  const context = useMemo(
    () =>
      patient && !populate.isLoading
        ? buildPopulateContext({ patient, ...populate.sources })
        : undefined,
    [patient, populate.isLoading, populate.sources],
  );

  const kind = useMemo(
    () => (template && file.data ? officeTemplateKindOf(template.file_name, file.data) : null),
    [template, file.data],
  );
  const resolved = useMemo(
    () =>
      file.data && kind && context
        ? resolvePlaceholders(extractPlaceholders(file.data, kind), context)
        : null,
    [file.data, kind, context],
  );

  async function handleCreate() {
    if (!template || !file.data || !kind || !resolved) return;
    setMessage(null);
    setBuilding(true);
    try {
      const bytes = fillOfficeTemplate(file.data, kind, placeholderValues(resolved));
      if (bytes.length > PATIENT_FILE_MAX_BYTES) {
        setMessage(`${formatFileSize(PATIENT_FILE_MAX_BYTES)}を超える文書は保存できません。`);
        return;
      }
      // 表示名はダウンロード時のファイル名になるので、拡張子が無ければ補う。
      const name = fileTitle.trim() || template.name;
      const fileName = extensionOf(name) === extension ? name : `${name}${extension}`;
      const contentType = OFFICE_CONTENT_TYPES[kind];
      const blob = new Blob([bytes as BlobPart], { type: contentType });
      const dataUrl = await readFileAsDataUrl(new File([blob], fileName, { type: contentType }));

      const result = await createFiles.mutateAsync({
        drafts: [
          { key: crypto.randomUUID(), title: fileName, contentType, size: bytes.length, dataUrl },
        ],
        patientId,
        date,
        category:
          template.file_category_code && template.file_category_name
            ? { code: template.file_category_code, name: template.file_category_name }
            : null,
        practitionerId: practitionerId ?? undefined,
        practitionerName: practitioner ? practitionerDisplayName(practitioner) : undefined,
        documentType: { code: template.code, name: template.name },
      });
      if (result.errors.length > 0) {
        setMessage(result.errors.join(" "));
        return;
      }
      // 保存できてから渡す(カルテに無い文書が手元にだけ残らないように)。
      downloadBlob(blob, fileName);
      onSaved();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "文書を作成できませんでした。");
    } finally {
      setBuilding(false);
    }
  }

  const loadingValues = Boolean(template) && (file.isLoading || !context);
  const unsupported = Boolean(template && file.data && !kind);
  const busy = building || createFiles.isPending;

  return (
    <div className="karte-file-form document-create">
      <ErrorBanner error={templates.error} />
      <ErrorBanner error={patientError} />
      <ErrorBanner error={populate.error} />
      <ErrorBanner error={file.error} />
      {(message || unsupported) && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            {message ?? "このテンプレートのファイルを読み取れません。"}
          </p>
        </div>
      )}

      <div className="karte-file-form__fields">
        {categories.length > 0 && (
          <label>
            カテゴリ
            <select
              value={categoryCode}
              onChange={(e) => {
                setCategoryCode(e.target.value);
                setTemplateId("");
                setTitle(null);
              }}
            >
              <option value="">すべて</option>
              {categories.map((category) => (
                <option key={category.code} value={category.code}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          テンプレート
          <select
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setTitle(null);
              setMessage(null);
            }}
          >
            <option value="">選択してください</option>
            {choices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {template && (
        <div className="karte-file-form__fields">
          <label className="document-create__title">
            表示名
            <input type="text" value={fileTitle} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            診療日
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
      )}

      {loadingValues && !file.error && <p>読み込み中...</p>}

      {resolved && resolved.length > 0 && (
        <table className="patient-table document-create__values">
          <thead>
            <tr>
              <th>プレースホルダー</th>
              <th>値</th>
            </tr>
          </thead>
          <tbody>
            {resolved.map((item) => (
              <tr
                key={item.token}
                className={
                  item.status === "unknown" || item.status === "error"
                    ? "document-create__row--unresolved"
                    : undefined
                }
              >
                <td>{item.token}</td>
                <td className="document-create__value">
                  {item.status === "ok" ? item.value : STATUS_NOTES[item.status]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="karte-file-form__actions">
        <button type="button" disabled={busy || !resolved} onClick={() => void handleCreate()}>
          {busy ? "作成中..." : "作成"}
        </button>
      </div>
    </div>
  );
}
