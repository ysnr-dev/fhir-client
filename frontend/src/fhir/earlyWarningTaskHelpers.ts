import {
  bandAtLeast,
  buildEarlyWarningObservation,
  computeNews2,
  EARLY_WARNING_BAND_LABEL,
  earlyWarningInputOf,
  hasEarlyWarningInput,
  news2ItemsText,
  news2MissingText,
  type EarlyWarningBand,
  type EarlyWarningFormFields,
  type EarlyWarningSettings,
  type News2Score,
} from "./earlyWarningHelpers";
import { encounterAttendingId, encounterAttendingName } from "./encounterHelpers";
import {
  buildCancelledNotificationTask,
  buildNotificationTask,
  notificationTaskEntry,
  taskInputOf,
  taskOwnerName,
  taskPatientId,
  type NotificationRowBase,
} from "./notificationHelpers";
import type { VitalPostEntry } from "./vitalHelpers";

// 早期警告(NEWS2)の通知。
//
//   NEWS2 の Observation ← focus ── Task(通知) ── owner → 入院の主治医
//
// 入院中の患者で、区分が施設設定の下限(既定は中)以上になった測定の transaction で作る。
// 同じ入院に未対応の通知があれば書き換えて出し直し(新しい Task は増やさない)、下限を下回る測定なら取り下げる。
// 測定セットは保存のたびに作り直す(DELETE + POST)ので、focus は出し直しのたびに新しい NEWS2 を指す。
// 設計は docs/early-warning-design.md §4。

export const EWS_ALERT_TASK_CODE = { code: "ews-alert", display: "早期警告" };

/** 確認したときに通知へ残す文。 */
export const EWS_ALERT_NOTE = "早期警告を確認しました。";

const TOTAL_INPUT = "合計";
const BAND_INPUT = "区分";
const ITEMS_INPUT = "項目";
const MISSING_INPUT = "欠測";
const MEASURED_AT_INPUT = "測定日時";

/**
 * 測定の transaction に足す通知の entry。
 * - 入院が無い(外来・退院後) → 何もしない
 * - 区分が下限以上 → 通知を作る / 未対応の通知を書き換える
 * - 下限を下回る・算出できない → 未対応の通知があれば取り下げる
 */
export function ewsAlertTaskEntries(args: {
  score: News2Score | null;
  /** 同じ transaction の NEWS2 の fullUrl。 */
  focusReference: string | null;
  patientId: string;
  encounter: fhir4.Encounter | null | undefined;
  settings: EarlyWarningSettings;
  measuredAt: string;
  /** その入院の未対応の通知。 */
  existing: fhir4.Task | undefined;
  requester?: fhir4.Reference;
}): fhir4.BundleEntry[] {
  const { score, encounter, existing } = args;
  if (!encounter?.id) return [];
  const notify = Boolean(
    args.settings.enabled && score && args.focusReference && bandAtLeast(score.band, args.settings.notify_band),
  );
  if (!notify || !score || !args.focusReference) {
    return existing?.id && existing.status === "requested"
      ? [notificationTaskEntry(buildCancelledNotificationTask(existing), existing.id)]
      : [];
  }

  const attendingId = encounterAttendingId(encounter);
  const itemsText = news2ItemsText(score.items);
  const missingText = news2MissingText(score.missing);
  const task = buildNotificationTask(
    {
      code: EWS_ALERT_TASK_CODE,
      severity: score.band === "high" ? "alert" : "caution",
      focusReference: args.focusReference,
      patientId: args.patientId,
      owner: attendingId
        ? { reference: `Practitioner/${attendingId}`, display: encounterAttendingName(encounter) }
        : undefined,
      requester: args.requester,
      description: [
        `NEWS2 ${score.total}点(${EARLY_WARNING_BAND_LABEL[score.band]})`,
        itemsText,
        missingText ? `欠測: ${missingText}` : "",
      ]
        .filter(Boolean)
        .join(" "),
      input: [
        { type: { text: TOTAL_INPUT }, valueInteger: score.total },
        { type: { text: BAND_INPUT }, valueCode: score.band },
        ...(itemsText ? [{ type: { text: ITEMS_INPUT }, valueString: itemsText }] : []),
        ...(missingText ? [{ type: { text: MISSING_INPUT }, valueString: missingText }] : []),
        { type: { text: MEASURED_AT_INPUT }, valueDateTime: args.measuredAt },
      ],
    },
    existing,
  );
  task.encounter = { reference: `Encounter/${encounter.id}` };
  return [notificationTaskEntry(task, existing?.id)];
}

export interface EwsAlertRow extends NotificationRowBase {
  total: number;
  band: EarlyWarningBand;
  itemsText: string;
  missingText: string;
  measuredAt: string;
}

export function ewsAlertRowOf(task: fhir4.Task, patient: fhir4.Patient | undefined): EwsAlertRow {
  const band = taskInputOf(task, BAND_INPUT)?.valueCode as EarlyWarningBand | undefined;
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    total: taskInputOf(task, TOTAL_INPUT)?.valueInteger ?? 0,
    band: band ?? "medium",
    itemsText: taskInputOf(task, ITEMS_INPUT)?.valueString ?? "",
    missingText: taskInputOf(task, MISSING_INPUT)?.valueString ?? "",
    measuredAt: taskInputOf(task, MEASURED_AT_INPUT)?.valueDateTime ?? "",
  };
}

/** 測定 1 回ぶんの NEWS2 を算出するのに要る、測定の外側の情報。 */
export interface EarlyWarningContext {
  settings: EarlyWarningSettings;
  /** 進行中の入院。無ければ通知しない(NEWS2 は残す)。 */
  encounter: fhir4.Encounter | null | undefined;
  spo2Scale2: boolean;
  /** その入院の未対応の通知。 */
  existingTask?: fhir4.Task;
}

/**
 * 測定の transaction に足す NEWS2 の Observation と通知の entry。施設設定で無効なら何も足さない。
 * `posts` は同じ transaction で POST する測定(fullUrl 付き)。
 */
export function earlyWarningEntries(args: {
  posts: VitalPostEntry[];
  values: EarlyWarningFormFields;
  patientId: string;
  context: EarlyWarningContext;
  requester?: fhir4.Reference;
}): fhir4.BundleEntry[] {
  const { posts, context } = args;
  if (!context.settings.enabled) return [];
  const base = posts[0]?.resource;
  const computed = computeNews2(earlyWarningInputOf(args.values, context.spo2Scale2));
  const score = base && hasEarlyWarningInput(computed) ? computed : null;
  const fullUrl = score ? `urn:uuid:${crypto.randomUUID()}` : null;
  const entries: fhir4.BundleEntry[] = [];
  if (score && base && fullUrl) {
    entries.push({
      fullUrl,
      resource: buildEarlyWarningObservation({ score, base, derivedFrom: posts.map((p) => p.fullUrl) }),
      request: { method: "POST", url: "Observation" },
    });
  }
  entries.push(
    ...ewsAlertTaskEntries({
      score,
      focusReference: fullUrl,
      patientId: args.patientId,
      encounter: context.encounter,
      settings: context.settings,
      measuredAt: base?.effectiveDateTime ?? "",
      existing: context.existingTask,
      requester: args.requester,
    }),
  );
  return entries;
}
