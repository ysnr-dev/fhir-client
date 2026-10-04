import { useState, type FormEvent } from "react";
import { encounterAdmissionDate, encounterDischargeDate } from "../fhir/encounterHelpers";
import {
  NURSING_COURSE_SECTION,
  NURSING_SUMMARY_PROBLEM_SECTION,
  NURSING_SUMMARY_KIND_OPTIONS,
  NURSING_SUMMARY_SECTIONS,
  NURSING_SUMMARY_TEXT_SECTIONS,
  appendNursingRecords,
  draftNursingSummaryForm,
  nursingSummaryKindLabel,
  type NursingSummaryEntrySection,
  type NursingSummaryFormValues,
  type NursingSummaryKind,
  type NursingSummarySources,
} from "../fhir/nursingSummaryHelpers";
import type { NursingProblemView } from "../fhir/nursingCarePlanHelpers";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { NursingProblemTree } from "./NursingProblemTree";
import { Modal } from "./Modal";
import { useNoteSectionsEditor } from "./NoteSectionsEditor";

export type NursingSummarySubmitMode = "draft" | "confirm" | "approve" | "approve-edited";

interface Props {
  patientId: string;
  encounter: fhir4.Encounter;
  initialValues: NursingSummaryFormValues;
  sources?: NursingSummarySources;
  /** 新規のときだけ種別を選べる(変えると下書きを作り直す)。 */
  onKindChange?: (kind: NursingSummaryKind) => void;
  /** 帯に出す作成・承認・差戻しの情報。 */
  status?: { author: string; attested: string; approver: string; returnReason: string };
  /** approver = 承認者として開いた(承認・修正承認を出す)。 */
  role: "author" | "approver";
  onSubmit: (values: NursingSummaryFormValues, mode: NursingSummarySubmitMode) => void;
  submitting: boolean;
  submitError?: unknown;
  validationError?: string;
}

// 看護サマリーの入力(登録・編集共用)。上に入院・種別・期間の帯、下に固定のセクション。
// 病名・看護問題は候補のチェックリスト、本文は診療記録と同じリッチテキスト。
// 看護経過には期間内の看護記録を選んで取り込める。
export function NursingSummaryForm({
  patientId,
  encounter,
  initialValues,
  sources,
  onKindChange,
  status,
  role,
  onSubmit,
  submitting,
  submitError,
  validationError,
}: Props) {
  const [values, setValues] = useState(initialValues);
  const [importing, setImporting] = useState(false);

  const editor = useNoteSectionsEditor({
    patientId,
    sections: values.sections,
    onChange: (sections) => setValues((v) => ({ ...v, sections })),
    sectionOptions: NURSING_SUMMARY_TEXT_SECTIONS,
    arrangeable: false,
  });

  function toggleEntry(code: NursingSummaryEntrySection, reference: string, selected: boolean) {
    setValues((v) => ({
      ...v,
      entries: { ...v.entries, [code]: v.entries[code].map((c) => (c.reference === reference ? { ...c, selected } : c)) },
    }));
  }

  // 押したボタンの value が保存の種類(保存・確定・承認・修正承認)。
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    onSubmit(values, (submitter?.value as NursingSummarySubmitMode | undefined) ?? "draft");
  }

  const discharge = encounterDischargeDate(encounter);
  const records = (sources?.nursingRecords ?? []).filter((r) => {
    const day = r.date.slice(0, 10);
    return (!values.periodStart || day >= values.periodStart) && (!values.periodEnd || day <= values.periodEnd);
  });

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
            <dd>{discharge === "-" ? "入院中" : discharge}</dd>
            <dt>病棟</dt>
            <dd>{sources?.ward.wardName || "-"}</dd>
            {status && (
              <>
                <dt>作成者</dt>
                <dd>
                  {status.author || "-"}
                  {status.attested && ` (確定 ${status.attested})`}
                </dd>
                <dt>承認者</dt>
                <dd>{status.approver || "-"}</dd>
                {status.returnReason && (
                  <>
                    <dt>差戻し理由</dt>
                    <dd className="nursing-summary__return">{status.returnReason}</dd>
                  </>
                )}
              </>
            )}
          </dl>
          <label>
            種別
            {onKindChange ? (
              <select value={values.kind} onChange={(e) => onKindChange(e.target.value as NursingSummaryKind)}>
                {NURSING_SUMMARY_KIND_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            ) : (
              <span>{nursingSummaryKindLabel(values.kind)}</span>
            )}
          </label>
          <label>
            期間
            <span className="nursing-summary__range">
              <input
                type="date"
                value={values.periodStart}
                onChange={(e) => setValues((v) => ({ ...v, periodStart: e.target.value }))}
                aria-label="期間の始まり"
              />
              〜
              <input
                type="date"
                value={values.periodEnd}
                onChange={(e) => setValues((v) => ({ ...v, periodEnd: e.target.value }))}
                aria-label="期間の終わり"
              />
            </span>
          </label>
          <label>
            記録日時
            <input
              type="datetime-local"
              value={values.date}
              onChange={(e) => setValues((v) => ({ ...v, date: e.target.value }))}
            />
          </label>
        </fieldset>

        <fieldset className="clinical-note-form__sections discharge-summary__content">
          <legend>内容</legend>
          {NURSING_SUMMARY_SECTIONS.map((def, index) => (
            <div key={def.code} className="discharge-summary__section">
              <h3 className="discharge-summary__title">
                {def.title}
                {def.code === NURSING_COURSE_SECTION && (
                  <button
                    type="button"
                    className="rp-card__compact-button"
                    onClick={() => setImporting(true)}
                    disabled={!sources}
                  >
                    取込
                  </button>
                )}
                {/* 候補の集め直しは内容全体への操作なので、最初のセクションの見出しの右端に置く。 */}
                {index === 0 && (
                  <button
                    type="button"
                    className="rp-card__compact-button discharge-summary__recollect"
                    onClick={() => sources && setValues((v) => draftNursingSummaryForm(sources, v.kind, v))}
                    disabled={!sources}
                  >
                    再収集
                  </button>
                )}
              </h3>
              {def.code === NURSING_SUMMARY_PROBLEM_SECTION ? (
                <NursingProblemChecklist
                  candidates={values.entries[def.code]}
                  problems={sources?.nursingProblems ?? []}
                  onToggle={(reference, selected) => toggleEntry(def.code as NursingSummaryEntrySection, reference, selected)}
                />
              ) : def.kind === "entry" ? (
                <Checklist
                  candidates={values.entries[def.code as NursingSummaryEntrySection]}
                  onToggle={(reference, selected) =>
                    toggleEntry(def.code as NursingSummaryEntrySection, reference, selected)
                  }
                />
              ) : (
                editor.items.get(values.sections.find((s) => s.code === def.code)?.uid ?? "")
              )}
            </div>
          ))}
        </fieldset>

        <div className="prescription-form__submit">
          {role === "author" ? (
            <>
              <button type="submit" disabled={submitting} value="draft">
                保存
              </button>
              <button type="submit" disabled={submitting} value="confirm">
                確定
              </button>
            </>
          ) : (
            <>
              <button type="submit" disabled={submitting} value="approve">
                承認
              </button>
              <button type="submit" disabled={submitting} value="approve-edited">
                修正承認
              </button>
            </>
          )}
        </div>
      </form>

      {/* モーダルは form の外に置く(NoteSectionsEditor 参照)。 */}
      {editor.modals}
      {importing && (
        <RecordImportModal
          records={records}
          onImport={(selected) => {
            setValues((v) => appendNursingRecords(v, selected));
            setImporting(false);
          }}
          onClose={() => setImporting(false)}
        />
      )}
    </>
  );
}

