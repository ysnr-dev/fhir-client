import { useEffect, useMemo, useState } from "react";
import { documentTemplatePageUrl, type DocumentTemplateSummary } from "../api/adminClient";
import { useDocumentTemplateFile, useDocumentTemplates } from "../api/adminQueries";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useCreatePatientFiles,
  useLatestQuestionnaireResponse,
  usePatient,
  usePatientFileDocument,
  usePopulateSources,
  useQuestionnaireByCanonical,
  useQuestionnaireResponse,
  useSaveDocumentFormDocument,
} from "../api/queries";
import { FhirError } from "../api/fhirClient";
import {
  missingRequiredLabels,
  normalizeLayout,
  type DocumentFormLayout,
  type DocumentFormValues,
} from "../fhir/documentFormLayout";
import {
  copyPreviousDocumentFormValues,
  documentFormCanonicalsUpTo,
  documentFormValuesFromResponse,
} from "../fhir/documentFormQuestionnaire";
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
import { formatFileSize, parsePatientFile, PATIENT_FILE_MAX_BYTES } from "../fhir/patientFileHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { buildPopulateContext } from "../fhir/populateContext";
import { collectLabCodes } from "../fhir/populateLab";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { DEFAULT_INSTITUTION_NUMBER } from "../fhir/questionnaireResponseHelpers";
import { readFileAsDataUrl } from "../fhir/schemaImage";
import { useEditSnapshot } from "../hooks/useEditSnapshot";
import { useSelfInstitutionNumber } from "../hooks/useSelfInstitutionNumber";
import { localDay, today } from "../lib/dates";
import { downloadBlob } from "../lib/download";
import { DocumentFormFill } from "./documentForm/DocumentFormFill";
import { ErrorBanner } from "./ErrorBanner";

// カルテ右ペインの「文書作成」(docs/document-template-design.md)。
// Word / Excel のテンプレートは、中のプレースホルダーにいまのカルテの値を差し込んだファイルを作り、
// 患者のファイルとして保存したうえでダウンロードさせる(続きは手元の Word / Excel で書き、
// 「ファイル」タブの「差し替え」で戻す)。
// 様式(PDF / 画像)のテンプレートは、様式の見た目のまま入力し、表示用 PDF と回答(QuestionnaireResponse)を
// 一緒に保存する。作った文書はファイルタブの「内容編集」から同じ画面で直せる(edit)。

const STATUS_NOTES: Partial<Record<PlaceholderStatus, string>> = {
  empty: "(該当なし)",
  unknown: "一覧にありません",
  error: "式を評価できません",
};

// テンプレートの選択肢は種類で分ける(画面で入力して PDF を残すものか、ファイルを作ってダウンロードするものか)。
const TEMPLATE_GROUPS: { kind: DocumentTemplateSummary["kind"]; label: string }[] = [
  { kind: "form", label: "様式" },
  { kind: "office", label: "Word / Excel" },
];

function extensionOf(fileName: string): string {
  return /\.[^.]+$/.exec(fileName)?.[0].toLowerCase() ?? "";
}

export function DocumentCreatePanel({
  patientId,
  edit,
  onSaved,
}: {
  patientId: string;
  /** 様式文書の再編集。作成した文書(DocumentReference)の id。 */
  edit?: { documentId: string };
  onSaved: () => void;
}) {
  if (edit) return <DocumentFormEditPanel patientId={patientId} documentId={edit.documentId} onSaved={onSaved} />;
  return <DocumentCreateBody patientId={patientId} onSaved={onSaved} />;
}

