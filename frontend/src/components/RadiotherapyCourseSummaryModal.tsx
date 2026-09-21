import { useMemo, useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { radiotherapyStopReasonHooks } from "../api/masterQueries";
import { usePractitionerOptions, useSaveRadiotherapyCourseSummary } from "../api/queries";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { formatDose, summarizeRadiotherapyOrder } from "../fhir/radiotherapyOrderHelpers";
import type { RadiotherapyFractionDisplay } from "../fhir/radiotherapyResultHelpers";
import {
  COURSE_OUTCOME_OPTIONS,
  buildRadiotherapyCourseSummaryBundle,
  draftRadiotherapyCourseSummary,
  validateRadiotherapyCourseSummary,
  type RadiotherapyCourseSummaryFormValues,
} from "../fhir/radiotherapySummaryHelpers";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 治療終了サマリー(docs/radiotherapy-order-design.md §6.2)。
//
// 期間・回数・標的ごとの実照射線量・完遂かどうかは照射記録から数えて入っている(読み取り専用)。
// 医師が書くのは治療経過・急性有害事象・今後の方針の 3 つ。書き直すときは同じ Procedure を
// 更新し、**集計値だけを取り直して本文は残す**。

interface Props {
  order: fhir4.ServiceRequest;
  fractions: RadiotherapyFractionDisplay[];
  /** 既に書いてあるサマリー。渡すと書き直しになる。 */
  existing?: fhir4.Procedure;
  patientName?: string;
  onClose: () => void;
}

export function RadiotherapyCourseSummaryModal({
  order,
  fractions,
  existing,
  patientName,
  onClose,
}: Props) {
  const save = useSaveRadiotherapyCourseSummary();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const { practitioners, error: practitionersError } = usePractitionerOptions();
  const reasons = radiotherapyStopReasonHooks.useOptions({ kind: "terminate" });
  const summary = useMemo(() => summarizeRadiotherapyOrder(order), [order]);

  const [values, setValues] = useState<RadiotherapyCourseSummaryFormValues>(() => {
    const draft = draftRadiotherapyCourseSummary(order, fractions, existing);
    return draft.practitionerId
      ? draft
      : {
          ...draft,
          practitionerId: practitionerId ?? "",
          practitionerName: practitioner ? practitionerDisplayName(practitioner) : draft.practitionerName,
        };
  });
  const [validationError, setValidationError] = useState("");

  const update = makeFieldUpdater(setValues);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateRadiotherapyCourseSummary(values);
    setValidationError(error);
    if (error) return;

    save.mutate(buildRadiotherapyCourseSummaryBundle(values, order, existing), {
      onSuccess: onClose,
    });
  }

  return (
    <Modal
      title={`治療終了サマリー${patientName ? ` - ${patientName}` : ""}`}
      onClose={onClose}
      className="modal--wide"
    >
      <form className="prescription-form" onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={save.error} />
        <ErrorBanner error={practitionersError} />

        {/* 照射記録から数えたもの。直接は直せない(直すなら照射記録を直す)。 */}
        <fieldset>
          <legend>照射実績</legend>
          <dl className="prescription-detail__common">
            <dt>処方</dt>
            <dd>
              第{summary.courseNumber}コース {summary.siteLabel} {summary.doseLabel}
              {summary.intentDisplay && `（${summary.intentDisplay}）`}
            </dd>
            <dt>照射回数</dt>
            <dd>
              {values.fractionsDelivered} / {values.fractionsPrescribed} 回
            </dd>
            <dt>実照射線量</dt>
            <dd>
              {values.doses.length > 0
                ? values.doses
                    .map((dose) => `${dose.label} ${formatDose(dose.dose)} Gy / ${dose.fractions} 回`)
                    .join("、")
                : "-"}
            </dd>
          </dl>
        </fieldset>

        <fieldset>
          <legend>治療期間</legend>
          <label>
            初回照射日 *
            <input
              type="date"
              value={values.startDate}
              onChange={(e) => update("startDate", e.target.value)}
              required
            />
          </label>
          <label>
            最終照射日 *
            <input
              type="date"
              value={values.endDate}
              onChange={(e) => update("endDate", e.target.value)}
              required
            />
          </label>
          <label>
            治療の結末 *
            <select value={values.outcome} onChange={(e) => update("outcome", e.target.value)} required>
              {COURSE_OUTCOME_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            記載医師
            <select
              value={values.practitionerId}
              onChange={(e) => {
                const selected = practitioners.find((p) => p.id === e.target.value);
                setValues((v) => ({
                  ...v,
                  practitionerId: e.target.value,
                  practitionerName: selected ? practitionerDisplayName(selected) : "",
                }));
              }}
            >
              <option value=""></option>
              {practitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {practitionerDisplayName(p)}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        {values.outcome === "discontinued" && (
          <fieldset>
            <legend>中止</legend>
            <label>
              理由 *
              <select
                value={values.terminationReason.code}
                onChange={(e) => {
                  const reason = reasons.items.find((r) => r.code === e.target.value);
                  update("terminationReason", {
                    code: e.target.value,
                    name: reason?.name ?? values.terminationReason.name,
                  });
                }}
              >
                {/* 中止の操作で入れた理由はコードを持たないことがあるので、そのまま残す。 */}
                <option value="">
                  {values.terminationReason.code ? "選択してください" : values.terminationReason.name || "選択してください"}
                </option>
                {reasons.items.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              補足
              <input
                type="text"
                value={values.terminationNote}
                onChange={(e) => update("terminationNote", e.target.value)}
              />
            </label>
          </fieldset>
        )}

        <fieldset>
          <legend>記載</legend>
          <label className="radiotherapy-summary__text">
            治療経過
            <textarea
              rows={3}
              value={values.progressNote}
              onChange={(e) => update("progressNote", e.target.value)}
            />
          </label>
          <label className="radiotherapy-summary__text">
            急性有害事象
            <textarea
              rows={3}
              value={values.adverseEvents}
              onChange={(e) => update("adverseEvents", e.target.value)}
            />
          </label>
          <label className="radiotherapy-summary__text">
            今後の方針
            <textarea
              rows={3}
              value={values.followUpPlan}
              onChange={(e) => update("followUpPlan", e.target.value)}
            />
          </label>
        </fieldset>

        <div className="prescription-form__actions">
          <button type="submit" disabled={save.isPending}>
            {save.isPending ? "保存中..." : existing ? "更新" : "登録"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
