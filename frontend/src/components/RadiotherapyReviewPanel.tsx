import { useMemo } from "react";
import {
  useFacilitySettings,
  useRadiotherapyCourseReviews,
  useRadiotherapyOrderDetail,
} from "../api/queries";
import { summarizeRadiotherapyOrder } from "../fhir/radiotherapyOrderHelpers";
import {
  DEFAULT_RADIOTHERAPY_REVIEW,
  radiotherapyReviewLabel,
  radiotherapyReviewState,
} from "../fhir/radiotherapyReviewHelpers";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { QuestionnaireResponseCreatePanel } from "./QuestionnaireResponsePanels";

// カルテ右ペインの「放射線治療(週次レビュー)」。照射期間中の診察を、テンプレート回答として
// 治療処方に結んで残す(docs/radiotherapy-order-design.md §6.3)。
//
// 様式は施設がテンプレートで決めるので、ここは器だけを用意して中身は
// QuestionnaireResponseCreatePanel に任せる。2 回目からは前回と同じテンプレートを
// 選択済みで開く(毎回プルダウンから探さなくて済むように)。

interface RadiotherapyReviewPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

/** 直近の診察を何件出すか。全件は詳細で読む。 */
const RECENT_REVIEWS = 3;

export function RadiotherapyReviewPanel({ patientId, srId, onSaved }: RadiotherapyReviewPanelProps) {
  const detail = useRadiotherapyOrderDetail(srId);
  const reviews = useRadiotherapyCourseReviews(srId);
  const facility = useFacilitySettings();

  const order = useMemo(
    () =>
      (detail.data?.data.entry ?? [])
        .map((entry) => entry.resource)
        .find((r): r is fhir4.ServiceRequest => r?.resourceType === "ServiceRequest" && r.id === srId),
    [detail.data, srId],
  );

  if (detail.isPending) return <p>読み込み中...</p>;
  if (!order) return <ErrorBanner error={detail.error ?? new Error("放射線治療が見つかりません")} />;

  const summary = summarizeRadiotherapyOrder(order);
  const list = reviews.data ?? [];
  const state = radiotherapyReviewState(
    list,
    today(),
    facility.data?.radiotherapy_review ?? DEFAULT_RADIOTHERAPY_REVIEW,
  );

  return (
    <div className="regimen-adverse">
      <ErrorBanner error={detail.error ?? reviews.error} />
      <p className="regimen-day__title">
        {`第${summary.courseNumber}コース ${summary.siteLabel}`.trim()}
        <span className={`micro-result__badge${state.overdue ? "" : " micro-result__badge--muted"}`}>
          {radiotherapyReviewLabel(state)}
        </span>
      </p>

      <ul className="regimen-adverse__list">
        {list.slice(0, RECENT_REVIEWS).map((review) => (
          <li key={review.id} className="regimen-adverse__item">
            <span className="regimen-adverse__period">{review.date}</span>
            <span className="regimen-adverse__note">{review.authorName || "-"}</span>
          </li>
        ))}
        {list.length === 0 && <li className="regimen-day__empty">このコースの診察記録はありません</li>}
      </ul>

      <QuestionnaireResponseCreatePanel
        patientId={patientId}
        basedOn={[{ reference: `ServiceRequest/${srId}` }]}
        defaultQuestionnaireCanonical={state.last?.questionnaire}
        onSaved={onSaved}
      />
    </div>
  );
}
