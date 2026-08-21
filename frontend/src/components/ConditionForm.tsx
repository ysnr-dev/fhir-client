import { makeFieldUpdater } from "../lib/form";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { Disease, Modifier } from "../api/masterClient";
import {
  CATEGORY_LABELS,
  conditionBaseName,
  conditionDisplayName,
  emptyConditionForm,
  invalidParentIds,
  isSuspected,
  OUTCOME_OPTIONS,
  problemLabel,
  withSuspected,
  type ConditionCategory,
  type ConditionFormValues,
  type DiseaseInputMode,
  type OutcomeCode,
} from "../fhir/conditionHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { DiseaseSearchModal } from "./DiseaseSearchModal";
import { ModifierSearchModal } from "./ModifierSearchModal";

interface ConditionFormProps {
  initialValues?: ConditionFormValues;
  onSubmit: (values: ConditionFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
  /** 関連(親・引き継ぎ先)の候補にする、この患者の既存プロブレム。 */
  problems?: fhir4.Condition[];
  /** 編集中のプロブレム自身の id。自分と配下を候補から外すのに使う。 */
  selfId?: string;
}

type ModalState = { kind: "disease" } | { kind: "prefix" } | { kind: "postfix" } | null;

export function ConditionForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
  problems = [],
  selfId,
}: ConditionFormProps) {
  const [values, setValues] = useState<ConditionFormValues>(initialValues ?? emptyConditionForm);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  const update = makeFieldUpdater(setValues);

  // フリー入力では修飾語(疑い病名を含む)を使わないので、切り替えたときに落とす。
  // 残したまま隠すと、画面に出ていない語が病名に付いたまま保存されてしまう。
  function selectDiseaseMode(mode: DiseaseInputMode) {
    setValues((v) =>
      mode === "free"
        ? { ...v, diseaseMode: mode, prefixModifiers: [], postfixModifiers: [] }
        : { ...v, diseaseMode: mode },
    );
  }

  function handleDiseaseSelect(disease: Disease) {
    update("disease", disease);
    setModal(null);
  }

  function handleModifierSelect(modifier: Modifier) {
    if (modal?.kind === "prefix") {
      setValues((v) => ({ ...v, prefixModifiers: [...v.prefixModifiers, modifier] }));
    } else if (modal?.kind === "postfix") {
      setValues((v) => ({ ...v, postfixModifiers: [...v.postfixModifiers, modifier] }));
    }
    setModal(null);
  }

  function removeModifier(kind: "prefixModifiers" | "postfixModifiers", index: number) {
    setValues((v) => ({ ...v, [kind]: v[kind].filter((_, i) => i !== index) }));
  }

  // 引き継ぎ先を指定したら、そのプロブレムは追わなくなるので転帰も閉じる
  // (画面上で転帰欄も変わるので、勝手に閉じられたことが見える)。
  function addSuccessor(id: string) {
    if (!id) return;
    setValues((v) => ({
      ...v,
      succeededByIds: v.succeededByIds.includes(id) ? v.succeededByIds : [...v.succeededByIds, id],
      outcome: v.outcome === "active" ? "inactive" : v.outcome,
    }));
  }

  function removeSuccessor(id: string) {
    setValues((v) => ({ ...v, succeededByIds: v.succeededByIds.filter((x) => x !== id) }));
  }

  function validate(): string | null {
    if (!conditionBaseName(values)) {
      return values.diseaseMode === "free"
        ? "病名を入力してください。"
        : "病名を選択してください。";
    }
    if (!values.startDate) return "開始日は必須です。";
    if (values.endDate && values.endDate < values.startDate) {
      return "終了日は開始日以降の日付を入力してください。";
    }
    if (values.endDate && values.outcome === "active") {
      return "終了日を入力した場合は、転帰区分を軽快・治癒・中止のいずれかにしてください。";
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validate();
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    onSubmit(values);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // input 上での Enter による暗黙の form submit を抑止する。
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
    }
  }

  // 自分自身と自分の配下は、親にすると参照が輪になるので候補から外す。
  const excludedIds = selfId ? invalidParentIds(problems, selfId) : new Set<string>();
  const relationOptions = problems.filter((p) => p.id && !excludedIds.has(p.id));
  const problemLabelOf = (id: string) => {
    const found = problems.find((p) => p.id === id);
    return found ? problemLabel(found) : "(削除済み)";
  };

  const fullName = conditionDisplayName(values);
  const singleUseWarning =
    values.diseaseMode === "master" &&
    values.disease?.single_use_prohibited_category === "01" &&
    values.prefixModifiers.length === 0 &&
    values.postfixModifiers.length === 0;

  function renderModifierList(kind: "prefixModifiers" | "postfixModifiers") {
    const modifiers = values[kind];
    if (modifiers.length === 0) {
      return <span className="rp-card__usage-value rp-card__usage-value--empty">なし</span>;
    }
    return (
      <span className="condition-form__modifiers">
        {modifiers.map((modifier, index) => (
          <span className="condition-form__modifier-chip" key={`${modifier.management_number}-${index}`}>
            {modifier.name}
            <button
              type="button"
              aria-label={`${modifier.name} を削除`}
              onClick={() => removeModifier(kind, index)}
            >
              ×
            </button>
          </span>
        ))}
      </span>
    );
  }

  return (
    <form className="prescription-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <fieldset>
        <legend>病名</legend>

        {/* 区分。プロブレム(POMR のプロブレムリストに載る)・既往歴(基礎データ。
            プロブレムリストには載せない)・保険病名(レセプト用)を同じ Condition で
            区分管理する。ラジオの横並びは診療記録フォームと同じ形。 */}
        <div className="clinical-note-form__mode">
          <span className="clinical-note-form__mode-legend">区分</span>
          <div className="clinical-note-form__mode-options">
            {(["billing", "problem", "past"] as const).map((category) => (
              <label className="clinical-note-form__mode-option" key={category}>
                <input
                  type="radio"
                  name="condition-category"
                  checked={values.category === category}
                  onChange={() => update("category", category as ConditionCategory)}
                />
                {CATEGORY_LABELS[category]}
              </label>
            ))}
          </div>
        </div>

        {/* 入力方法。既往歴のように具体的な傷病名が分からない場合はフリー入力を使う
            (レセプトに使うコードは付かないので、保険病名では原則マスタから選ぶ)。 */}
        <div className="clinical-note-form__mode condition-form__input-mode">
          <span className="clinical-note-form__mode-legend">入力方法</span>
          <div className="clinical-note-form__mode-options">
            {(
              [
                ["master", "マスタから選択"],
                ["free", "フリー入力"],
              ] as const
            ).map(([mode, label]) => (
              <label className="clinical-note-form__mode-option" key={mode}>
                <input
                  type="radio"
                  name="condition-disease-mode"
                  checked={values.diseaseMode === mode}
                  onChange={() => selectDiseaseMode(mode)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {values.diseaseMode === "free" ? (
          <div className="condition-form__row">
            <label className="condition-form__free-text">
              病名
              <input
                type="text"
                value={values.freeText}
                maxLength={100}
                placeholder="例: 虫垂炎(詳細不明)"
                onChange={(e) => update("freeText", e.target.value)}
              />
            </label>
          </div>
        ) : (
          <div className="condition-form__row">
            <label>
              病名
              {values.disease ? (
                <span className="rp-card__usage-value">{values.disease.name}</span>
              ) : (
                <span className="rp-card__usage-value rp-card__usage-value--empty">未選択</span>
              )}
            </label>
            <button type="button" onClick={() => setModal({ kind: "disease" })}>
              {values.disease ? "病名を変更" : "病名を選択"}
            </button>
          </div>
        )}

        {/* 修飾語はマスタの病名に付けるものなので、フリー入力では出さない。
            疑い病名は毎回修飾語から選ぶのが手間なので、チェックで接尾語「の疑い」を
            付け外しする。接尾語の一覧にも出るので、モーダルから外しても連動する。 */}
        {values.diseaseMode === "master" && (
          <>
            <div className="condition-form__row">
              <label className="qe-item__checkbox">
                <input
                  type="checkbox"
                  checked={isSuspected(values.postfixModifiers)}
                  onChange={(e) =>
                    update(
                      "postfixModifiers",
                      withSuspected(values.postfixModifiers, e.target.checked),
                    )
                  }
                />
                疑い病名
              </label>
            </div>

            <div className="condition-form__row">
              <label>
                接頭語
                {renderModifierList("prefixModifiers")}
              </label>
              <button type="button" onClick={() => setModal({ kind: "prefix" })}>
                + 接頭語追加
              </button>
            </div>

            <div className="condition-form__row">
              <label>
                接尾語
                {renderModifierList("postfixModifiers")}
              </label>
              <button type="button" onClick={() => setModal({ kind: "postfix" })}>
                + 接尾語追加
              </button>
            </div>
          </>
        )}

        {fullName && (
          <p className="condition-form__preview">
            登録される病名: <strong>{fullName}</strong>
            {values.diseaseMode === "master" && values.disease?.icd10_2013
              ? ` (ICD10: ${values.disease.icd10_2013})`
              : values.diseaseMode === "free" && " (コードなし)"}
          </p>
        )}
        {singleUseWarning && (
          <p className="condition-form__hint">
            この病名は単独での使用が適当でないとされています(修飾語との組合せが望ましい)。
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend>経過</legend>
        <label>
          開始日
          <input
            type="date"
            value={values.startDate}
            onChange={(e) => update("startDate", e.target.value)}
          />
        </label>
        <label>
          終了日
          <input type="date" value={values.endDate} onChange={(e) => update("endDate", e.target.value)} />
        </label>
        <label>
          転帰区分
          <select value={values.outcome} onChange={(e) => update("outcome", e.target.value as OutcomeCode)}>
            {OUTCOME_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {/* プロブレム同士の関連。POMR では症状で立てたプロブレムが 1 つの診断に
          まとまったり(統合)、1 つが複数に分かれたり(分割)、下位のプロブレムが
          ぶら下がったりする。統合と分割は「引き継ぎ先」1 つで表す
          (複数の旧が同じ先を指せば統合、1 つの旧が複数を指せば分割)。 */}
      {values.category === "problem" && (
        <fieldset>
          <legend>プロブレムの関連</legend>
          <label>
            親プロブレム
            <select value={values.parentId} onChange={(e) => update("parentId", e.target.value)}>
              <option value="">(なし)</option>
              {relationOptions.map((problem) => (
                <option key={problem.id} value={problem.id}>
                  {problemLabel(problem)}
                </option>
              ))}
            </select>
          </label>

          <div className="condition-form__row">
            <label>
              引き継ぎ先(統合・分割)
              {values.succeededByIds.length === 0 ? (
                <span className="rp-card__usage-value rp-card__usage-value--empty">なし</span>
              ) : (
                <span className="condition-form__modifiers">
                  {values.succeededByIds.map((id) => (
                    <span className="condition-form__modifier-chip" key={id}>
                      {problemLabelOf(id)}
                      <button
                        type="button"
                        aria-label={`${problemLabelOf(id)} への引き継ぎを外す`}
                        onClick={() => removeSuccessor(id)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </span>
              )}
            </label>
            <select
              value=""
              aria-label="引き継ぎ先を追加"
              onChange={(e) => addSuccessor(e.target.value)}
            >
              <option value="">+ 引き継ぎ先を追加</option>
              {relationOptions
                .filter((p) => p.id && !values.succeededByIds.includes(p.id))
                .map((problem) => (
                  <option key={problem.id} value={problem.id}>
                    {problemLabel(problem)}
                  </option>
                ))}
            </select>
          </div>
        </fieldset>
      )}

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>

      {modal?.kind === "disease" && (
        <DiseaseSearchModal onSelect={handleDiseaseSelect} onClose={() => setModal(null)} />
      )}
      {(modal?.kind === "prefix" || modal?.kind === "postfix") && (
        <ModifierSearchModal
          title={modal.kind === "prefix" ? "接頭語を選択" : "接尾語を選択"}
          onSelect={handleModifierSelect}
          onClose={() => setModal(null)}
        />
      )}
    </form>
  );
}
