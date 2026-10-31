import { useState } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useRegimen } from "../api/masterQueries";
import {
  useBodyMeasures,
  useOrderEnterer,
  usePatient,
  usePractitionerRoles,
  useRecentLabResults,
  useSaveRegimenDecision,
} from "../api/queries";
import { summarizeBodyMeasures, summarizeRenal } from "../fhir/bodyMeasureHelpers";
import { calculateAge } from "../fhir/patientHelpers";
import { baseRoleOf, isDoctorRoleCode, parsePractitionerRole } from "../fhir/practitionerRoleHelpers";
import { checkLabCriteria, summarizeLabChecks } from "../fhir/regimenCheckHelpers";
import {
  REGIMEN_DECISION_LABELS,
  regimenDecisionOf,
  type RegimenDecision,
  type RegimenDecisionState,
} from "../fhir/regimenDecisionHelpers";
import type { RegimenApplication, RegimenDayOrder } from "../fhir/regimenOrderHelpers";
import { dateTimeLabel, localDay } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { RegimenLabCheck } from "./RegimenPreCheck";

// 化学療法の当日の投与可否確認(docs/chemo-regimen-design.md §8.18)。
//   RegimenDecisionMark   … 一覧・暦に出す「実施可 / 要再確認 / 未確認」の印
//   RegimenHeldMark       … 適用が休止中の日オーダーに出す「休止中」の印(§7.6 A-8)
//   RegimenDecisionFields … 投与日パネルの確認欄(投与前チェックと「実施可」「取消」)

function decisionTitle(decision: RegimenDecision): string | undefined {
  if (decision.state === "pending") return undefined;
  const head = `${dateTimeLabel(decision.decidedAt)} ${decision.decidedBy}`.trim();
  const tail = decision.state === "stale" ? "(確認後にオーダーが変更されました)" : "";
  return [head + tail, decision.comment].filter(Boolean).join("\n");
}

/** 投与可否の印。実施済・中止のオーダーでは出さない(確認の要らない状態)。 */
export function RegimenDecisionMark({
  task,
  order,
  status,
}: {
  task: fhir4.Task | undefined;
  order: fhir4.ServiceRequest;
  status: string;
}) {
  if (status === "completed" || status === "cancelled") return null;
  const decision = regimenDecisionOf(task, order);
  return (
    <span className={`regimen-decision__mark regimen-decision__mark--${decision.state}`} title={decisionTitle(decision)}>
      {REGIMEN_DECISION_LABELS[decision.state]}
    </span>
  );
}

/**
 * 適用が休止中であることの印(§7.6 A-8)。休止中の日オーダーは投与しないので、投与可否の印より優先して出す。
 * status を渡したときは、実施済・中止のオーダーでは出さない。
 */
export function RegimenHeldMark({ held, status }: { held: boolean; status?: string }) {
  if (!held || status === "completed" || status === "cancelled") return null;
  return (
    <span className="regimen-decision__mark regimen-decision__mark--held" title="レジメンが休止中です">
      休止中
    </span>
  );
}

/** 複数の日オーダーの状態をまとめる。1 件でも未確認・要再確認があればそれを出す。 */
function combinedState(decisions: RegimenDecision[]): RegimenDecisionState {
  if (decisions.some((d) => d.state === "stale")) return "stale";
  if (decisions.some((d) => d.state === "pending")) return "pending";
  return "go";
}

function useIsDoctor(): boolean {
  const { practitionerId } = useCurrentPractitioner();
  const roles = usePractitionerRoles(practitionerId ?? undefined);
  const base = baseRoleOf(roles.roles);
  return isDoctorRoleCode(base ? parsePractitionerRole(base).roleCode : undefined);
}

/**
 * 投与日パネルの「投与可否」。その日の検査値で投与前チェックを出し直し、医師が「実施可」を
 * 記録する。基準外でも止めない(投与前チェックと同じ。§8.3)が、確かめてから記録させる。
 * 記録できるのは医師だけで、他の職種には状態だけ見せる。
 */