function DocumentCreateBody({ patientId, onSaved }: { patientId: string; onSaved: () => void }) {
  const templates = useDocumentTemplates(true);
  const { data: patientResult, error: patientError } = usePatient(patientId);
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
  const isForm = template?.kind === "form";
  const file = useDocumentTemplateFile(isForm ? undefined : template);
  const extension = template ? (isForm ? ".pdf" : extensionOf(template.file_name)) : "";
  const fileTitle = title ?? (template ? `${template.name}${extension}` : "");

  const kind = useMemo(
    () => (template && !isForm && file.data ? officeTemplateKindOf(template.file_name, file.data) : null),
    [template, isForm, file.data],
  );
  const placeholders = useMemo(
    () => (file.data && kind ? extractPlaceholders(file.data, kind) : null),
    [file.data, kind],
  );
  // 検査項目の最新値は、選んだテンプレートの式が参照しているコードだけ取る
  // (Word / Excel はファイルが届くまで参照が分からないので、届いてから取り直す)。
  const labCodes = useMemo(
    () =>
      collectLabCodes(
        isForm && template
          ? normalizeLayout(template.layout).fields.map((field) => field.initial_expression)
          : (placeholders ?? []),
      ),
    [isForm, template, placeholders],
  );
  const populate = usePopulateSources(patientId, { labCodes });

  const patient = patientResult?.data;
  const context = useMemo(
    () =>
      patient && !populate.isLoading
        ? buildPopulateContext({ patient, ...populate.sources })
        : undefined,
    [patient, populate.isLoading, populate.sources],
  );

  const resolved = useMemo(
    () => (placeholders && context ? resolvePlaceholders(placeholders, context) : null),
    [placeholders, context],
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

  const loadingValues = Boolean(template) && !isForm && (file.isLoading || !context);
  const unsupported = Boolean(template && !isForm && file.data && !kind);
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
            {TEMPLATE_GROUPS.map((group) => {
              const members = choices.filter((item) => item.kind === group.kind);
              if (members.length === 0) return null;
              return (
                <optgroup key={group.kind} label={group.label}>
                  {members.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
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

      {template && isForm && patient && (
        <DocumentFormEntry
          key={template.id}
          patientId={patientId}
          patient={patient}
          template={template}
          context={context}
          title={fileTitle}
          date={date}
          onSaved={onSaved}
        />
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

      {!isForm && (
        <div className="karte-file-form__actions">
          <button type="button" disabled={busy || !resolved} onClick={() => void handleCreate()}>
            {busy ? "作成中..." : "作成"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---- 様式(form) ----

interface ExistingDocument {
  doc: fhir4.DocumentReference;
  docEtag: string;
  response: fhir4.QuestionnaireResponse;
  responseEtag: string;
}

/**
 * 様式の入力と保存。新規は初期値式を評価して値を入れ、再編集は保存済みの回答から復元する。
 * Questionnaire はテンプレートの現在の版を使う(再編集も現在の版に付け替える)。
 */
function DocumentFormEntry({
  patientId,
  patient,
  template,
  context,
  title,
  date,
  existing,
  onSaved,
}: {
  patientId: string;
  patient: fhir4.Patient;
  template: DocumentTemplateSummary;
  /** 初期値式の評価環境。新規のみ(読み込み中は undefined)。 */
  context?: Record<string, unknown>;
  title: string;
  date: string;
  existing?: ExistingDocument;
  onSaved: () => void;
}) {
  const layout = useMemo<DocumentFormLayout>(() => normalizeLayout(template.layout), [template.layout]);
  const canonical =
    template.questionnaire_url && template.questionnaire_version
      ? `${template.questionnaire_url}|${template.questionnaire_version}`
      : undefined;
  const { questionnaire, isLoading: questionnaireLoading, error: questionnaireError } =
    useQuestionnaireByCanonical(canonical);
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const institutionNumber = useSelfInstitutionNumber();
  const save = useSaveDocumentFormDocument();
  const [values, setValues] = useState<DocumentFormValues | null>(
    existing ? documentFormValuesFromResponse(existing.response, layout) : null,
  );
  const [message, setMessage] = useState<string | null>(null);

  // 前回の回答(新規のみ)。自動では入れず、ボタンで重ねる。取消で重ねる前の値に戻す。
  const { latest } = useLatestQuestionnaireResponse(
    existing ? undefined : patientId,
    template.questionnaire_url && template.questionnaire_version
      ? documentFormCanonicalsUpTo(template.questionnaire_url, template.questionnaire_version)
      : undefined,
  );
  const [beforeCopy, setBeforeCopy] = useState<DocumentFormValues | null>(null);

  function toggleCopy() {
    if (!values || !latest) return;
    if (beforeCopy) {
      setValues(beforeCopy);
      setBeforeCopy(null);
    } else {
      setBeforeCopy(values);
      setValues(copyPreviousDocumentFormValues(latest, layout, values));
    }
  }

  // 初期値式は開いた時点の値で 1 回だけ入れる(入力中に読み直されても上書きしない)。
  useEffect(() => {
    if (values !== null || existing || !context) return;
    const fields = layout.fields.filter((field) => field.initial_expression);
    const resolved = resolvePlaceholders(
      fields.map((field) => field.initial_expression as string),
      context,
    );
    const initial: DocumentFormValues = {};
    fields.forEach((field, index) => {
      const item = resolved[index];
      if (item.status === "ok") {
        initial[field.id] = field.type === "date" ? item.value.slice(0, 10) : item.value;
      }
    });
    setValues(initial);
  }, [values, existing, context, layout]);

  async function handleSave() {
    if (!values || !questionnaire) return;
    setMessage(null);
    const missing = missingRequiredLabels(layout, values);
    if (missing.length > 0) {
      setMessage(`${missing.join("、")}を入力してください。`);
      return;
    }
    try {
      await save.mutateAsync({
        template,
        layout,
        questionnaire,
        patient,
        values,
        title: title.trim() || template.name,
        date,
        meta: {
          status: "completed",
          authorName: practitioner ? practitionerDisplayName(practitioner) : "",
          institutionNumber: institutionNumber || DEFAULT_INSTITUTION_NUMBER,
        },
        practitionerId: practitionerId ?? undefined,
        practitionerName: practitioner ? practitionerDisplayName(practitioner) : undefined,
        existing,
      });
      onSaved();
    } catch (err) {
      setMessage(
        err instanceof FhirError && err.status === 412
          ? "この文書は他の操作によって更新されています。画面を再読込してから再度保存してください。"
          : err instanceof FhirError
            ? null
            : err instanceof Error
              ? err.message
              : "文書を保存できませんでした。",
      );
    }
  }

  const busy = save.isPending;
  const ready = values !== null && Boolean(questionnaire);

  return (
    <>
      <ErrorBanner error={questionnaireError} />
      {message ? (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{message}</p>
        </div>
      ) : (
        <ErrorBanner error={save.error} />
      )}
      {!canonical && (
        <p className="order-select__muted">このテンプレートは配置が保存されていません。</p>
      )}
      {canonical && !questionnaireLoading && !questionnaire && (
        <p className="order-select__muted">テンプレートの項目定義が見つかりません。</p>
      )}
      {values === null && !existing && <p>読み込み中...</p>}
      {values !== null && (
        <DocumentFormFill
          patientId={patientId}
          layout={layout}
          pages={template.pages}
          imageUrlOf={(pageNumber) => documentTemplatePageUrl(template, pageNumber)}
          values={values}
          onChange={setValues}
          actions={
            <>
              {latest && (
                <button type="button" className="rp-card__compact-button qr-copy-previous" onClick={toggleCopy}>
                  {beforeCopy ? (
                    "複写取消"
                  ) : (
                    <>
                      前回値複写
                      <span className="qr-copy-previous__date">
                        {latest.authored ? localDay(latest.authored) : "日付不明"}
                      </span>
                    </>
                  )}
                </button>
              )}
              <button type="button" disabled={busy || !ready} onClick={() => void handleSave()}>
                {busy ? "保存中..." : existing ? "更新" : "作成"}
              </button>
            </>
          }
        />
      )}
    </>
  );
}

/** ファイルタブの「内容編集」。文書と回答を開いた時点の版に固定して開く。 */
function DocumentFormEditPanel({
  patientId,
  documentId,
  onSaved,
}: {
  patientId: string;
  documentId: string;
  onSaved: () => void;
}) {
  const docQuery = useEditSnapshot(usePatientFileDocument(documentId), documentId);
  const doc = docQuery.data?.data;
  const file = doc ? parsePatientFile(doc) : undefined;
  const responseId = file?.relatedResponseId ?? undefined;
  const responseQuery = useEditSnapshot(useQuestionnaireResponse(responseId), responseId);
  const templates = useDocumentTemplates(false);
  const { data: patientResult, error: patientError } = usePatient(patientId);

  const template = templates.data?.find((item) => item.code === file?.documentTypeCode);
  const [title, setTitle] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);

  const loading = docQuery.isLoading || responseQuery.isLoading || templates.isLoading;
  const response = responseQuery.data?.data;
  const existing: ExistingDocument | undefined =
    doc && docQuery.data?.etag && response && responseQuery.data?.etag
      ? { doc, docEtag: docQuery.data.etag, response, responseEtag: responseQuery.data.etag }
      : undefined;

  let notice: string | null = null;
  if (!loading) {
    if (doc && isPatientMismatch(patientId, doc.subject)) notice = "指定された文書は別の患者のものです。";
    else if (doc && !file?.relatedResponseId) notice = "この文書は様式テンプレートから作ったものではありません。";
    else if (doc && !template) notice = "この文書のテンプレートが見つかりません。";
    else if (template && template.kind !== "form") notice = "このテンプレートは様式ではありません。";
  }

  return (
    <div className="karte-file-form document-create">
      <ErrorBanner error={docQuery.error} />
      <ErrorBanner error={responseQuery.error} />
      <ErrorBanner error={templates.error} />
      <ErrorBanner error={patientError} />
      {notice && <p className="order-select__muted">{notice}</p>}
      {loading && <p>読み込み中...</p>}
      {!notice && file && template && existing && patientResult?.data && (
        <>
          <div className="karte-file-form__fields">
            <label className="document-create__title">
              表示名
              <input
                type="text"
                value={title ?? file.title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              診療日
              <input type="date" value={date ?? file.date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <DocumentFormEntry
            patientId={patientId}
            patient={patientResult.data}
            template={template}
            title={title ?? file.title}
            date={date ?? file.date}
            existing={existing}
            onSaved={onSaved}
          />
        </>
      )}
    </div>
  );
}
