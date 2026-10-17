import { useState, type FormEvent } from "react";
import {
  applyStamp,
  isDeciduous,
  isSupernumerary,
  itemOptions,
  newToothRecord,
  recordsOfTooth,
  sortTeeth,
  sortToothCodes,
  supernumeraryCode,
  TOOTH_ROWS,
  type OralExamCodeBook,
  type OralExamSnapshot,
  type OralExamStamp,
  type ToothRecord,
} from "../fhir/oralExamHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { OralExamChart } from "./OralExamChart";
import { OralExamMouthForm } from "./OralExamMouthForm";
import { OralExamStampPalette } from "./OralExamStampPalette";
import { OralExamToothEditor } from "./OralExamToothEditor";

interface OralExamFormProps {
  book: OralExamCodeBook | undefined;
  initialValues: OralExamSnapshot;
  /** 乳歯の行を既定で出すか。 */
  defaultDeciduous: boolean;
  onSubmit: (snapshot: OralExamSnapshot) => void;
  onCancel: () => void;
  submitting: boolean;
  submitError: unknown;
  submitLabel?: string;
}

/** 口腔診査情報の登録・編集。歯式図で歯を選び、下のパネルでその歯を書く。 */
export function OralExamForm({
  book,
  initialValues,
  defaultDeciduous,
  onSubmit,
  onCancel,
  submitting,
  submitError,
  submitLabel = "登録",
}: OralExamFormProps) {
  const [values, setValues] = useState(initialValues);
  const [selected, setSelected] = useState<string>("");
  const [showDeciduous, setShowDeciduous] = useState(
    defaultDeciduous || initialValues.teeth.some((t) => isDeciduous(t.toothCode)),
  );
  const [pickingItem, setPickingItem] = useState<string | null>(null);
  const [stamp, setStamp] = useState<OralExamStamp | null>(null);
  const [dentureNumber, setDentureNumber] = useState("");
  const [bulkBasic, setBulkBasic] = useState("02");
  const [validationError, setValidationError] = useState<string | null>(null);

  function update<K extends keyof OralExamSnapshot>(key: K, value: OralExamSnapshot[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function replaceTooth(toothCode: string, records: ToothRecord[]) {
    setValues((v) => ({ ...v, teeth: sortTeeth([...v.teeth.filter((t) => t.toothCode !== toothCode), ...records]) }));
  }

  function stampTooth(toothCode: string, face?: string) {
    if (!stamp) return;
    setValues((v) => ({
      ...v,
      teeth: sortTeeth([
        ...v.teeth.filter((t) => t.toothCode !== toothCode),
        ...applyStamp(recordsOfTooth(v.teeth, toothCode), toothCode, stamp, { face, dentureNumber, book }),
      ]),
    }));
    setSelected(toothCode);
  }

  function handleChartClick(toothCode: string) {
    if (!pickingItem) {
      if (stamp) stampTooth(toothCode);
      else setSelected(toothCode);
      return;
    }
    const item = pickingItem;
    setValues((v) => {
      const current = v.mouth.teeth[item] ?? [];
      const next = current.includes(toothCode) ? current.filter((c) => c !== toothCode) : [...current, toothCode];
      return { ...v, mouth: { ...v.mouth, teeth: { ...v.mouth.teeth, [item]: sortToothCodes(next) } } };
    });
  }

  // 初診時は全部の歯を書くので、記録の無い歯をまとめて同じ基本状態にできるようにする。
  function fillUnrecorded() {
    const shown = TOOTH_ROWS.filter((row) => showDeciduous || !row.deciduous).flatMap((row) => row.teeth);
    setValues((v) => {
      const added = shown
        .filter((def) => !v.teeth.some((t) => t.toothCode === def.code))
        .map((def) => newToothRecord(def.code, bulkBasic));
      return { ...v, teeth: sortTeeth([...v.teeth, ...added]) };
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values.examDate) {
      setValidationError("診査日を入力してください。");
      return;
    }
    if (!values.inputType) {
      setValidationError("入力種別を選択してください。");
      return;
    }
    setValidationError(null);
    onSubmit(values);
  }

  const selectedRecords = selected ? recordsOfTooth(values.teeth, selected) : [];
  const chartSelected = pickingItem ? (values.mouth.teeth[pickingItem] ?? []) : selected ? [selected] : [];

  return (
    <form className="oral-exam__form" onSubmit={handleSubmit}>
      <div className="oral-exam__fields">
        <label className="oral-exam__field">
          診査日
          <input type="date" value={values.examDate} onChange={(e) => update("examDate", e.target.value)} />
        </label>
        <label className="oral-exam__field oral-exam__field--wide">
          入力種別
          <select value={values.inputType} onChange={(e) => update("inputType", e.target.value)}>
            {itemOptions(book, "NS-2", values.inputType).map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        <label className="oral-exam__field">
          最新初診日
          <input
            type="date"
            value={values.firstVisitDate}
            onChange={(e) => update("firstVisitDate", e.target.value)}
          />
        </label>
        <label className="oral-exam__field">
          最終診療日
          <input
            type="date"
            value={values.lastVisitDate}
            onChange={(e) => update("lastVisitDate", e.target.value)}
          />
        </label>
      </div>

      <div className="oral-exam__toolbar">
        <label className="oral-exam__check">
          <input type="checkbox" checked={showDeciduous} onChange={(e) => setShowDeciduous(e.target.checked)} />
          乳歯
        </label>
        <label className="oral-exam__inline">
          記録の無い歯
          <select value={bulkBasic} onChange={(e) => setBulkBasic(e.target.value)}>
            {itemOptions(book, "TD-2").map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="rp-card__compact-button" onClick={fillUnrecorded}>
          一括設定
        </button>
      </div>

      {!pickingItem && (
        <OralExamStampPalette
          stamp={stamp}
          onChange={setStamp}
          dentureNumber={dentureNumber}
          onDentureNumberChange={setDentureNumber}
        />
      )}
      {pickingItem && <p className="oral-exam__picking">歯式を選択中</p>}

      <OralExamChart
        teeth={values.teeth}
        selected={chartSelected}
        onSelect={handleChartClick}
        onSelectFace={stamp?.surface && !pickingItem ? (toothCode, face) => stampTooth(toothCode, face) : undefined}
        showDeciduous={showDeciduous}
      />

      {selected && !pickingItem && !stamp && (
        <OralExamToothEditor
          key={selected}
          book={book}
          toothCode={selected}
          records={selectedRecords}
          onChange={(records) => replaceTooth(selected, records)}
          hasSupernumerary={
            !isSupernumerary(selected) && values.teeth.some((t) => t.toothCode === supernumeraryCode(selected))
          }
          onAddSupernumerary={(code) => {
            replaceTooth(code, [newToothRecord(code, "01")]);
            setSelected(code);
          }}
        />
      )}

      <OralExamMouthForm
        book={book}
        mouth={values.mouth}
        onChange={(mouth) => update("mouth", mouth)}
        pickingItem={pickingItem}
        onPick={setPickingItem}
      />

      <div className="oral-exam__fields">
        <label className="oral-exam__field oral-exam__field--wide">
          メモ
          <input type="text" value={values.note} onChange={(e) => update("note", e.target.value)} />
        </label>
      </div>

      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <div className="patient-fields__actions">
        <button type="submit" disabled={submitting}>
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          取消
        </button>
      </div>
    </form>
  );
}