export function RegimenDecisionFields({
  patientId,
  application,
  date,
  todays,
}: {
  patientId: string;
  application: RegimenApplication;
  date: string;
  todays: RegimenDayOrder[];
}) {
  const master = useRegimen(application.code || null);
  const labResults = useRecentLabResults(patientId);
  const body = useBodyMeasures(patientId);
  const patient = usePatient(patientId).data?.data;
  const enterer = useOrderEnterer();
  const isDoctor = useIsDoctor();
  const save = useSaveRegimenDecision();
  const [comment, setComment] = useState("");

  const targets = todays.filter((o) => o.status !== "completed" && o.status !== "cancelled");
  if (targets.length === 0) return null;

  const decisions = targets.map((o) => regimenDecisionOf(o.decision, o.serviceRequest));
  const state = combinedState(decisions);
  const decided = decisions.find((d) => d.state !== "pending");
  const withdrawable = targets.filter((o) => o.decision?.status === "completed");

  // 投与日より後の結果では判定しない(過去の投与日を開いたときに、後から出た値で見ないため)。
  const observations = labResults.observations.filter((o) => {
    const day = localDay(o.effectiveDateTime);
    return !day || day <= date;
  });
  const measures = summarizeBodyMeasures(body.observations);
  const renal = summarizeRenal(observations, {
    age: patient?.birthDate ? calculateAge(patient.birthDate) : undefined,
    gender: patient?.gender,
    weight: measures.weight?.value ?? application.weight,
  });
  const checks = checkLabCriteria(
    master.data?.lab_criteria ?? [],
    observations,
    {
      ccr: renal.ccr,
      egfr: renal.egfr,
      date: renal.creatinine?.date ?? "",
      unavailable: renal.ccrUnavailable || renal.egfrUnavailable || "クレアチニンの結果がありません",
    },
    date,
  );
  const summary = summarizeLabChecks(checks);

  function handleGo() {
    if (!enterer) return;
    if (summary.out > 0 && !window.confirm(`基準外の検査値が ${summary.out} 件あります。実施可にしますか？`)) return;
    save.mutate(
      {
        targets,
        action: "go",
        actor: { practitionerId: enterer.practitionerId, display: enterer.display },
        comment,
        checks,
      },
      { onSuccess: () => setComment("") },
    );
  }

  function handleWithdraw() {
    if (!enterer || withdrawable.length === 0) return;
    if (!window.confirm("実施可を取り消します。よろしいですか？")) return;
    save.mutate({
      targets: withdrawable,
      action: "withdraw",
      actor: { practitionerId: enterer.practitionerId, display: enterer.display },
    });
  }

  return (
    <fieldset className="regimen-day__booking-fields regimen-decision">
      <legend>投与可否</legend>
      <ErrorBanner error={save.error ?? master.error} />
      <div className="regimen-decision__status">
        <span className={`regimen-decision__mark regimen-decision__mark--${state}`}>
          {REGIMEN_DECISION_LABELS[state]}
        </span>
        {decided && (
          <span className="regimen-decision__by">{`${dateTimeLabel(decided.decidedAt)} ${decided.decidedBy}`}</span>
        )}
        {decided?.comment && <span className="regimen-decision__comment">{decided.comment}</span>}
      </div>
      <RegimenLabCheck checks={checks} summary={summary} />
      {isDoctor && enterer && (
        <>
          <div className="lab-order-item__fields">
            <label className="regimen-apply__reason">
              コメント
              <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} />
            </label>
          </div>
          <div className="lab-order-item__actions">
            <button type="button" onClick={handleGo} disabled={save.isPending || master.isPending}>
              実施可
            </button>
            <button type="button" onClick={handleWithdraw} disabled={save.isPending || withdrawable.length === 0}>
              取消
            </button>
          </div>
        </>
      )}
    </fieldset>
  );
}
