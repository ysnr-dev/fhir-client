import { useState, type FormEvent } from "react";
import {
  applyStamp,
  changedTeeth,
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
  withUpdatedOn,
} from "../fhir/oralExamHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { OralExamChart, OralExamChartSizeButton } from "./OralExamChart";
import { OralExamMouthForm, type MouthPick } from "./OralExamMouthForm";
import { OralExamStampPalette } from "./OralExamStampPalette";
import { OralExamLegendButton } from "./OralExamLegend";
import { OralExamBridgeModal } from "./OralExamBridgeModal";
import { OralExamDentureModal } from "./OralExamDentureModal";
import {
  bridgeOfTooth,
  dentureOfTooth,
  jawOf,
  loadBridge,
  loadDenture,
  newBridgeDraft,
  type BridgeDraft,
  type DentureDraft,
} from "../fhir/oralExamProsthesisHelpers";
import { OralExamToothEditor } from "./OralExamToothEditor";

interface OralExamFormProps {
  book: OralExamCodeBook | undefined;
  initialValues: OralExamSnapshot;
  /** 乳歯の行を既定で出すか。 */
  defaultDeciduous: boolean;
  /** 比べる元(新規なら前回の診査、編集なら開いたときの記録)。変えた歯に印を付け、更新日を書く。 */
  baseline?: ToothRecord[];
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
  baseline,
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
  const [picking, setPicking] = useState<MouthPick | null>(null);
  const [stamp, setStamp] = useState<OralExamStamp | null>(null);
  const [device, setDevice] = useState<
    { kind: "bridge"; draft: BridgeDraft } | { kind: "denture"; draft: DentureDraft } | null
  >(null);
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
        ...applyStamp(recordsOfTooth(v.teeth, toothCode), toothCode, stamp, { face, book }),
      ]),
    }));
    setSelected(toothCode);
  }

  function openBridge(toothCode = selected) {
    const existing = toothCode ? bridgeOfTooth(values.teeth, toothCode) : null;
    setDevice({
      kind: "bridge",
      draft: existing
        ? loadBridge(values.teeth, existing.jaw, existing.number)
        : newBridgeDraft(values.teeth, (toothCode && jawOf(toothCode)) || "upper", toothCode || undefined),
    });
  }

  function openDenture(toothCode = selected) {
    const existing = toothCode ? dentureOfTooth(values.teeth, toothCode) : null;
    const jaw = existing?.jaw ?? ((toothCode && jawOf(toothCode)) || "upper");
    setDevice({ kind: "denture", draft: loadDenture(values.teeth, jaw, existing?.number ?? "") });
  }

  function applyDevice(teeth: ToothRecord[]) {
    setValues((v) => ({ ...v, teeth }));
    setDevice(null);
  }

  function handleChartClick(toothCode: string) {
    if (!picking) {
      if (stamp) stampTooth(toothCode);
      else setSelected(toothCode);
      return;
    }
    const { key, item } = picking;
    setValues((v) => ({
      ...v,
      mouth: v.mouth.map((entry) => {
        if (entry.key !== key) return entry;
        const current = entry.teeth[item] ?? [];
        const next = current.includes(toothCode) ? current.filter((c) => c !== toothCode) : [...current, toothCode];
        return { ...entry, teeth: { ...entry.teeth, [item]: sortToothCodes(next) } };
      }),
    }));
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
    onSubmit({ ...values, teeth: withUpdatedOn(values.teeth, baseline, values.examDate) });
  }

  const selectedRecords = selected ? recordsOfTooth(values.teeth, selected) : [];
  const pickingEntry = picking ? values.mouth.find((m) => m.key === picking.key) : undefined;
  const chartSelected = picking ? (pickingEntry?.teeth[picking.item] ?? []) : selected ? [selected] : [];
  const changed = baseline ? changedTeeth(values.teeth, baseline) : undefined;

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
        <OralExamLegendButton />
        <OralExamChartSizeButton />
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

      {!picking && (
        <OralExamStampPalette
          stamp={stamp}
          onChange={setStamp}
          onOpenBridge={() => openBridge()}
          onOpenDenture={() => openDenture()}
        />
      )}
      {picking && <p className="oral-exam__picking">歯式を選択中</p>}

      <OralExamChart
        teeth={values.teeth}
        selected={chartSelected}
        onSelect={handleChartClick}
        onSelectFace={stamp?.surface && !picking ? (toothCode, face) => stampTooth(toothCode, face) : undefined}
        showDeciduous={showDeciduous}
        changed={changed}
        resizable
      />

      {selected && !picking && !stamp && (
        <OralExamToothEditor
          key={selected}
          book={book}
          toothCode={selected}
          records={selectedRecords}
          onChange={(records) => replaceTooth(selected, records)}
          hasSupernumerary={
            !isSupernumerary(selected) && values.teeth.some((t) => t.toothCode === supernumeraryCode(selected))
          }
          onEditBridge={bridgeOfTooth(values.teeth, selected) ? () => openBridge(selected) : undefined}
          onEditDenture={dentureOfTooth(values.teeth, selected) ? () => openDenture(selected) : undefined}
          onAddSupernumerary={(code) => {
            replaceTooth(code, [newToothRecord(code, "01")]);
            setSelected(code);
          }}
        />
      )}

      {device?.kind === "bridge" && (
        <OralExamBridgeModal
          book={book}
          teeth={values.teeth}
          initial={device.draft}
          onApply={applyDevice}
          onClose={() => setDevice(null)}
        />
      )}
      {device?.kind === "denture" && (
        <OralExamDentureModal
          book={book}
          teeth={values.teeth}
          initial={device.draft}
          onApply={applyDevice}
          onClose={() => setDevice(null)}
        />
      )}

      <OralExamMouthForm
        book={book}
        mouth={values.mouth}
        onChange={(mouth) => update("mouth", mouth)}
        picking={picking}
        onPick={setPicking}
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
