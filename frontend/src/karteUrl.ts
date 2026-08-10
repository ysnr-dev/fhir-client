import type { KarteItemKind } from "./fhir/karteTimeline";

// カルテ画面の URL パラメータ。
//
// 「どのタブで何を開いているか」を URL に載せることで、
//  - 個別の記録をリンクで共有・ブックマークできる
//  - ブラウザの戻るが画面内の操作に効く(戻るでカルテ画面ごと抜けない)
//  - リロードしても開いていたものが復元される
//
// 入力途中のフォーム(各タブの登録・編集、右ペイン)は載せない。URL を復元しても
// 入力内容までは戻らず、「空のフォームだけが開く」中途半端な状態になるため。

/** 左ペインのタブ。分割モードでは下ペインのタブを指す。 */
export const KARTE_TAB_PARAM = "tab";
/** 選択中のタブで開いているもの。病名・アレルギー・検査結果の ID か "timeline"。 */
export const KARTE_VIEW_PARAM = "view";
/** タイムラインのカードから開く詳細モーダルの対象("<種別>:<id>")。 */
export const KARTE_DETAIL_PARAM = "detail";

/** 検査結果タブの時系列表示。ID と紛れないよう予約語として扱う。 */
export const LAB_TIMELINE_VIEW = "timeline";

export const KARTE_TABS = [
  { key: "karte", label: "カルテ" },
  { key: "condition", label: "病名" },
  { key: "allergy", label: "アレルギー" },
  { key: "lab", label: "検査結果" },
] as const;

export type KarteTabKey = (typeof KARTE_TABS)[number]["key"];
/** 上下分割モードで下ペインに出せるタブ(カルテは常に上ペインなので除く)。 */
export type KarteOtherTabKey = Exclude<KarteTabKey, "karte">;

export const KARTE_OTHER_TABS = KARTE_TABS.filter((tab) => tab.key !== "karte") as ReadonlyArray<{
  key: KarteOtherTabKey;
  label: string;
}>;

export function parseKarteTab(value: string | null): KarteTabKey {
  return KARTE_TABS.some((tab) => tab.key === value) ? (value as KarteTabKey) : "karte";
}

/**
 * 詳細モーダルの対象種別。カードの種別に加えて、検体検査のカードから開く
 * 「検査結果表示」(DiagnosticReport)を持つ。検査結果はカルテのカードにはならないが、
 * モーダルの対象としては独立した種別が要る。
 */
export type KarteDetailKind = KarteItemKind | "lab-result";

export interface KarteDetailTarget {
  kind: KarteDetailKind;
  id: string;
}

const DETAIL_KINDS: KarteDetailKind[] = [
  "note",
  "prescription",
  "injection",
  "lab-order",
  "rad-order",
  "lab-result",
  "qr",
];

export function formatKarteDetail(target: KarteDetailTarget): string {
  return `${target.kind}:${target.id}`;
}

// 壊れた値(手打ちの URL や仕様変更後の古いリンク)は「開いていない」として扱う。
export function parseKarteDetail(value: string | null): KarteDetailTarget | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator < 0) return null;
  const kind = value.slice(0, separator) as KarteDetailKind;
  const id = value.slice(separator + 1);
  if (!id || !DETAIL_KINDS.includes(kind)) return null;
  return { kind, id };
}
