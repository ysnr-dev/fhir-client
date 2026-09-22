import { parseQuestionnaireResponseMeta } from "./questionnaireResponseHelpers";
import { diffDays } from "../lib/dates";

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
}

/**
 * 既定の 7 日は診療報酬の**外来放射線照射診療料(B001-2-8)**に合わせてある —— 同点数は
 * 「7 日間に 1 回に限り算定」し、算定日に放射線治療医(経験 5 年以上)が診察することを
 * 要件にしている。ただしこれは**外来の患者**の算定要件で(入院中の患者は対象外)、入院の
 * 患者や施設ごとの運用まで縛るものではないため、施設設定で変えられるようにしてある。
 */
export const DEFAULT_RADIOTHERAPY_REVIEW: RadiotherapyReviewSettings = {
  interval_days: 7,
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

/** 「診察 09-15（7 日）」。1 件も無ければ「診察なし」。 */
export function radiotherapyReviewLabel(state: RadiotherapyReviewState): string {
  if (!state.last?.date) return "診察なし";
  return `診察 ${state.last.date.slice(5)}${state.elapsed === null ? "" : `（${state.elapsed} 日）`}`;
}
