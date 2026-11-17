import { useState } from "react";
import { useDeleteHaiJudgment, useOrderEnterer, useSaveHaiJudgment } from "../api/queries";
import {
  HAI_RESULT_OPTIONS,
  HAI_TYPE_LABELS,
  SSI_DEPTH_OPTIONS,
  buildHaiJudgmentBundle,
  emptyHaiJudgmentValues,
  haiJudgmentValuesOf,
  validateHaiJudgment,
  type HaiJudgment,
  type HaiJudgmentTarget,
  type HaiResult,
  type SsiDepth,
} from "../fhir/haiSurveillanceHelpers";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { TrashIcon } from "./icons/TrashIcon";
import { Modal } from "./Modal";

interface HaiJudgmentModalProps {
  target: HaiJudgmentTarget;
  /** 対象の見出し(患者・術式や留置の種別など)。 */
  summary: string[];
  /** 対象の始まりの日(手術日・挿入日)。これより前の診断日は受け付けない。 */
  startDay: string;
  judgment?: HaiJudgment;
  /** 起因菌の候補(術後の培養陽性の菌名)。 */
  pathogenOptions?: string[];
  onClose: () => void;
}

/**
 * 医療関連感染の判定(docs/hai-surveillance-design.md §3)。手術部位感染は手術の実施記録、
 * デバイス関連感染は留置を対象に、感染の有無・診断日・起因菌を 1 件の Observation で残す。
 */
export function HaiJudgmentModal({ target, summary, startDay, judgment, pathogenOptions, onClose }: HaiJudgmentModalProps) {
  const save = useSaveHaiJudgment();
  const remove = useDeleteHaiJudgment();
  const enterer = useOrderEnterer();
  const todayValue = today();
  const [values, setValues] = useState(() =>
    judgment ? haiJudgmentValuesOf(judgment) : emptyHaiJudgmentValues(todayValue),
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const infected = values.result === "infected";
  const pending = save.isPending || remove.isPending;
  const listId = `hai-pathogens-${target.procedureId}`;

  function handleSubmit() {
    const message = validateHaiJudgment(values, target.type, startDay, todayValue);
    setValidationError(message);
    if (message) return;
    const performer = enterer
      ? { reference: `Practitioner/${enterer.practitionerId}`, ...(enterer.display ? { display: enterer.display } : {}) }
      : undefined;
    save.mutate(buildHaiJudgmentBundle(values, target, performer, judgment), { onSuccess: onClose });
  }

  function handleDelete() {
    if (!judgment || !window.confirm("この判定を削除しますか？")) return;
    remove.mutate(judgment.id, { onSuccess: onClose });
  }

  return (
    <Modal
      title={`${HAI_TYPE_LABELS[target.type]}の判定`}
      onClose={onClose}
      titleAction={
        judgment && (
          <button
            type="button"
            className="rp-card__icon-button"
            title="判定を削除"
            aria-label="判定を削除"
            onClick={handleDelete}
            disabled={pending}
          >
            <TrashIcon />
          </button>
        )
      }
    >
      <ErrorBanner error={save.error} />
      <ErrorBanner error={remove.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <div className="walk-in">
        <div className="walk-in__patient">
          {summary.filter(Boolean).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>

        <div className="walk-in__fields">
          <label>
            判定
            <select
              value={values.result}
              onChange={(e) => setValues({ ...values, result: e.target.value as HaiResult | "" })}
            >
              <option value=""></option>
              {HAI_RESULT_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            {infected ? "診断日" : "判定日"}
            <input
              type="date"
              value={values.date}
              min={startDay || undefined}
              max={todayValue}
              onChange={(e) => setValues({ ...values, date: e.target.value })}
            />
          </label>
          {target.type === "ssi" && infected && (
            <label>
              感染部位
              <select
                value={values.depth}
                onChange={(e) => setValues({ ...values, depth: e.target.value as SsiDepth | "" })}
              >
                <option value=""></option>
                {SSI_DEPTH_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
          )}
          {target.type === "ssi" && (
            <label className="admission__undated">
              <input
                type="checkbox"
                checked={values.implant}
                onChange={(e) => setValues({ ...values, implant: e.target.checked })}
              />
              埋入物
            </label>
          )}
          {infected && (
            <label>
              起因菌
              <input
                type="text"
                list={listId}
                value={values.pathogen}
                onChange={(e) => setValues({ ...values, pathogen: e.target.value })}
              />
              <datalist id={listId}>
                {(pathogenOptions ?? []).map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
          )}
          <label className="admission__note">
            コメント
            <input type="text" value={values.note} onChange={(e) => setValues({ ...values, note: e.target.value })} />
          </label>
        </div>

        <div className="walk-in__actions">
          <button type="button" onClick={handleSubmit} disabled={pending}>
            {judgment ? "更新" : "登録"}
          </button>
          <button type="button" onClick={onClose} disabled={pending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
