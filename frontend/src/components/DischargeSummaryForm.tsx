import { useState, type FormEvent } from "react";
import {
  DISCHARGE_DISPOSITION_OPTIONS,
  encounterAdmissionDate,
  encounterAttendingName,
  encounterDepartmentName,
  encounterDischargeDate,
  encounterStayDays,
} from "../fhir/encounterHelpers";
import {
  SUMMARY_SECTIONS,
  SUMMARY_TEXT_SECTIONS,
  draftDischargeSummaryForm,
  type DischargeSummaryFormValues,
  type DischargeSummarySources,
  type EntrySectionCode,
} from "../fhir/dischargeSummaryHelpers";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { useNoteSectionsEditor } from "./NoteSectionsEditor";

// 退院時サマリーの入力フォーム(Create/Edit 共用)。上に入院情報の帯(入院日・退院日・
// 在院日数・診療科・主治医・転帰)、下に固定の 8 セクションを並べる。参照を持つ
// セクション(退院時診断・手術処置・退院時処方・アレルギー)は候補のチェックリスト、
// 本文のセクションは診療記録と同じリッチテキスト(テンプレート・シェーマも使える)。

interface DischargeSummaryFormProps {
  patientId: string;
  encounter: fhir4.Encounter;
  initialValues: DischargeSummaryFormValues;
  /** 下書きを集め直すための入院期間のデータ。読み込み中は undefined。 */
  sources?: DischargeSummarySources;
  statusLocked?: boolean;
  onSubmit: (values: DischargeSummaryFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  validationError?: string | null;
  submitLabel?: string;
}

export function DischargeSummaryForm({
  patientId,
  encounter,
  initialValues,
  sources,
  statusLocked = false,
  onSubmit,
  submitting,
  submitError,
  validationError,
  submitLabel = "登録",
}: DischargeSummaryFormProps) {
  const [values, setValues] = useState<DischargeSummaryFormValues>(initialValues);

  function toggleEntry(code: EntrySectionCode, reference: string, selected: boolean) {
    setValues((v) => ({
      ...v,
      entries: {
        ...v.entries,
        [code]: v.entries[code].map((c) => (c.reference === reference ? { ...c, selected } : c)),
      },
    }));
  }

  // 本文セクションは 1 セクション 1 エディタで、固定の並び(SUMMARY_SECTIONS)の中に
  // 参照セクションと交互に置く。編集部品はセクション配列を受け取るので、全体を渡して
  // 描画だけをセクションごとに分ける。
  const editor = useNoteSectionsEditor({
    patientId,
    sections: values.sections,
    onChange: (sections) => setValues((v) => ({ ...v, sections })),
    sectionOptions: SUMMARY_TEXT_SECTIONS,
    arrangeable: false,
  });

  function recollect() {
    if (!sources) return;
    setValues((v) => draftDischargeSummaryForm(sources, v));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(values);
  }

  const stayDays = encounterStayDays(encounter, today());
  const dischargeDate = encounterDischargeDate(encounter);

  return (
    <>
      <form className="patient-form clinical-note-form" onSubmit={handleSubmit}>
        <ErrorBanner error={submitError} />
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}

        <fieldset>
          <legend>入院情報</legend>
          <dl className="prescription-detail__common">
            <dt>入院日</dt>
            <dd>{encounterAdmissionDate(encounter)}</dd>
            <dt>退院日</dt>
            <dd>{dischargeDate === "-" ? "入院中" : dischargeDate}</dd>
            <dt>在院日数</dt>
            <dd>{stayDays != null ? `${stayDays} 日` : "-"}</dd>
            <dt>診療科</dt>
            <dd>{encounterDepartmentName(encounter)}</dd>
            <dt>主治医</dt>
            <dd>{encounterAttendingName(encounter) || "-"}</dd>
          </dl>
          <label>
            転帰
            <select
              value={values.disposition}
              onChange={(e) => setValues((v) => ({ ...v, disposition: e.target.value }))}
            >
              <option value="">（未設定）</option>
              {DISCHARGE_DISPOSITION_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            記録日時
            <input
              type="datetime-local"
              value={values.date}
              onChange={(e) => setValues((v) => ({ ...v, date: e.target.value }))}
            />
          </label>
          {!statusLocked && (
            <label>
              ステータス
              <select
                value={values.status}
                onChange={(e) =>
                  setValues((v) => ({ ...v, status: e.target.value as "preliminary" | "final" }))
                }
              >
                <option value="preliminary">下書き</option>
                <option value="final">確定</option>
              </select>
            </label>
          )}
        </fieldset>

        <fieldset className="clinical-note-form__sections">
          <legend>内容</legend>
          <div className="discharge-summary__tools">
            <button type="button" onClick={recollect} disabled={!sources}>
              下書きを集め直す
            </button>
          </div>
          {SUMMARY_SECTIONS.map((def) => (
            <div key={def.code} className="discharge-summary__section">
              <h3 className="discharge-summary__title">{def.title}</h3>
              {def.kind === "entry" ? (
                <EntryChecklist
                  candidates={values.entries[def.code as EntrySectionCode]}
                  onToggle={(reference, selected) =>
                    toggleEntry(def.code as EntrySectionCode, reference, selected)
                  }
                />
              ) : (
                editor.items.get(values.sections.find((s) => s.code === def.code)?.uid ?? "")
              )}
            </div>
          ))}
        </fieldset>

        <div className="prescription-form__submit">
          <button type="submit" disabled={submitting}>
            {submitting ? "送信中..." : submitLabel}
          </button>
        </div>
      </form>

      {/* モーダルは form の外に置く(NoteSectionsEditor 参照)。 */}
      {editor.modals}
    </>
  );
}

function EntryChecklist({
  candidates,
  onToggle,
}: {
  candidates: { reference: string; display: string; selected: boolean }[];
  onToggle: (reference: string, selected: boolean) => void;
}) {
  if (candidates.length === 0) {
    return <p className="order-select__muted">該当なし</p>;
  }
  return (
    <ul className="discharge-summary__checklist">
      {candidates.map((c) => (
        <li key={c.reference}>
          <label>
            <input
              type="checkbox"
              checked={c.selected}
              onChange={(e) => onToggle(c.reference, e.target.checked)}
            />
            {c.display}
          </label>
        </li>
      ))}
    </ul>
  );
}
