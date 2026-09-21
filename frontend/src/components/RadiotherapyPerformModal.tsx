import { useMemo, useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { radiotherapyDeviceHooks } from "../api/masterQueries";
import {
  usePractitionerOptions,
  useRadiotherapyOrderDetail,
  useRegisterRadiotherapyFraction,
} from "../api/queries";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { formatDose, summarizeRadiotherapyOrder } from "../fhir/radiotherapyOrderHelpers";
import {
  IMAGE_GUIDANCE_OPTIONS,
  buildRadiotherapyFractionBundle,
  nextRadiotherapyFractionForm,
  radiotherapyFractionFormFromPlanned,
  radiotherapyFractionsByOrderId,
  radiotherapyProgress,
  switchRadiotherapyFractionPhase,
  validateRadiotherapyFractionForm,
  type RadiotherapyFractionDisplay,
  type RadiotherapyFractionFormValues,
} from "../fhir/radiotherapyResultHelpers";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 照射入力(1 回ぶんの照射記録。docs/radiotherapy-order-design.md §6.1)。
//
// 何回目・どの Phase・どの標的に何 Gy かは処方と実施済みの件数から決まるので、開いた時点で
// 入っている。技師は日付と時刻、実施者、位置照合を確かめて登録する。
//
// **進捗 Task は動かさない。** 治療コースは治療中のまま照射が積み上がり、終わりは部門一覧の
// 「終了」が決める(§4)。
//
// **ここは実施したときだけ使う。** 照射しなかった回(体調不良・休診など)は、カレンダーの予定の
// カードの「この回を中止」で記録する — 実施の入力に「しなかった」の入口を混ぜない(§6.1)。

interface Props {
  order: fhir4.ServiceRequest;
  /** そのオーダーの照射記録(新しい順)。回数と累積線量の既定値に使う。 */
  fractions: RadiotherapyFractionDisplay[];
  /** カレンダーの予定から開いたときの、その予定の Procedure.id。無ければいちばん早い予定か次の回。 */
  plannedId?: string;
  patientName?: string;
  onClose: () => void;
}

export function RadiotherapyPerformModal({
  order,
  fractions,
  plannedId,
  patientName,
  onClose,
}: Props) {
  const register = useRegisterRadiotherapyFraction();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const { practitioners, error: practitionersError } = usePractitionerOptions();
  const devices = radiotherapyDeviceHooks.useOptions();

  const summary = useMemo(() => summarizeRadiotherapyOrder(order), [order]);
  const progress = useMemo(() => radiotherapyProgress(summary, fractions), [summary, fractions]);

  const [values, setValues] = useState<RadiotherapyFractionFormValues>(() => {
    const planned = fractions.find((fraction) => fraction.planned && fraction.id === plannedId);
    return {
      ...(planned
        ? radiotherapyFractionFormFromPlanned(summary, planned)
        : nextRadiotherapyFractionForm(summary, fractions)),
      performerId: practitionerId ?? "",
      performerName: practitioner ? practitionerDisplayName(practitioner) : "",
    };
  });
  const [validationError, setValidationError] = useState("");

  const update = makeFieldUpdater(setValues);
  const phase = summary.phases.find((p) => p.phaseId === values.phaseId);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateRadiotherapyFractionForm(values);
    setValidationError(error);
    if (error) return;

    register.mutate(buildRadiotherapyFractionBundle(values, order), { onSuccess: onClose });
  }

  return (
    <Modal
      title={`照射入力${patientName ? ` - ${patientName}` : ""}`}
      onClose={onClose}
      className="modal--wide"
    >
      <form className="prescription-form" onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={register.error} />
        <ErrorBanner error={practitionersError} />

        <fieldset>
          <legend>治療コース</legend>
          <dl className="prescription-detail__common">
            <dt>処方</dt>
            <dd>
              第{summary.courseNumber}コース {summary.siteLabel} {summary.doseLabel}
            </dd>
            <dt>これまで</dt>
            <dd>
              {progress.fractionLabel}
              {progress.volumes.length > 0 &&
                `（${progress.volumes.map((v) => `${v.label} ${v.doseLabel}`).join("、")}）`}
            </dd>
          </dl>
        </fieldset>

        <fieldset>
          <legend>照射</legend>
          <label>
            照射日 *
            <input
              type="date"
              value={values.performedDate}
              onChange={(e) => update("performedDate", e.target.value)}
              required
            />
          </label>
          <label>
            開始時刻
            <input
              type="time"
              value={values.startTime}
              onChange={(e) => update("startTime", e.target.value)}
            />
          </label>
          <label>
            終了時刻
            <input
              type="time"
              value={values.endTime}
              onChange={(e) => update("endTime", e.target.value)}
            />
          </label>
          <label>
            Phase *
            <select
              value={values.phaseId}
              onChange={(e) =>
                setValues((v) => switchRadiotherapyFractionPhase(v, summary, fractions, e.target.value))
              }
              required
            >
              {summary.phases.map((p) => (
                <option key={p.phaseId} value={p.phaseId}>
                  {p.label}
                  {p.status === "revoked" ? "（中止）" : ` ${p.methodLabel}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            何回目 *
            <input
              type="number"
              min={1}
              step={1}
              value={values.fractionNumber}
              onChange={(e) => update("fractionNumber", e.target.value)}
              required
            />
          </label>
          <label>
            使用装置
            <select
              value={values.device.code}
              onChange={(e) => {
                const device = devices.items.find((d) => d.code === e.target.value);
                update("device", { code: e.target.value, name: device?.name ?? "" });
              }}
            >
              <option value=""></option>
              {devices.items.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            位置照合
            <select
              value={values.imageGuidance}
              onChange={(e) => update("imageGuidance", e.target.value)}
            >
              <option value=""></option>
              {IMAGE_GUIDANCE_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            実施者 *
            <select
              value={values.performerId}
              onChange={(e) => {
                const selected = practitioners.find((p) => p.id === e.target.value);
                setValues((v) => ({
                  ...v,
                  performerId: e.target.value,
                  performerName: selected ? practitionerDisplayName(selected) : "",
                }));
              }}
              required
            >
              <option value="">選択してください</option>
              {practitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {practitionerDisplayName(p)}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>実照射線量 *</legend>
          <table className="master-search__table radiotherapy-order__doses">
            <thead>
              <tr>
                <th>標的</th>
                <th>処方(1回)</th>
                <th>実照射線量(Gy)</th>
              </tr>
            </thead>
            <tbody>
              {summary.volumes.map((volume) => {
                const prescribed = phase?.doses.find((d) => d.volumeId === volume.volumeId);
                return (
                  <tr key={volume.volumeId}>
                    <td>{volume.label}</td>
                    <td>{prescribed ? `${formatDose(prescribed.fractionDose)} Gy` : "-"}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={values.doses[volume.volumeId] ?? ""}
                        aria-label={`${volume.label} の実照射線量`}
                        onChange={(e) =>
                          update("doses", { ...values.doses, [volume.volumeId]: e.target.value })
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </fieldset>

        <fieldset>
          <legend>備考</legend>
          <label>
            コメント
            <input type="text" value={values.note} onChange={(e) => update("note", e.target.value)} />
          </label>
        </fieldset>

        <div className="prescription-form__actions">
          <button type="submit" disabled={register.isPending}>
            {register.isPending ? "保存中..." : "登録"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * 照射記録を自分で引く版。クリニカルパスのように、そのコースの照射記録を手元に持っていない
 * ところから開くときに使う(部門の一覧は一覧ぶんをまとめて引いてあるので props で渡す)。
 */
export function RadiotherapyPerformModalByOrder({
  order,
  patientName,
  onClose,
}: {
  order: fhir4.ServiceRequest;
  patientName?: string;
  onClose: () => void;
}) {
  const detail = useRadiotherapyOrderDetail(order.id);
  const fractions = useMemo(() => {
    const procedures = (detail.data?.data.entry ?? [])
      .map((entry) => entry.resource)
      .filter((resource): resource is fhir4.Procedure => resource?.resourceType === "Procedure");
    return radiotherapyFractionsByOrderId(procedures).get(order.id ?? "") ?? [];
  }, [detail.data, order.id]);

  if (detail.isLoading) {
    return (
      <Modal title="照射入力" onClose={onClose}>
        <ErrorBanner error={detail.error} />
        {!detail.error && <p>読み込み中...</p>}
      </Modal>
    );
  }

  return (
    <RadiotherapyPerformModal
      order={order}
      fractions={fractions}
      patientName={patientName}
      onClose={onClose}
    />
  );
}

