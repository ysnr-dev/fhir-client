import { useState } from "react";
import { useClosePathway, usePathwayApplicationTree, usePathwayApplyGoal } from "../api/queries";
import {
  CLOSING_TYPE_OPTIONS,
  buildPathwayCloseBundle,
  buildPathwayReopenBundle,
  closingTypeLabel,
  pathwayCloseValuesOf,
  type PathwayClosingType,
} from "../fhir/pathwayCloseHelpers";
import { pathwayStatusLabel } from "../fhir/pathwaySheetHelpers";
import { useValidationError } from "../hooks/useValidationError";
import { ErrorBanner } from "./ErrorBanner";

// パスの終了・中止。パスシートの見出しから開き、適用の CarePlan と Goal を 1 回で書く。
// 終わったパスを開くと記録した内容が出て、「進行中に戻す」で取り消せる。
// 設計は docs/clinical-pathway-design.md §7.5。

interface PathwayClosePanelProps {
  patientId: string;
  applyId: string;
  onSaved: () => void;
}

export function PathwayClosePanel({ patientId, applyId, onSaved }: PathwayClosePanelProps) {
  const tree = usePathwayApplicationTree(applyId);
  const apply = tree.data?.carePlans.get(applyId);
  const applyIdentifier = tree.data?.application?.applyId ?? "";
  const goal = usePathwayApplyGoal(applyIdentifier || undefined);
  const close = useClosePathway();
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [values, setValues] = useState(() => pathwayCloseValuesOf(undefined, undefined));
  // 保存済みの値は読み終えてから 1 度だけ入れる(入力中の値を後から上書きしない)。
  const [loaded, setLoaded] = useState(false);
  if (!loaded && apply && !goal.isPending) {
    setValues(pathwayCloseValuesOf(apply, goal.data ?? undefined));
    setLoaded(true);
  }

  if (tree.isPending) return <p>読み込み中...</p>;
  if (tree.error || !apply || !tree.data?.application) return <ErrorBanner error={tree.error} />;
  const application = tree.data.application;
  const closed = apply.status === "completed" || apply.status === "revoked";

  function handleSave() {
    if (!apply) return;
    if (!values.endDate) {
      setValidationError("終了日を入力してください");
      return;
    }
    if (values.closing === "2" && !values.reason.trim()) {
      setValidationError("中止の理由を入力してください");
      return;
    }
    setValidationError(null);
    const bundle = buildPathwayCloseBundle(
      { patientId, apply, applyId: applyIdentifier, goal: goal.data ?? undefined },
      values,
    );
    close.mutate(bundle, { onSuccess: onSaved });
  }

  function handleReopen() {
    if (!apply) return;
    setValidationError(null);
    const bundle = buildPathwayReopenBundle({
      patientId,
      apply,
      applyId: applyIdentifier,
      goal: goal.data ?? undefined,
    });
    close.mutate(bundle, { onSuccess: onSaved });
  }

  return (
    <div className="pathway-evaluate">
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={close.error ?? goal.error} />

      <div className="chemo-calendar__summary pathway-evaluate__head">
        <span className="pathway-sheet__name">{application.title}</span>
        <span>入院 {application.periodStart}</span>
        <span className={`regimen-status regimen-status--${apply.status === "active" ? "approved" : "retired"}`}>
          {pathwayStatusLabel(apply.status)}
        </span>
      </div>

      <fieldset className="regimen-apply__fields">
        <legend>区分</legend>
        <div className="pathway-evaluate__achievement" role="radiogroup" aria-label="終了区分">
          {CLOSING_TYPE_OPTIONS.map((option) => (
            <label key={option.code} className="pathway-apply__check">
              <input
                type="radio"
                name="pathway-closing"
                value={option.code}
                checked={values.closing === option.code}
                onChange={() => setValues((v) => ({ ...v, closing: option.code as PathwayClosingType }))}
              />
              {option.display}
              <span className="order-select__muted">{option.note}</span>
            </label>
          ))}
        </div>
        <div className="lab-order-item__fields">
          <label>
            終了日
            <input
              type="date"
              value={values.endDate}
              onChange={(e) => setValues((v) => ({ ...v, endDate: e.target.value }))}
            />
          </label>
        </div>
      </fieldset>

      {values.closing === "2" && (
        <fieldset className="regimen-apply__fields">
          <legend>中止理由</legend>
          <textarea
            rows={2}
            value={values.reason}
            onChange={(e) => setValues((v) => ({ ...v, reason: e.target.value }))}
          />
        </fieldset>
      )}

      <fieldset className="regimen-apply__fields">
        <legend>総合評価</legend>
        <textarea
          rows={3}
          value={values.comment}
          onChange={(e) => setValues((v) => ({ ...v, comment: e.target.value }))}
        />
      </fieldset>

      <div className="lab-order-item__actions">
        <button type="button" onClick={handleSave} disabled={close.isPending}>
          {close.isPending ? "保存中..." : closed ? "記録し直す" : `${closingTypeLabel(values.closing)}にする`}
        </button>
        {closed && (
          <button type="button" onClick={handleReopen} disabled={close.isPending}>
            進行中に戻す
          </button>
        )}
      </div>
    </div>
  );
}