function Checklist({
  candidates,
  onToggle,
}: {
  candidates: { reference: string; display: string; selected: boolean }[];
  onToggle: (reference: string, selected: boolean) => void;
}) {
  if (candidates.length === 0) return <p className="order-select__muted">該当なし</p>;
  return (
    <ul className="discharge-summary__checklist">
      {candidates.map((c) => (
        <li key={c.reference}>
          <label>
            <input type="checkbox" checked={c.selected} onChange={(e) => onToggle(c.reference, e.target.checked)} />
            {c.display}
          </label>
        </li>
      ))}
    </ul>
  );
}

/**
 * 看護問題・計画の候補。チェックボックスの文言は「#n 問題」だけにし、中身(目標・計画・評価)は看護計画タブと同じツリーで
 * その下に出す。看護計画を読めない(取り消された等)候補は保存済みの要約の行をそのまま出す。
 */
function NursingProblemChecklist({
  candidates,
  problems,
  onToggle,
}: {
  candidates: { reference: string; display: string; selected: boolean }[];
  problems: NursingProblemView[];
  onToggle: (reference: string, selected: boolean) => void;
}) {
  const at = today();
  if (candidates.length === 0) return <p className="order-select__muted">該当なし</p>;
  return (
    <ul className="discharge-summary__checklist nursing-summary__problems">
      {candidates.map((c) => {
        const [title, ...rest] = c.display.split("\n");
        const view = problems.find((p) => `CarePlan/${p.carePlan.id}` === c.reference);
        return (
          <li key={c.reference}>
            <label>
              <input type="checkbox" checked={c.selected} onChange={(e) => onToggle(c.reference, e.target.checked)} />
              {title}
            </label>
            {view ? (
              <NursingProblemTree view={view} at={at} />
            ) : (
              rest.length > 0 && <div className="nursing-summary__record-text">{rest.map((line) => line.trim()).join("\n")}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RecordImportModal({
  records,
  onImport,
  onClose,
}: {
  records: NursingSummarySources["nursingRecords"];
  onImport: (records: NursingSummarySources["nursingRecords"]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return (
    <Modal title="看護記録の取込" onClose={onClose} className="modal--wide">
      {records.length === 0 ? (
        <p className="order-select__muted">期間内の看護記録はありません。</p>
      ) : (
        <ul className="nursing-summary__records">
          {records.map((r) => (
            <li key={r.id}>
              <label className="nursing-problem-form__check">
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(r.id);
                      else next.delete(r.id);
                      return next;
                    })
                  }
                />
                {r.date.slice(0, 16).replace("T", " ")} {r.title}({r.author})
              </label>
              <div className="nursing-summary__record-text">{r.text}</div>
            </li>
          ))}
        </ul>
      )}
      <div className="lab-order-item__actions">
        <button
          type="button"
          disabled={selected.size === 0}
          onClick={() => onImport(records.filter((r) => selected.has(r.id)))}
        >
          取込
        </button>
      </div>
    </Modal>
  );
}
