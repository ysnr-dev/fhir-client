import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useFileCategories } from "../api/adminQueries";
import { useCreatePatientFiles } from "../api/queries";
import {
  formatFileSize,
  readPatientFileDraft,
  type PatientFileDraft,
} from "../fhir/patientFileHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";

// ファイルの取込フォーム。ファイル選択とドラッグ&ドロップの 2 経路で足し、
// まとめて登録する。診療日とカテゴリはまとめて 1 つぶんだけ持つ(同じ日に
// 受け取った同じ分類の書類をまとめて入れる使い方が中心のため)。

export function KarteFileUploadForm({
  patientId,
  onSaved,
}: {
  patientId: string;
  onSaved: () => void;
}) {
  const { data: categories = [] } = useFileCategories();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const createFiles = useCreatePatientFiles();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<PatientFileDraft[]>([]);
  const [date, setDate] = useState(today());
  const [categoryCode, setCategoryCode] = useState("");
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // 非同期の読み込み中に他の操作で配列が変わっても、最新の並びに足すための参照。
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    setReading(true);
    const added: PatientFileDraft[] = [];
    const errors: string[] = [];
    for (const file of files) {
      try {
        added.push(await readPatientFileDraft(file));
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `${file.name}: 読み込めませんでした。`);
      }
    }
    setReading(false);
    setMessage(errors.length > 0 ? errors.join(" ") : null);
    if (added.length > 0) setDrafts([...draftsRef.current, ...added]);
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // 同じファイルを続けて選び直せるよう、読み込み前に入力を空にしておく。
    e.target.value = "";
    void addFiles(files);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    void addFiles(Array.from(e.dataTransfer.files));
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragging(true);
  }

  function handleSubmit() {
    if (drafts.length === 0) return;
    const category = categories.find((c) => c.code === categoryCode) ?? null;
    createFiles.mutate(
      {
        drafts,
        patientId,
        date,
        category: category && { code: category.code, name: category.name },
        practitionerId: practitionerId ?? undefined,
        practitionerName: practitioner ? practitionerDisplayName(practitioner) : undefined,
      },
      {
        onSuccess: (result) => {
          if (result.errors.length === 0) {
            onSaved();
            return;
          }
          // 保存できたファイルは一覧から外し、残ったものだけ再挑戦できるようにする。
          setDrafts((prev) => prev.filter((d) => result.failedKeys.includes(d.key)));
          setMessage(`${result.saved} 件を登録しました。${result.errors.join(" ")}`);
        },
      },
    );
  }

  const busy = reading || createFiles.isPending;

  return (
    <div className="karte-file-form">
      <ErrorBanner error={createFiles.error} />
      {message && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{message}</p>
        </div>
      )}

      <div
        className={`karte-file-drop${dragging ? " karte-file-drop--dragging" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <p>ここにファイルをドロップ</p>
        <button type="button" disabled={busy} onClick={() => fileInputRef.current?.click()}>
          ファイルを選択
        </button>
        <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileInput} />
      </div>

      {drafts.length > 0 && (
        <ul className="karte-file-drafts">
          {drafts.map((draft, index) => (
            <li key={draft.key} className="karte-file-drafts__row">
              <input
                type="text"
                aria-label={`${draft.title} の表示名`}
                value={draft.title}
                onChange={(e) =>
                  setDrafts((prev) =>
                    prev.map((d, i) => (i === index ? { ...d, title: e.target.value } : d)),
                  )
                }
              />
              <span className="karte-file-drafts__size">{formatFileSize(draft.size)}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDrafts((prev) => prev.filter((_, i) => i !== index))}
              >
                除く
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="karte-file-form__fields">
        <label>
          診療日
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          カテゴリ
          <select value={categoryCode} onChange={(e) => setCategoryCode(e.target.value)}>
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
        <button type="button" disabled={busy || drafts.length === 0} onClick={handleSubmit}>
          {createFiles.isPending ? "登録中..." : `${drafts.length} 件を登録`}
        </button>
      </div>
    </div>
  );
}
