import { useState } from "react";
import { useRegimen } from "../api/masterQueries";
import { useDeleteAdverseEvent, useRegimenAdverseEvents, useSaveAdverseEvent } from "../api/queries";
import {
  adverseEventLabel,
  adverseEventsOf,
  buildAdverseEvent,
  emptyAdverseEventForm,
  formValuesOf,
  validateAdverseEvent,
  type AdverseEventFormValues,
  type AdverseEventRecord,
} from "../fhir/adverseEventHelpers";
import { CTCAE_GRADE_OPTIONS } from "../fhir/regimenHelpers";
import { useRegimenApplication } from "../hooks/useRegimenApplication";
import { useValidationError } from "../hooks/useValidationError";
import { today } from "../lib/dates";
import { CtcaeTermSearchModal } from "./CtcaeTermSearchModal";
import { ErrorBanner } from "./ErrorBanner";

// カルテ右ペインの「化学療法(有害事象)」。適用 1 件のクールに対して有害事象
// (CTCAE 用語 + Grade + 発現日 / 回復日 + 対処)を記録する(§7.6 C-3)。
// 用語はレジメンマスタの「想定される副作用」を候補に出し、自由入力もできる。

interface RegimenAdverseEventPanelProps {
  patientId: string;
  regimenSrId: string;
  cycle: number;
}

/**
 * 登録してもパネルは閉じない(他のパネルと違う)。1 クールに複数の有害事象を続けて
 * 入れるのが普通で、追加のたびに閉じると「記録」を押し直すことになるため。
 */
export function RegimenAdverseEventPanel({ patientId, regimenSrId, cycle }: RegimenAdverseEventPanelProps) {
  const { application, isPending, error } = useRegimenApplication(patientId, regimenSrId);
  const master = useRegimen(application?.code || null);
  const events = useRegimenAdverseEvents(patientId);
  const save = useSaveAdverseEvent();
  const remove = useDeleteAdverseEvent();
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [values, setValues] = useState<AdverseEventFormValues>(() => emptyAdverseEventForm(today()));

  if (isPending) return <p>読み込み中...</p>;
  if (!application) return <ErrorBanner error={error ?? new Error("レジメンの適用が見つかりません")} />;

  const own = adverseEventsOf(events.data ?? [], regimenSrId, cycle);
  const candidates = master.data?.adverse_events.map((ae) => ae.term) ?? [];

  function update<K extends keyof AdverseEventFormValues>(key: K, value: AdverseEventFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function startEdit(record: AdverseEventRecord) {
    setEditingId(record.id);
    setValues(formValuesOf(record));
  }

  function reset() {
    setEditingId(null);
    setValues(emptyAdverseEventForm(today()));
  }

  function handleSubmit() {
    if (!application) return;
    const message = validateAdverseEvent(values);
    setValidationError(message);
    if (message) return;
    const observation = buildAdverseEvent(
      values,
      patientId,
      { regimenSrId, cycle, code: application.code, name: application.name },
      editingId ?? undefined,
      // 編集では元の記録者を残す(編集した人で上書きしない)。新規は保存時に入る。
      own.find((record) => record.id === editingId)?.performer,
    );
    save.mutate(observation, { onSuccess: reset });
  }

  function handleDelete(record: AdverseEventRecord) {
    if (!window.confirm(`${adverseEventLabel(record)} を削除します。よろしいですか？`)) return;
    remove.mutate(record.id, { onSuccess: () => (editingId === record.id ? reset() : undefined) });
  }

  return (
    <div className="regimen-adverse">
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={error ?? events.error ?? save.error ?? remove.error} />
      <p className="regimen-day__title">
        {application.name} 第 {cycle} クール
      </p>

      <ul className="regimen-adverse__list">
        {own.map((record) => (
          <li key={record.id} className={`regimen-adverse__item${record.id === editingId ? " regimen-adverse__item--editing" : ""}`}>
            <span className={`regimen-adverse__grade regimen-adverse__grade--${record.grade}`}>G{record.grade}</span>
            <span className="regimen-adverse__term">{record.term}</span>
            <span className="regimen-adverse__period">
              {record.onset}
              {record.resolved ? ` 〜 ${record.resolved}` : " 〜（継続中）"}
            </span>
            {record.note && <span className="regimen-adverse__note">{record.note}</span>}
            <span className="regimen-adverse__actions">
              <button type="button" className="rp-card__compact-button" onClick={() => startEdit(record)}>
                編集
              </button>
              <button type="button" className="rp-card__compact-button" onClick={() => handleDelete(record)}>
                削除
              </button>
            </span>
          </li>
        ))}
        {own.length === 0 && <li className="regimen-day__empty">このクールの有害事象はありません</li>}
      </ul>

      <fieldset className="regimen-apply__fields">
        <legend>{editingId ? "有害事象を編集" : "有害事象を追加"}</legend>
        <div className="lab-order-item__fields">
          <label className="regimen-apply__reason">
            用語(CTCAE)
            <span className="regimen-adverse__term-row">
              <input
                type="text"
                list="regimen-adverse-terms"
                value={values.term}
                onChange={(e) => update("term", e.target.value)}
              />
              {/* マスタから選ぶと Grade の定義を読みながら決められる。マスタを取り込んで
                  いない施設でも入力できるよう、自由入力とレジメンの候補は残す。 */}
              <button type="button" className="rp-card__compact-button" onClick={() => setPicking(true)}>
                CTCAE から選択
              </button>
            </span>
            <datalist id="regimen-adverse-terms">
              {candidates.map((term) => (
                <option key={term} value={term} />
              ))}
            </datalist>
          </label>
          <label>
            Grade
            <select value={values.grade} onChange={(e) => update("grade", e.target.value)}>
              {CTCAE_GRADE_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label>
            発現日
            <input type="date" value={values.onset} onChange={(e) => update("onset", e.target.value)} />
          </label>
          <label>
            回復日
            <input type="date" value={values.resolved} onChange={(e) => update("resolved", e.target.value)} />
          </label>
          <label className="regimen-apply__reason">
            対処・経過
            <input type="text" value={values.note} onChange={(e) => update("note", e.target.value)} />
          </label>
        </div>
      </fieldset>

      {picking && (
        <CtcaeTermSearchModal
          onSelect={(term) => {
            update("term", term.term_ja);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}

      <div className="lab-order-item__actions">
        <button type="button" onClick={handleSubmit} disabled={save.isPending}>
          {editingId ? "更新" : "追加"}
        </button>
        {editingId && (
          <button type="button" onClick={reset} disabled={save.isPending}>
            編集をやめる
          </button>
        )}
      </div>
    </div>
  );
}
