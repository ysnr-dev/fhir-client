import { KARTE_TABS, type KarteTabKey } from "../karteUrl";
import { DASHBOARD_COLUMNS, addTile, normalizeTiles, type GridTile } from "./dashboardLayout";

// 診療ダッシュボードのレイアウト(docs/clinical-dashboard-design.md)。カルテ左ペインのタブを
// カードとして、分析ダッシュボードと同じ横 12 列のマス目に置く。マス目の処理は
// fhir/dashboardLayout.ts を使い、ここは種別(どのタブか)と既定の大きさだけを持つ。

/** カードにしないタブ。カルテ印刷と SMART アプリは操作の画面で、診療ダッシュボード自身は入れ子にしない。 */
const EXCLUDED_KINDS = ["clinical-dashboard", "karte-print", "smart-apps"] as const;

export type ClinicalDashboardCardKind = Exclude<KarteTabKey, (typeof EXCLUDED_KINDS)[number]>;

export interface ClinicalDashboardCard extends GridTile {
  /** カルテのタブのキー(karte はタイムライン)。 */
  kind: ClinicalDashboardCardKind;
  /** 無ければタブの名前を出す。 */
  title?: string;
  /** 中身の表示倍率(%)。無ければ 100。 */
  zoom?: number;
}

export interface ClinicalDashboardBody {
  schema_version: 1;
  cards: ClinicalDashboardCard[];
}

export const CLINICAL_DASHBOARD_MAX_CARDS = 20;

/** カードの表示倍率の選択肢(%)。タブの部品は文字の大きさを px で持つので、中身ごと縮める。 */
export const CLINICAL_CARD_ZOOMS = [100, 90, 80, 70, 60] as const;

export function clinicalCardZoom(card: ClinicalDashboardCard): number {
  return card.zoom ?? 100;
}

/** カードにできる種別(タブ行の順)。ラベルもタブと同じ。 */
export const CLINICAL_DASHBOARD_CARD_KINDS = KARTE_TABS.filter(
  (tab) => !(EXCLUDED_KINDS as readonly string[]).includes(tab.key),
) as ReadonlyArray<{ key: ClinicalDashboardCardKind; label: string }>;

export function isClinicalDashboardCardKind(kind: string): kind is ClinicalDashboardCardKind {
  return CLINICAL_DASHBOARD_CARD_KINDS.some((item) => item.key === kind);
}

/** 知らない種別(保存後にタブが無くなったもの)はキーをそのまま出す。 */
export function clinicalDashboardCardLabel(kind: string): string {
  return CLINICAL_DASHBOARD_CARD_KINDS.find((item) => item.key === kind)?.label ?? kind;
}

/** 既定の大きさ(列 × 行)。タブの部品はどれも横幅を使うので横いっぱいに置き、要れば縮める。 */
export function defaultCardSize(): { w: number; h: number } {
  return { w: DASHBOARD_COLUMNS, h: 8 };
}

export function emptyClinicalDashboard(): ClinicalDashboardBody {
  return { schema_version: 1, cards: [] };
}

export function addClinicalCard(
  cards: ClinicalDashboardCard[],
  card: { kind: ClinicalDashboardCardKind; title?: string },
): ClinicalDashboardCard[] {
  return addTile(cards, card, defaultCardSize(), "c");
}

/** 保存した並びを画面用に整える(マス目に収め、重なりを解く)。 */
export function normalizeClinicalDashboard(body: ClinicalDashboardBody): ClinicalDashboardBody {
  const cards = normalizeTiles(body.cards);
  return cards === body.cards ? body : { ...body, cards };
}
