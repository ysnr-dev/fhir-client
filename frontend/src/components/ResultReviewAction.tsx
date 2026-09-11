import { useLabResultDetail, useMarkResultReviewed, useResultReviewProvenance } from "../api/queries";
import { isPreliminaryReport } from "../fhir/labResultHelpers";
import { dateTimeLabel } from "../lib/dates";

// 検査結果の確認(既読)。3 種別ともカルテタブの見出し行(登録・編集の並び)の左端に置く。
//
// 確認の記録は来歴(Provenance)が正本で、ここはその最後の 1 件を読んで
// 「確認する / 確認済み」を出すだけ。確認者と確認日時はツールチップで読む
// (結果の表示領域を行で消費しない)。
//
// 中間報告のうちは出さない。値が変わりうるものを読ませても確認にならないので、
// 通知も最終報告になってから作る(resultReviewHelpers)。

/** 確認した後にレポートが更新されていないか。更新されていれば読み直してもらう。 */
function reviewedAfterUpdate(at: string, lastUpdated: string | undefined): boolean {
  if (!lastUpdated) return true;
  const reviewed = Date.parse(at);
  const updated = Date.parse(lastUpdated);
  if (Number.isNaN(reviewed) || Number.isNaN(updated)) return true;
  return reviewed >= updated;
}

function reportOf(bundle: fhir4.Bundle | undefined): fhir4.DiagnosticReport | undefined {
  return (bundle?.entry ?? [])
    .map((entry) => entry.resource)
    .find((resource): resource is fhir4.DiagnosticReport =>
      Boolean(resource && resource.resourceType === "DiagnosticReport"),
    );
}

export function ResultReviewAction({ reportId }: { reportId: string }) {
  // 内容表示が引いているものと同じクエリなので、通信は増えない。
  const detail = useLabResultDetail(reportId);
  const review = useResultReviewProvenance(reportId);
  const markReviewed = useMarkResultReviewed();

  const report = reportOf(detail.data?.data);
  if (!report || isPreliminaryReport(report.status)) return null;

  const latest = review.data ?? null;
  const current = latest ? reviewedAfterUpdate(latest.at, report.meta?.lastUpdated) : false;

  if (latest && current) {
    return (
      <div className="result-review">
        <span
          className="result-review__done"
          title={`${latest.name} が ${dateTimeLabel(latest.at)} に確認しました`}
        >
          確認済み
        </span>
      </div>
    );
  }

  return (
    <div className="result-review">
      <button
        type="button"
        className="result-review__button"
        disabled={markReviewed.isPending}
        title={
          latest
            ? `前回の確認: ${latest.name} ${dateTimeLabel(latest.at)}（その後に更新されています）`
            : undefined
        }
        onClick={() => markReviewed.mutate(reportId)}
      >
        確認
      </button>
      {markReviewed.error && (
        <span className="result-review__error" role="status">
          確認を記録できませんでした。
        </span>
      )}
    </div>
  );
}
