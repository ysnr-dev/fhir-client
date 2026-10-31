import { useLayoutEffect, useMemo, useRef } from "react";
import { useKarteConditions } from "../api/queries";
import { splitConditions } from "../fhir/conditionHelpers";
import { useKarteTimelineFeed } from "../hooks/useKarteTimelineFeed";
import { isDateOnly } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import type { KartePanelActions } from "./KarteTabPanel";
import { KARTE_TARGET_ATTR, KarteTimeline } from "./KarteTimeline";
import { TruncatedNotice } from "./TruncatedNotice";

// 診療ダッシュボードの「カルテ」カード。カルテタブのタイムラインを読むためだけに置く
// (プロブレムリスト・診療日ペイン・絞り込みは持たない)。カードの編集・DO・削除・詳細は
// カルテタブと同じ操作で、右ペインと詳細モーダルはカルテ画面のものを使う。

export function KarteTimelineCard({
  patientId,
  baseDate,
  actions,
}: {
  patientId: string;
  /** 開いたときに合わせる日。この日(無ければそれより前で最も新しい診療日)が先頭に来るまでスクロールする。 */
  baseDate: string;
  actions: KartePanelActions;
}) {
  const feed = useKarteTimelineFeed(patientId, null, null);
  const { timeline, loadMore, loadToken, ready } = feed;
  const { conditions } = useKarteConditions(patientId);
  const problemsById = useMemo(
    () => new Map(splitConditions(conditions).problems.map((problem) => [problem.id ?? "", problem])),
    [conditions],
  );
  const containerRef = useRef<HTMLDivElement>(null);

  // 基準日の位置へ合わせる。基準日がまだ読み込んでいない範囲(カットオフより古い)なら、読み進めてから
  // 合わせる。基準日を変えるとカードごと作り直されるので、合わせるのは 1 回だけ。
  const scrolled = useRef(false);
  useLayoutEffect(() => {
    if (scrolled.current || !ready) return;
    if (timeline.cutoff !== undefined && baseDate <= timeline.cutoff && timeline.hasMore) {
      loadMore();
      return;
    }
    scrolled.current = true;
    const container = containerRef.current;
    const target = timeline.groups.find((group) => isDateOnly(group.day) && group.day <= baseDate);
    const element = target && container?.querySelector(`[${KARTE_TARGET_ATTR}="${target.day}"]`);
    if (!container || !element) return;
    container.scrollTop += element.getBoundingClientRect().top - container.getBoundingClientRect().top;
  }, [ready, loadToken, timeline, baseDate, loadMore]);

  return (
    <div className="karte-left__karte">
      <div className="karte-left__timeline">
        <ErrorBanner error={feed.errors.notes} />
        <ErrorBanner error={feed.errors.prescriptions} />
        <ErrorBanner error={feed.errors.pendingOrders} />
        <TruncatedNotice show={feed.pendingOrdersTruncated}>
          予定のオーダーが多いため、日付未定と今日より後の一部を表示できていません。
        </TruncatedNotice>
        <ErrorBanner error={feed.errors.responses} />
        <ErrorBanner error={feed.errors.pathwayEvaluations} />
        <ErrorBanner error={feed.errors.adverseEvents} />
        <KarteTimeline
          groups={timeline.groups}
          isLoading={feed.isLoading && timeline.groups.length === 0}
          hasMore={timeline.hasMore}
          isFetchingMore={feed.isFetchingMore}
          loadToken={loadToken}
          onLoadMore={loadMore}
          onEdit={actions.timeline.onEdit}
          onDo={actions.timeline.onDo}
          onOpenDetail={actions.openDetail}
          onOpenRadiotherapyPane={actions.timeline.onOpenRadiotherapyPane}
          onDeleted={actions.timeline.onDeleted}
          containerRef={containerRef}
          problemsById={problemsById}
          selectedProblemIds={null}
          highlightKey={null}
        />
      </div>
    </div>
  );
}
