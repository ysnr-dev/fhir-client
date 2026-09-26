import { useState } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useFileCategories } from "../api/adminQueries";
import { useCreatePatientFiles } from "../api/queries";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import type { CapturedImage } from "../imaging/captureViewport";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 注釈を描いた画像を JPEG にして、カルテのファイルとして登録する。

export function DicomSaveImageModal({
  patientId,
  image,
  defaultTitle,
  defaultDate,
  onSaved,
  onClose,
}: {
  patientId: string;
  image: CapturedImage;
  defaultTitle: string;
  defaultDate: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { data: categories = [] } = useFileCategories();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const createFiles = useCreatePatientFiles();

  const [title, setTitle] = useState(defaultTitle);
  const [date, setDate] = useState(defaultDate);
  const [categoryCode, setCategoryCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  function handleSave() {
    const category = categories.find((c) => c.code === categoryCode) ?? null;
    createFiles.mutate(
      {
        drafts: [
          {
            key: crypto.randomUUID(),
            title: title.trim() || defaultTitle,
            contentType: "image/jpeg",
            size: image.size,
            dataUrl: image.dataUrl,
          },
        ],
        patientId,
        date,
        category: category && { code: category.code, name: category.name },
        practitionerId: practitionerId ?? undefined,
        practitionerName: practitioner ? practitionerDisplayName(practitioner) : undefined,
      },
      {
        onSuccess: (result) => {
          if (result.errors.length === 0) onSaved();
          else setMessage(result.errors.join(" "));
        },
      },
    );
  }

  return (
    <Modal title="画像をファイルに保存" onClose={onClose} className="modal--dicom-save">
      <ErrorBanner error={createFiles.error} />
      {message && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{message}</p>
        </div>
      )}
      <img className="dicom-save__preview" src={image.dataUrl} alt="保存する画像" />
      <div className="karte-file-form__fields dicom-save__fields">
        <label>
          表示名
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
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
      <div className="dicom-dialog__actions">
        <button type="button" onClick={onClose}>
          取消
        </button>
        <button type="button" disabled={createFiles.isPending || !date} onClick={handleSave}>
          {createFiles.isPending ? "保存中..." : "保存"}
        </button>
      </div>
    </Modal>
  );
}
