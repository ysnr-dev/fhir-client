import { useMemo, useState } from "react";
import {
  useActiveAllergies,
  useCompleteRxVerification,
  useOrderEnterer,
  useOrderRxVerification,
  usePrescriptionDetail,
} from "../api/queries";
import { usePharmacistInterventionTypes } from "../api/masterQueries";
import { summarizeAllergy } from "../fhir/allergyHelpers";
import { INJECTION_TASK_CODE } from "../fhir/injectionTaskHelpers";
import { hasTaskCode } from "../fhir/notificationHelpers";
import { injectionLineDose, parseInjectionForm } from "../fhir/injectionHelpers";
import { displayName } from "../fhir/patientHelpers";
import { dateTimeLabel } from "../lib/dates";
import { parsePrescriptionForm, prescriptionLineDose, splitPrescriptionDetailBundle } from "../fhir/prescriptionHelpers";
import {
  isRxVerificationTask,
  RX_INTERVENTION_OUTCOME_OPTIONS,
  RX_VERIFICATION_RESULT_OPTIONS,
  interventionOutcomeDisplay,
  rxVerificationResultLabel,
  rxVerificationOrderId,
  rxVerificationResultOf,
  rxVerificationStateOf,
  rxVerificationSummaryOf,
  type RxInterventionOutcome,
  type RxVerificationResultCode,
} from "../fhir/rxVerificationHelpers";
import type { CheckedRp } from "../fhir/drugCheckHelpers";
import { AdvisoryNotice } from "./AdvisoryNotice";
import { ErrorBanner } from "./ErrorBanner";
import { InjectionDetailPanel } from "./InjectionDetailPanel";
import { usePatientFactors, useMedicationAdvisories } from "./MedicineWarnings";
import { Modal } from "./Modal";
import { PrescriptionDetailPanel } from "./PrescriptionDetailPanel";
import { OrderRxInquiryNotes } from "./RxInquiryHistory";

// 処方監査(docs/rx-verification-design.md §3.2)。処方・注射の内容と患者の状態(アレルギー・腎機能)、
// 登録時と同じ薬剤の警告を並べ、監査結果と介入(プレアボイド)を記録して監査済にする。
// 監査済のものを開き直すと結果を上書きできる。

