import { useState } from "react";
import { useDeleteAdverseEvent, useSaveAdverseEvent } from "../api/queries";
import {
  adverseEventLabel,
  buildAdverseEvent,
  emptyAdverseEventForm,
  formValuesOf,
  validateAdverseEvent,
  type AdverseEventFormValues,
  type AdverseEventRecord,
  type AdverseEventRef,
} from "../fhir/adverseEventHelpers";
import { CTCAE_GRADE_OPTIONS } from "../fhir/regimenHelpers";
import { useValidationError } from "../hooks/useValidationError";
import { today } from "../lib/dates";
import { CtcaeTermSearchModal } from "./CtcaeTermSearchModal";
import { ErrorBanner } from "./ErrorBanner";

// 有害事象(CTCAE 用語 + Grade + 発現日 / 回復日 + 対処)の記録。化学療法のクールと
// 放射線治療のコースで同じものを使う(docs/chemo-regimen-design.md §7.6 C-3、
// docs/radiotherapy-order-design.md §6.3)。どの治療に付けるかは target が持つ。

interface AdverseEventEditorProps {
  patientId: string;
  /** 記録の宛先。治療のヘッダ・種別・名前の写し・(化学療法なら)クール。 */
  target: AdverseEventRef;
  /** 見出し。「FOLFOX 第 2 クール」「第1コース 左乳房」。 */
  title: string;
  /** その治療の記録(発現日の新しい順)。 */
  records: AdverseEventRecord[];
  /** 用語の候補。レジメンマスタの「想定される副作用」。放射線治療では無い。 */
  candidates?: string[];
  /** 記録の読み込みで起きたエラー。 */
  error?: unknown;
  /** 記録が 1 件も無いときの文言。 */
  emptyMessage: string;
}

const NO_CANDIDATES: string[] = [];

/**
 * 登録してもパネルは閉じない(他のパネルと違う)。1 回の診察で複数の有害事象を続けて
 * 入れるのが普通で、追加のたびに閉じると「記録」を押し直すことになるため。
 */
export function AdverseEventEditor({
  patientId,
  target,
  title,
  records,
  candidates = NO_CANDIDATES,
  error,
  emptyMessage,
}: AdverseEventEditorProps) {
  const save = useSaveAdverseEvent();
  const remove = useDeleteAdverseEvent();
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [values, setValues] = useState<AdverseEventFormValues>(() => emptyAdverseEventForm(today()));

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
    const message = validateAdverseEvent(values);
    setValidationError(message);
    if (message) return;
    const observation = buildAdverseEvent(
      values,
      patientId,
      target,
      editingId ?? undefined,
      // 編集では元の記録者を残す(編集した人で上書きしない)。新規は保存時に入る。
      records.find((record) => record.id === editingId)?.performer,
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
      <ErrorBanner error={error ?? save.error ?? remove.error} />
      <p className="regimen-day__title">{title}</p>

      <ul className="regimen-adverse__list">
        {records.map((record) => (
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
        {records.length === 0 && <li className="regimen-day__empty">{emptyMessage}</li>}
      </ul>

      <fieldset className="regimen-apply__fields">
        <legend>{editingId ? "有害事象を編集" : "有害事象を追加"}</legend>
        <div className="lab-order-item__fields">
          <label className="regimen-apply__reason">
            用語(CTCAE)
            <span className="regimen-adverse__term-row">
              <input
                type="text"
                list="adverse-event-terms"
                value={values.term}
                onChange={(e) => update("term", e.target.value)}
              />
              {/* マスタから選ぶと Grade の定義を読みながら決められる。マスタを取り込んで
                  いない施設でも入力できるよう、自由入力と治療ごとの候補は残す。 */}
              <button type="button" className="rp-card__compact-button" onClick={() => setPicking(true)}>
                CTCAE から選択
              </button>
            </span>
            <datalist id="adverse-event-terms">
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
