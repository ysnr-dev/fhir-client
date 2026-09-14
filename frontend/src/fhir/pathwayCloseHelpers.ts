import { today } from "../lib/dates";

// クリニカルパスの終了・中止。ePath の「パス適用情報 目標・評価情報」(EPath Goal EPathApply)に倣う。
// React に依存しない。設計は docs/clinical-pathway-design.md §7.5。
//
//   CarePlan(適用)  status = completed(終了)/ revoked(中止)、period.end = 終了日
//   Goal(適用)      identifier apply-goal-id = 適用の識別子、lifecycleStatus = completed / cancelled、
//                   拡張 EPathGoalStatusReason = パス終了区分(1 終了 / 2 中止)、statusDate = 終了日、
//                   description.text = 施設パス名、note = 中止理由・総合評価
//
// ［決定］終了しても未実施のタスクはそのままにする(その日に何をする予定だったかは残す)。
// ［決定］取り消し(進行中に戻す)は CarePlan を active に戻して period.end を落とし、Goal を消す
// (「終わったことにした」記録を残さない。やり直しは入力の訂正であって経過ではない)。

const ID_SYSTEM_BASE = "http://e-path.jp/fhir/ePath/IdSystem";
export const PATHWAY_APPLY_GOAL_ID_SYSTEM = `${ID_SYSTEM_BASE}/apply-goal-id`;

const EXT_BASE = "http://e-path.jp/fhir/ePath/StructureDefinition";
/** パス終了区分を載せる拡張(IG では「パス中止理由」だが、束縛は終了区分の ValueSet)。 */
export const PATHWAY_CLOSING_TYPE_EXT = `${EXT_BASE}/EPathGoalStatusReason`;

const CS_BASE = "http://e-path.jp/fhir/ePath/CodeSystem";
export const PATHWAY_CLOSING_TYPE_SYSTEM = `${CS_BASE}/EPathPathClosingTypeCS`;

/** ePath のパス終了区分。 */
export type PathwayClosingType = "1" | "2";

export const CLOSING_TYPE_OPTIONS: { code: PathwayClosingType; display: string; note: string }[] = [
  { code: "1", display: "終了", note: "最後の病日まで進んで終わった" },
  { code: "2", display: "中止", note: "バリアンスなどで途中でやめた" },
];

export function closingTypeLabel(code: string): string {
  return CLOSING_TYPE_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

/** 終了区分に対応する CarePlan.status と Goal.lifecycleStatus。 */
function statusesOf(closing: PathwayClosingType): { carePlan: "completed" | "revoked"; goal: "completed" | "cancelled" } {
  return closing === "1"
    ? { carePlan: "completed", goal: "completed" }
    : { carePlan: "revoked", goal: "cancelled" };
}

export interface PathwayCloseValues {
  closing: PathwayClosingType;
  /** 終了日(YYYY-MM-DD)。CarePlan.period.end と Goal.statusDate に入る。 */
  endDate: string;
  /** 中止理由。中止のときだけ入れる。 */
  reason: string;
  /** 総合評価(自由文)。 */
  comment: string;
}

export function emptyPathwayCloseValues(): PathwayCloseValues {
  return { closing: "1", endDate: today(), reason: "", comment: "" };
}

/** 保存済みの終了・中止を入力値に戻す。まだ終わっていなければ既定値。 */
export function pathwayCloseValuesOf(
  apply: fhir4.CarePlan | undefined,
  goal: fhir4.Goal | undefined,
): PathwayCloseValues {
  if (!apply || (apply.status !== "completed" && apply.status !== "revoked")) {
    return emptyPathwayCloseValues();
  }
  const closing: PathwayClosingType = apply.status === "revoked" ? "2" : "1";
  const notes = goal?.note ?? [];
  return {
    closing,
    endDate: apply.period?.end?.slice(0, 10) || goal?.statusDate || today(),
    reason: notes.find((n) => n.text?.startsWith(REASON_PREFIX))?.text?.slice(REASON_PREFIX.length) ?? "",
    comment: notes.find((n) => !n.text?.startsWith(REASON_PREFIX))?.text ?? "",
  };
}

/** 中止理由と総合評価はどちらも note なので、理由の側に印を付けて見分ける。 */
const REASON_PREFIX = "中止理由: ";

export interface PathwayCloseContext {
  patientId: string;
  /** 適用の CarePlan(そのまま status と period を書き換える)。 */
  apply: fhir4.CarePlan;
  /** 適用の識別子(施設コード.適用uuid)。Goal の識別子に使う。 */
  applyId: string;
  /** 保存済みの適用の Goal。初回は undefined。 */
  goal: fhir4.Goal | undefined;
}

function put<T extends fhir4.Resource>(resource: T): fhir4.BundleEntry {
  return { resource, request: { method: "PUT", url: `${resource.resourceType}/${resource.id}` } };
}

/** パスを終了・中止する transaction。適用の CarePlan と Goal を 1 回で書く。 */
export function buildPathwayCloseBundle(
  ctx: PathwayCloseContext,
  values: PathwayCloseValues,
): fhir4.Bundle {
  const statuses = statusesOf(values.closing);
  const notes: fhir4.Annotation[] = [];
  if (values.closing === "2" && values.reason.trim()) {
    notes.push({ text: `${REASON_PREFIX}${values.reason.trim()}` });
  }
  if (values.comment.trim()) notes.push({ text: values.comment.trim() });

  const apply: fhir4.CarePlan = {
    ...ctx.apply,
    status: statuses.carePlan,
    period: { ...(ctx.apply.period ?? {}), end: values.endDate },
  };

  const goal: fhir4.Goal = {
    ...(ctx.goal ?? {}),
    resourceType: "Goal",
    identifier: [{ system: PATHWAY_APPLY_GOAL_ID_SYSTEM, value: ctx.applyId }],
    lifecycleStatus: statuses.goal,
    description: { text: ctx.apply.title ?? "" },
    subject: { reference: `Patient/${ctx.patientId}` },
    statusDate: values.endDate,
    extension: [
      {
        url: PATHWAY_CLOSING_TYPE_EXT,
        valueCodeableConcept: {
          coding: [
            {
              system: PATHWAY_CLOSING_TYPE_SYSTEM,
              code: values.closing,
              display: closingTypeLabel(values.closing),
            },
          ],
        },
      },
    ],
    ...(notes.length > 0 ? { note: notes } : {}),
  };
  if (notes.length === 0) delete goal.note;

  const goalEntry: fhir4.BundleEntry = ctx.goal?.id
    ? put({ ...goal, id: ctx.goal.id })
    : { fullUrl: `urn:uuid:${crypto.randomUUID()}`, resource: goal, request: { method: "POST", url: "Goal" } };

  return { resourceType: "Bundle", type: "transaction", entry: [put(apply), goalEntry] };
}

/** 終了・中止を取り消して進行中に戻す transaction。Goal は消す。 */
export function buildPathwayReopenBundle(ctx: PathwayCloseContext): fhir4.Bundle {
  const apply: fhir4.CarePlan = { ...ctx.apply, status: "active" };
  if (apply.period) {
    const { end: _end, ...rest } = apply.period;
    apply.period = rest;
  }
  const entry: fhir4.BundleEntry[] = [put(apply)];
  if (ctx.goal?.id) entry.push({ request: { method: "DELETE", url: `Goal/${ctx.goal.id}` } });
  return { resourceType: "Bundle", type: "transaction", entry };
}
