import { useEffect, useState } from "react";
import { useFileCategories } from "../api/adminQueries";
import { FhirError } from "../api/fhirClient";
import {
  usePatientFileDocument,
  usePatientFileSearch,
  useUpdatePatientFile,
} from "../api/queries";
import { isPatientMismatch } from "../fhir/patientHelpers";
import {
  buildPatientFileUpdate,
  contentTypeLabel,
  formatFileSize,
  parsePatientFile,
  parsePatientFileValues,
  type PatientFileValues,
} from "../fhir/patientFileHelpers";
import { dateTimeLabel } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { FileCategoryModal } from "./FileCategoryModal";
import { KarteFilePreview } from "./KarteFilePreview";
import { KarteFileUploadForm } from "./KarteFileUploadForm";
import { Pagination } from "./Pagination";
import { PatientFileTable } from "./PatientFileTable";

// カルテ画面の「ファイル」タブ(docs/patient-file-design.md)。
// 一覧・表示・取込・編集・削除を左ペイン内で完結させる。
//
// 一覧と詳細は URL(view パラメータ)で表す。取込・編集は入力途中の内容を URL では
// 復元できないので、このコンポーネント内の状態に留める。

type Mode =
  | { kind: "list" }
  | { kind: "detail"; fileId: string }
  | { kind: "create" }
  | { kind: "edit"; fileId: string };

type FormMode = Extract<Mode, { kind: "create" } | { kind: "edit" }> | null;

const MODE_TITLES: Record<Mode["kind"], string> = {
  list: "ファイル",
  detail: "ファイル表示",
  create: "ファイル取込",
  edit: "ファイル編集",
};

interface KarteFileTabProps {
  patientId: string;
  /** URL から渡される表示対象の DocumentReference の ID。空なら一覧。 */
  view: string;
  onViewChange: (view: string | null) => void;
}

