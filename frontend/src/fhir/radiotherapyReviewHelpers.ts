import {
  buildCompletedNotificationTask,
  buildNotificationTask,
  completeNotificationEntry,
  hasTaskCode,
  notificationTaskEntry,
  taskInputOf,
  taskOwnerName,
  taskPatientId,
  type NotificationRowBase,
} from "./notificationHelpers";
import { parseQuestionnaireResponseMeta } from "./questionnaireResponseHelpers";
import { diffDays, today } from "../lib/dates";

/**
 * 治療中の診察(週次レビュー)の記録(docs/radiotherapy-order-design.md §6.3)。
 *
 * 照射の期間中、放射線治療医は定期的に患者を診て、皮膚や粘膜の状態・体重・全身状態を見ながら
 * 治療を続けられるかを判断する。書く中身は施設ごとに違うので**テンプレート(Questionnaire)で
 * 様式を決め、回答(QuestionnaireResponse)を治療処方に `basedOn` で結ぶ**。
 *
 * - ［決定］診療記録(Composition)には寄せない。上流の Composition 検索に `event.detail` が
 *   無く、「そのコースの診察」を集められないため —— 集められないと診察の抜けを見つけられない。
 *   QuestionnaireResponse は `based-on` 検索に対応済みで、上流の改修が要らない
 * - ［決定］**専用のリソースは足さない。** テンプレート回答はカルテのタイムラインにも出て、
 *   平文表示や帳票の仕組みもそのまま使える
 * - 有害事象(CTCAE)は診察の中で見つかるが、記録は別(`adverseEventHelpers.ts`)。Grade と
 *   発現日で追いたいものなので、様式の中の文章に埋もれさせない
 */

/**
 * 治療中の診察の間隔(施設設定 `radiotherapy_review`)。最後の診察からこの日数を超えた
 * コースを部門一覧で強調する。
 */
export interface RadiotherapyReviewSettings {
  interval_days: number;
  /** 記入欄を選択済みで開くテンプレートの canonical。空なら選ばせる。 */
  template: string;
}

/**
 * 既定の 7 日は診療報酬の**外来放射線照射診療料(B001-2-8)**に合わせてある —— 同点数は
 * 「7 日間に 1 回に限り算定」し、算定日に放射線治療医(経験 5 年以上)が診察することを
 * 要件にしている。ただしこれは**外来の患者**の算定要件で(入院中の患者は対象外)、入院の
 * 患者や施設ごとの運用まで縛るものではないため、施設設定で変えられるようにしてある。
 */
export const DEFAULT_RADIOTHERAPY_REVIEW: RadiotherapyReviewSettings = {
  interval_days: 7,
  template: "",
};

export interface RadiotherapyReview {
  id: string;
  /** 診察の対象になった治療処方。 */
  orderSrId: string;
  /** 記載日(YYYY-MM-DD)。 */
  date: string;
  /** テンプレートの canonical。次に開くときの初期選択に使う。 */
  questionnaire: string;
  authorName: string;
}

/** 治療処方を `basedOn` に持つテンプレート回答を診察として読む。持たなければ対象外。 */
export function parseRadiotherapyReview(
  qr: fhir4.QuestionnaireResponse,
): RadiotherapyReview | null {
  const reference = qr.basedOn?.find((r) => r.reference?.startsWith("ServiceRequest/"))?.reference;
  const orderSrId = reference?.split("/").pop() ?? "";
  if (!qr.id || !orderSrId) return null;
  return {
    id: qr.id,
    orderSrId,
    date: (qr.authored ?? "").slice(0, 10),
    questionnaire: qr.questionnaire ?? "",
    authorName: parseQuestionnaireResponseMeta(qr).authorName,
  };
}

/** オーダー id → 診察(新しい順)。 */
export function radiotherapyReviewsByOrderId(
  reviews: RadiotherapyReview[],
): Map<string, RadiotherapyReview[]> {
  const byOrderId = new Map<string, RadiotherapyReview[]>();
  for (const review of reviews) {
    const list = byOrderId.get(review.orderSrId);
    if (list) list.push(review);
    else byOrderId.set(review.orderSrId, [review]);
  }
  for (const list of byOrderId.values()) list.sort((a, b) => b.date.localeCompare(a.date));
  return byOrderId;
}

export interface RadiotherapyReviewState {
  last: RadiotherapyReview | undefined;
  /** 最後の診察からの日数。1 件も無ければ null。 */
  elapsed: number | null;
  /** 間隔を超えている(または 1 件も無い)。治療中のコースだけ強調に使う。 */
  overdue: boolean;
}

/**
 * そのコースの診察の状態。**1 件も無いコースも overdue** にする —— 照射が始まっている
 * のに一度も診ていない状態が、いちばん見落としたくないため。
 */