export function RxVerificationModal({
  task,
  patient,
  onInquire,
  onClose,
}: {
  task: fhir4.Task;
  patient?: fhir4.Patient;
  /** 疑義照会を開く(このモーダルを閉じてから一覧が開く)。 */
  onInquire?: () => void;
  onClose: () => void;
}) {
  const orderId = rxVerificationOrderId(task);
  const detail = usePrescriptionDetail(orderId);
  const { serviceRequest, medicationRequests, tasks } = detail.data
    ? splitPrescriptionDetailBundle(detail.data.data)
    : { serviceRequest: undefined, medicationRequests: [], tasks: [] };
  // 一覧を開いたままの間に編集されていれば、詳細で読み直した版を書き換える。
  const current = tasks.find((t) => isRxVerificationTask(t) && t.id === task.id) ?? task;
  const summary = rxVerificationSummaryOf(current);
  const patientId = task.for?.reference?.split("/").pop() ?? "";

  const saved = rxVerificationResultOf(current);
  const [result, setResult] = useState<RxVerificationResultCode>(saved?.result ?? "no-issue");
  const [types, setTypes] = useState<Set<string>>(new Set(saved?.types.map((t) => t.code) ?? []));
  const [content, setContent] = useState(saved?.content ?? "");
  const [outcome, setOutcome] = useState<RxInterventionOutcome | "">(saved?.outcome ?? "");
  const [missingType, setMissingType] = useState(false);

  const typeOptions = usePharmacistInterventionTypes();
  const enterer = useOrderEnterer();
  const complete = useCompleteRxVerification();

  const checkedRps = useMemo<CheckedRp[]>(() => {
    if (!serviceRequest) return [];
    if (summary.kind === "injection") {
      return parseInjectionForm(serviceRequest, medicationRequests).rps.map((rp) => ({
        medicines: rp.medicines.map((m) => ({ medicine: m.medicine, dose: injectionLineDose(rp, m) })),
      }));
    }
    return parsePrescriptionForm(serviceRequest, medicationRequests).rps.map((rp) => ({
      medicines: rp.medicines.map((m) => ({ medicine: m.medicine, dose: prescriptionLineDose(rp, m) })),
    }));
  }, [serviceRequest, medicationRequests, summary.kind]);
  const advisories = useMedicationAdvisories({
    patientId: serviceRequest ? patientId : "",
    startDate: summary.orderDate,
    rps: checkedRps,
    excludeOrderId: orderId,
  });

  function toggleType(code: string) {
    setMissingType(false);
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function handleSave() {
    if (!enterer) return;
    const chosen = typeOptions.filter((option) => types.has(option.code));
    if (result === "intervened" && chosen.length === 0) {
      setMissingType(true);
      return;
    }
    complete.mutate(
      {
        task: current,
        actor: { practitionerId: enterer.practitionerId, display: enterer.display },
        result: {
          result,
          types: chosen.map((option) => ({ code: option.code, name: option.name })),
          content,
          outcome: outcome || undefined,
        },
      },
      { onSuccess: onClose },
    );
  }

  const meta = [
    patient ? `${patient.identifier?.[0]?.value ?? "-"} ${displayName(patient)}` : "",
    summary.periodLabel,
    current.status === "completed" && summary.verifierName ? `監査 ${summary.verifierName}` : "",
  ].filter(Boolean);

  return (
    <Modal title={summary.kind === "injection" ? "注射の監査" : "処方の監査"} onClose={onClose} className="modal--wide">
      <div className="rx-verification">
        <ErrorBanner error={detail.error ?? complete.error} />
        {!enterer && (
          <p className="error-banner__line error-banner__line--error">
            医療従事者として登録されたアカウントでログインしてください。
          </p>
        )}
        {meta.length > 0 && <p className="lab-order-view__meta">{meta.join(" | ")}</p>}

        <PatientState patientId={patientId} />
        <AdvisoryNotice advisories={advisories} />

        {detail.isLoading ? (
          <p>読み込み中...</p>
        ) : serviceRequest ? (
          summary.kind === "injection" ? (
            <InjectionDetailPanel
              serviceRequest={serviceRequest}
              medicationRequests={medicationRequests}
              task={tasks.find((t) => hasTaskCode(t, INJECTION_TASK_CODE.code))}
            />
          ) : (
            <PrescriptionDetailPanel serviceRequest={serviceRequest} medicationRequests={medicationRequests} />
          )
        ) : (
          !detail.error && <p className="karte-card__empty">オーダーが見つかりません。</p>
        )}
        <OrderRxInquiryNotes orderId={orderId} />

        <fieldset className="rx-verification__result">
          <legend>監査結果</legend>
          <div className="rx-inquiry-form__choices">
            {RX_VERIFICATION_RESULT_OPTIONS.map((option) => (
              <label key={option.code} className="rx-verification__choice">
                <input
                  type="radio"
                  name="rx-verification-result"
                  checked={result === option.code}
                  onChange={() => setResult(option.code)}
                />
                {option.display}
              </label>
            ))}
          </div>
          {result === "intervened" && (
            <>
              <div className="rx-verification__field">
                <span>介入種別</span>
                <div className="rx-inquiry-form__choices">
                  {typeOptions.map((option) => (
                    <label key={option.code} className="rx-verification__choice">
                      <input type="checkbox" checked={types.has(option.code)} onChange={() => toggleType(option.code)} />
                      {option.name}
                    </label>
                  ))}
                </div>
                {missingType && (
                  <p className="error-banner__line error-banner__line--error">介入種別を選んでください。</p>
                )}
              </div>
              <label className="rx-verification__field">
                介入内容
                <textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} />
              </label>
              <label className="rx-verification__field">
                処方医の対応
                <select value={outcome} onChange={(e) => setOutcome(e.target.value as RxInterventionOutcome | "")}>
                  <option value="">未定</option>
                  {RX_INTERVENTION_OUTCOME_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.display}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </fieldset>

        <div className="rx-inquiry-form__actions">
          <button type="button" onClick={handleSave} disabled={!enterer || !serviceRequest || complete.isPending}>
            監査済
          </button>
          {onInquire && (
            <button type="button" onClick={onInquire}>
              疑義照会
            </button>
          )}
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 監査で見る患者の状態(アレルギー・年齢・体重・腎機能)。 */
function PatientState({ patientId }: { patientId: string }) {
  const { allergies } = useActiveAllergies(patientId || undefined);
  const factors = usePatientFactors(patientId);
  const allergyNames = allergies
    .map(summarizeAllergy)
    .map((a) => (a.criticalityLabel ? `${a.name}(${a.criticalityLabel})` : a.name))
    .filter(Boolean);
  const body = [
    factors.age != null ? `${factors.age} 歳` : "",
    factors.weight ? `体重 ${factors.weight.value} kg(${factors.weight.date})` : "",
    factors.egfr != null ? `eGFR ${factors.egfr}` : "",
    factors.ccr != null ? `CCr ${factors.ccr} mL/min` : "",
  ].filter(Boolean);
  return (
    <dl className="rx-verification__patient">
      <dt>アレルギー</dt>
      <dd>{allergyNames.length > 0 ? allergyNames.join("・") : "登録なし"}</dd>
      <dt>身体・腎機能</dt>
      <dd>{body.length > 0 ? body.join(" / ") : "-"}</dd>
    </dl>
  );
}

/** 処方一覧・注射一覧のステータスの隣に出す監査の印。監査 Task の無いオーダーには出さない。 */
export function RxVerificationMark({ task }: { task: fhir4.Task | undefined }) {
  const state = rxVerificationStateOf(task);
  if (!state) return null;
  return state === "verified" ? (
    <span className="rx-verification__mark">監査済</span>
  ) : (
    <span className="rx-verification__mark rx-verification__mark--pending">未監査</span>
  );
}

/**
 * カルテの詳細(処方・注射)に出す処方監査。監査済なら監査者・日時・結果・介入、未監査ならその旨。
 * 監査 Task の無いオーダー(院外・持参・導入前の登録)では何も出さない。
 */
export function RxVerificationSection({ order }: { order: fhir4.ServiceRequest }) {
  const query = useOrderRxVerification(order);
  const task = query.data;
  if (!task) return null;
  const summary = rxVerificationSummaryOf(task);
  const result = rxVerificationResultOf(task);
  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>処方監査</legend>
        {result ? (
          <dl className="prescription-detail__common">
            <dt>監査</dt>
            <dd>{[summary.verifierName, dateTimeLabel(summary.verifiedAt)].filter(Boolean).join(" ") || "-"}</dd>
            <dt>監査結果</dt>
            <dd>{rxVerificationResultLabel(result)}</dd>
            {result.content && (
              <>
                <dt>介入内容</dt>
                <dd>{result.content}</dd>
              </>
            )}
            {result.outcome && (
              <>
                <dt>処方医の対応</dt>
                <dd>{interventionOutcomeDisplay(result.outcome)}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="karte-card__empty">{summary.reverify ? "未監査(処方の変更後)" : "未監査"}</p>
        )}
      </fieldset>
    </div>
  );
}