export function KarteFileTab({ patientId, view, onViewChange }: KarteFileTabProps) {
  const [form, setForm] = useState<FormMode>(null);
  const [offset, setOffset] = useState(0);
  const [categoryCode, setCategoryCode] = useState("");
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  // 戻る・進むで表示対象が変わったら、開いていたフォームは畳む。
  useEffect(() => setForm(null), [view]);

  const mode: Mode = form ?? (view ? { kind: "detail", fileId: view } : { kind: "list" });

  const { data: categories = [] } = useFileCategories();
  const { bundle, total, count, hasPrevious, hasNext, isLoading, error } = usePatientFileSearch(
    patientId,
    categoryCode,
    offset,
  );
  const files =
    bundle?.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.DocumentReference => r?.resourceType === "DocumentReference")
      .map(parsePatientFile) ?? [];

  function backToList() {
    setForm(null);
    onViewChange(null);
  }

  if (mode.kind !== "list") {
    return (
      <div className="karte-tabpanel">
        <div className="karte-tabpanel__header">
          <h3>{MODE_TITLES[mode.kind]}</h3>
          <div className="karte-tabpanel__actions">
            {mode.kind === "detail" && (
              <button type="button" onClick={() => setForm({ kind: "edit", fileId: mode.fileId })}>
                編集
              </button>
            )}
            <button type="button" onClick={backToList}>
              ← 一覧に戻る
            </button>
          </div>
        </div>
        {mode.kind === "detail" ? (
          <DetailPanel patientId={patientId} fileId={mode.fileId} />
        ) : mode.kind === "create" ? (
          <KarteFileUploadForm patientId={patientId} onSaved={backToList} />
        ) : (
          <EditForm patientId={patientId} fileId={mode.fileId} onSaved={backToList} />
        )}
      </div>
    );
  }

  return (
    <div className="karte-tabpanel">
      <div className="karte-tabpanel__header">
        <h3>{MODE_TITLES.list}</h3>
        <div className="karte-tabpanel__actions">
          <select
            className="karte-file-filter"
            aria-label="カテゴリで絞り込む"
            value={categoryCode}
            onChange={(e) => {
              setCategoryCode(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">すべてのカテゴリ</option>
            {categories.map((category) => (
              <option key={category.id} value={category.code}>
                {category.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setCategoriesOpen(true)}>
            カテゴリ管理
          </button>
          <button type="button" onClick={() => setForm({ kind: "create" })}>
            取込
          </button>
        </div>
      </div>

      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <PatientFileTable
            files={files}
            onView={(fileId) => onViewChange(fileId)}
            onEdit={(fileId) => setForm({ kind: "edit", fileId })}
          />
          <Pagination
            offset={offset}
            count={count}
            total={total}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
            onPrevious={() => setOffset((o) => Math.max(0, o - count))}
            onNext={() => setOffset((o) => o + count)}
          />
        </>
      )}

      {categoriesOpen && <FileCategoryModal onClose={() => setCategoriesOpen(false)} />}
    </div>
  );
}

function DetailPanel({ patientId, fileId }: { patientId: string; fileId: string }) {
  const { data: result, isLoading, error: loadError } = usePatientFileDocument(fileId);

  const doc = result?.data;
  // URL の患者と DocumentReference.subject が食い違う場合は他患者のものなので表示しない。
  const patientMismatch = isPatientMismatch(patientId, doc?.subject);
  const error =
    loadError ??
    (patientMismatch ? new Error("指定されたファイルは別の患者のものです。") : undefined);

  const file = doc && !patientMismatch ? parsePatientFile(doc) : undefined;

  return (
    <>
      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        file && (
          <div className="prescription-detail">
            <fieldset>
              <legend>ファイル情報</legend>
              <dl className="prescription-detail__common">
                <dt>表示名</dt>
                <dd>{file.title}</dd>
                <dt>診療日</dt>
                <dd>{file.date || "-"}</dd>
                <dt>カテゴリ</dt>
                <dd>{file.categoryName || "-"}</dd>
                <dt>種類</dt>
                <dd>{contentTypeLabel(file.contentType)}</dd>
                <dt>サイズ</dt>
                <dd>{formatFileSize(file.size) || "-"}</dd>
                <dt>登録者</dt>
                <dd>{file.authorName || "-"}</dd>
                <dt>更新日時</dt>
                <dd>{dateTimeLabel(file.lastUpdated) || "-"}</dd>
              </dl>
            </fieldset>
            <KarteFilePreview file={file} />
          </div>
        )
      )}
    </>
  );
}

function EditForm({
  patientId,
  fileId,
  onSaved,
}: {
  patientId: string;
  fileId: string;
  onSaved: () => void;
}) {
  const { data: result, isLoading, error: loadError } = usePatientFileDocument(fileId);
  const { data: categories = [] } = useFileCategories();
  const updateFile = useUpdatePatientFile();
  const [values, setValues] = useState<PatientFileValues | null>(null);
  const [conflict, setConflict] = useState(false);

  const doc = result?.data;
  // 別患者のファイルを更新すると subject が書き換わり、付け替わってしまう。
  const patientMismatch = isPatientMismatch(patientId, doc?.subject);
  const error =
    loadError ??
    (patientMismatch ? new Error("指定されたファイルは別の患者のものです。") : undefined);

  const initial = doc && !patientMismatch ? parsePatientFileValues(parsePatientFile(doc)) : null;
  const form = values ?? initial;

  function handleSubmit() {
    if (!doc || !result?.etag || !form || patientMismatch) return;
    setConflict(false);
    const category = categories.find((c) => c.code === form.categoryCode) ?? null;
    updateFile.mutate(
      {
        doc: buildPatientFileUpdate(
          doc,
          form,
          category && { code: category.code, name: category.name },
        ),
        etag: result.etag,
      },
      {
        onSuccess: onSaved,
        onError: (err) => {
          if (err instanceof FhirError && err.status === 412) setConflict(true);
        },
      },
    );
  }

  return (
    <>
      <ErrorBanner error={error} />

      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            このファイルは他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        form && (
          <div className="karte-file-form">
            <ErrorBanner error={conflict ? undefined : updateFile.error} />
            <div className="karte-file-form__fields">
              <label>
                表示名
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setValues({ ...form, title: e.target.value })}
                />
              </label>
              <label>
                診療日
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setValues({ ...form, date: e.target.value })}
                />
              </label>
              <label>
                カテゴリ
                <select
                  value={form.categoryCode}
                  onChange={(e) => setValues({ ...form, categoryCode: e.target.value })}
                >
                  <option value="">(未設定)</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.code}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="karte-file-form__actions">
              <button
                type="button"
                disabled={updateFile.isPending || !form.title.trim()}
                onClick={handleSubmit}
              >
                更新
              </button>
            </div>
          </div>
        )
      )}
    </>
  );
}