export function radiotherapyReviewState(
  reviews: RadiotherapyReview[],
  today: string,
  settings: RadiotherapyReviewSettings = DEFAULT_RADIOTHERAPY_REVIEW,
): RadiotherapyReviewState {
  const last = reviews[0];
  if (!last?.date) return { last, elapsed: null, overdue: true };
  const elapsed = diffDays(last.date, today);
  return { last, elapsed, overdue: elapsed > settings.interval_days };
}

// ---- 診察が空いたコースの督促(通知 Task) ----
//
// 契機は**照射入力**。照射は治療中ほぼ毎日あるので、「間隔を超えた」ことに最初に気づける
// 場所であり、部門の手が動くところでもある(外来放射線照射診療料が第 2 日目以降の観察を
// 医師に報告させているのと同じ流れ)。宛先は治療処方の依頼医。
//
// 閉じるのは週次レビューを書いたとき。通知一覧から手で閉じることもできる(他の種別と同じ)。

export const RADIOTHERAPY_REVIEW_DUE_TASK_CODE = {
  code: "radiotherapy-review-due",
  display: "放射線治療の診察",
};

/** 対応済みにしたときに通知へ残す文。 */
export const RADIOTHERAPY_REVIEW_DUE_NOTE = "診察を記録しました。";

const COURSE_INPUT = "治療コース";
const LAST_REVIEW_INPUT = "前回の診察";

export function isRadiotherapyReviewDueTask(task: fhir4.Task): boolean {
  return hasTaskCode(task, RADIOTHERAPY_REVIEW_DUE_TASK_CODE.code);
}

/**
 * 督促 Task の entry。間隔を超えていなければ null(呼び出し側で既存の未対応 Task の
 * 有無も見る —— 同じコースの督促を毎回の照射で作り直さないため)。
 */
export function radiotherapyReviewDueEntry(args: {
  order: fhir4.ServiceRequest;
  patientId: string;
  courseLabel: string;
  state: RadiotherapyReviewState;
  settings: RadiotherapyReviewSettings;
}): fhir4.BundleEntry | null {
  const { order, patientId, courseLabel, state, settings } = args;
  if (!order.id || !state.overdue) return null;

  const requester = order.requester;
  const task = buildNotificationTask({
    code: RADIOTHERAPY_REVIEW_DUE_TASK_CODE,
    severity: "info",
    focusReference: `ServiceRequest/${order.id}`,
    patientId,
    owner: requester?.reference?.startsWith("Practitioner/") ? requester : undefined,
    description: state.last?.date
      ? `${courseLabel} 前回の診察 ${state.last.date}（${state.elapsed} 日、間隔 ${settings.interval_days} 日）`
      : `${courseLabel} 診察の記録がありません`,
    input: [
      { type: { text: COURSE_INPUT }, valueString: courseLabel },
      ...(state.last?.date
        ? [{ type: { text: LAST_REVIEW_INPUT }, valueDate: state.last.date }]
        : []),
    ],
  });
  return notificationTaskEntry(task);
}

/** 診察を書いたときに督促を閉じる entry。 */
export function buildCompletedRadiotherapyReviewDueEntries(
  tasks: fhir4.Task[],
  actor: { practitionerId: string; display: string },
): fhir4.BundleEntry[] {
  return tasks
    .filter((task) => task.id && task.status === "requested")
    .map((task) =>
      completeNotificationEntry(
        buildCompletedNotificationTask(task, actor, RADIOTHERAPY_REVIEW_DUE_NOTE),
      ),
    );
}

/** 通知一覧の行。Task に焼いた値で描く(コースは引き直さない)。 */
export interface RadiotherapyReviewDueRow extends NotificationRowBase {
  /** 対象の治療処方。カルテの週次レビューを開くのに使う。 */
  orderSrId: string;
  courseLabel: string;
  /** 前回の診察日。一度も診ていなければ空。 */
  lastReview: string;
  /** 前回の診察からの日数(表示のたびに数え直す)。診察が無ければ null。 */
  elapsed: number | null;
}

export function radiotherapyReviewDueRowOf(
  task: fhir4.Task,
  patient: fhir4.Patient | undefined,
): RadiotherapyReviewDueRow {
  const lastReview = taskInputOf(task, LAST_REVIEW_INPUT)?.valueDate ?? "";
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    orderSrId: task.focus?.reference?.split("/").pop() ?? "",
    courseLabel: taskInputOf(task, COURSE_INPUT)?.valueString ?? "",
    lastReview,
    elapsed: lastReview ? diffDays(lastReview, today()) : null,
  };
}

/** 「診察 09-15（7 日）」。1 件も無ければ「診察なし」。 */
export function radiotherapyReviewLabel(state: RadiotherapyReviewState): string {
  if (!state.last?.date) return "診察なし";
  return `診察 ${state.last.date.slice(5)}${state.elapsed === null ? "" : `（${state.elapsed} 日）`}`;
}
