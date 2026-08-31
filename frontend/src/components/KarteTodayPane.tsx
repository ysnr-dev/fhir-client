import { useRef } from "react";
import { KarteTimeline } from "./KarteTimeline";
import type { KarteDayGroup, KarteTimelineItem } from "../fhir/karteTimeline";
import type { KarteDetailTarget } from "../karteUrl";

// 左ペインを縦に割ったときの右側。本日 1 日分だけを出す。
// カードの見た目・操作(編集 / DO / 詳細 / 削除)は通常のタイムラインと同じにするため
// KarteTimeline をそのまま使う。本日は必ず先頭ページに入っているので、追加読み込みは
// 行わない(hasMore: false)。

interface KarteTodayPaneProps {
  /** 本日の診療日グループ。1 件も無ければ undefined。 */
  group: KarteDayGroup | undefined;
  /** 本日の日付(YYYY-MM-DD)。 */
  day: string;
  isLoading: boolean;
  onEdit: (item: KarteTimelineItem) => void;
  onDo: (item: KarteTimelineItem) => void;
  onOpenDetail: (target: KarteDetailTarget) => void;
  onDeleted: (item: KarteTimelineItem) => void;
  problemsById: Map<string, fhir4.Condition>;
  selectedProblemIds: ReadonlySet<string> | null;
}

export function KarteTodayPane({
  group,
  day,
  isLoading,
  onEdit,
  onDo,
  onOpenDetail,
  onDeleted,
  problemsById,
  selectedProblemIds,
}: KarteTodayPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <section className="karte-today" aria-label="本日のカルテ">
      <div className="karte-today__header">
        <h3 className="karte-today__title">本日のカルテ</h3>
        <span className="karte-today__date">{day}</span>
      </div>
      <KarteTimeline
        groups={group ? [group] : []}
        isLoading={isLoading}
        hasMore={false}
        isFetchingMore={false}
        // 追加読み込みをしないので、再判定のトリガーも要らない。
        loadToken="today"
        onLoadMore={() => {}}
        onEdit={onEdit}
        onDo={onDo}
        onOpenDetail={onOpenDetail}
        onDeleted={onDeleted}
        containerRef={containerRef}
        problemsById={problemsById}
        selectedProblemIds={selectedProblemIds}
        // 診療日ペインからの移動先は左側のタイムライン。ここでは強調しない。
        highlightKey={null}
        emptyMessage="本日の診療情報がありません。"
      />
    </section>
  );
}
