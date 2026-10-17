import { epochOf } from "../lib/dates";
import { KARTE_KIND_LABELS, type KarteDayGroup, type KarteItemKind, type KarteTimelineItem } from "./karteTimeline";

// カルテのカードの同じ日の中での並び(施設設定 karte_card_order)。
// time は日時の順、kind は種別の順に並べ、同じ種別の中は日時の順にする。
// kinds は種別を並べた順。保存に無い種別(後から足した種別)は既定の順で後ろに付ける。

export type KarteCardOrderMode = "time" | "kind";

export interface KarteCardOrderSettings {
  mode: KarteCardOrderMode;
  kinds: string[];
}

export const KARTE_CARD_ORDER_MODE_LABELS: Record<KarteCardOrderMode, string> = {
  time: "時系列",
  kind: "種別順",
};

/** 既定の種別の順(KARTE_KIND_LABELS の定義順)。 */
export const KARTE_CARD_KINDS = Object.keys(KARTE_KIND_LABELS) as KarteItemKind[];

export const DEFAULT_KARTE_CARD_ORDER: KarteCardOrderSettings = { mode: "time", kinds: [] };

/** 保存された順から知らない種別を外し、足りない種別を既定の順で後ろに足す。 */
export function resolveKarteCardKinds(kinds: readonly string[]): KarteItemKind[] {
  const known = kinds.filter((kind): kind is KarteItemKind => kind in KARTE_KIND_LABELS);
  return [...known, ...KARTE_CARD_KINDS.filter((kind) => !known.includes(kind))];
}

function compareDateTime(a: KarteTimelineItem, b: KarteTimelineItem): number {
  return epochOf(a.dateTime) - epochOf(b.dateTime) || a.dateTime.localeCompare(b.dateTime);
}

/** 日の中の並べ替え。direction は日時の向き(画面は新しい順、印刷は古い順)。 */
export function sortKarteDayItems(
  items: readonly KarteTimelineItem[],
  order: KarteCardOrderSettings,
  direction: "asc" | "desc",
): KarteTimelineItem[] {
  const sign = direction === "asc" ? 1 : -1;
  if (order.mode === "time") return [...items].sort((a, b) => sign * compareDateTime(a, b));
  const rank = new Map(resolveKarteCardKinds(order.kinds).map((kind, index) => [kind, index]));
  return [...items].sort(
    (a, b) => (rank.get(a.kind) ?? 0) - (rank.get(b.kind) ?? 0) || sign * compareDateTime(a, b),
  );
}

export function sortKarteDayGroups(
  groups: KarteDayGroup[],
  order: KarteCardOrderSettings,
  direction: "asc" | "desc",
): KarteDayGroup[] {
  return groups.map((group) => ({ ...group, items: sortKarteDayItems(group.items, order, direction) }));
}
