import type { KarteCardFilter, KarteItemKind } from "./fhir/karteTimeline";

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
/** 選択中のタブで開いているもの。病名・アレルギー・検査結果の ID。 */
export const KARTE_VIEW_PARAM = "view";
/** タイムラインのカードから開く詳細モーダルの対象("<種別>:<id>")。 */
export const KARTE_DETAIL_PARAM = "detail";
/**
 * 「関連する記録のみ表示」で絞り込んでいるプロブレム(Condition)の id。
 * 無ければ通常のタイムライン表示。プロブレムを選ぶだけの強調表示(減光)は
 * 一時的な状態なので載せない。
 */
export const KARTE_PROBLEM_PARAM = "problem";
/**
 * タイムラインを情報の種別で絞り込むときの対象。
 * 「<種別>」、テンプレートを 1 つに絞るときは「qr:<テンプレートの url>」。
 */
export const KARTE_CARD_PARAM = "card";

export const KARTE_TABS = [
  { key: "karte", label: "カルテ" },
  { key: "condition", label: "病名" },
  { key: "allergy", label: "アレルギー" },
  // 経過表(POMR のフローシート)。上下分割で「上にカルテ、下に経過表」と並べて
  // 読めるよう、カルテ以外のタブとして持つ。
  { key: "flowsheet", label: "経過表" },
  { key: "lab", label: "検体検査" },
  // 検体検査の時系列表示。上下分割で「上にカルテ、下に時系列」と並べて読めるよう、
  // 検体検査タブの中ではなく独立したタブとして持つ。
  { key: "lab-timeline", label: "検体検査時系列" },
  { key: "micro", label: "細菌検査" },
  { key: "patho", label: "病理検査" },
  // 食事は「開始したら次の指示まで続く」ので、カードを日付順に読むだけでは
  // その日に何を食べているかが分かりにくい。暦の形で見るタブを別に持つ。
  { key: "meal", label: "食事" },
  // 看護指示(指示簿)。「今なにが有効か」を区分ごとに見る情報なので、時系列の
  // カードにはせずタブでのみ見る。
  { key: "nursing", label: "指示簿" },
  // 予約はカルテのカードにしない(タイムラインには出ない)ので、タブでのみ見る。
  { key: "appointment", label: "予約" },
] as const;

export type KarteTabKey = (typeof KARTE_TABS)[number]["key"];

/**
 * タブ行で「検査結果」1 つのドロップダウンにまとめるタブ。タブ自体は独立のまま
 * (URL の tab= も従来どおり)で、タブ行の見た目だけを階層化する。
 */
export const KARTE_LAB_GROUP: { label: string; keys: readonly KarteTabKey[] } = {
  label: "検査結果",
  keys: ["lab", "lab-timeline", "micro", "patho"],
};
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
 * 詳細モーダルの対象種別。カードの種別に加えて、検体検査・細菌検査のカードから
 * 開く「検査結果表示」(DiagnosticReport)を持つ。検査結果はカルテのカードには
 * ならないが、モーダルの対象としては独立した種別が要る。
 */
// バイタルはカードに測定値が全部出るので詳細モーダルを持たない。
export type KarteDetailKind =
  | Exclude<KarteItemKind, "vital">
  | "lab-result"
  | "micro-result"
  | "patho-result";

export interface KarteDetailTarget {
  kind: KarteDetailKind;
  id: string;
}

const DETAIL_KINDS: KarteDetailKind[] = [
  "note",
  "prescription",
  "injection",
  "lab-order",
  "micro-order",
  "patho-order",
  "rad-order",
  "physio-order",
  "endoscopy-order",
  "treatment-order",
  "surgery-order",
  "meal-order",
  "transfusion-order",
  "rehab-order",
  "nutrition-guidance-order",
  "consult-order",
  "lab-result",
  "micro-result",
  "patho-result",
  "qr",
];

export function formatKarteDetail(target: KarteDetailTarget): string {
  return `${target.kind}:${target.id}`;
}

// ---- 経過表の表示状態 ----
//
// 経過表は「どの週を見ているか」が読む位置そのものなので、他タブの view(開いている
// もの の id)と同じ枠に載せる。リロードで今日に戻らず、特定の週をリンクで共有できる。
// 形は「YYYY-MM-DD」、全画面なら「YYYY-MM-DD!」。入力途中の状態ではないので載せてよい。

export interface FlowsheetView {
  /** 基準日(表の右端)。 */
  baseDate: string;
  fullscreen?: boolean;
}

export function parseFlowsheetView(value: string | undefined): Partial<FlowsheetView> {
  const match = /^(\d{4}-\d{2}-\d{2})(!)?$/.exec(value ?? "");
  if (!match) return {};
  return { baseDate: match[1], fullscreen: Boolean(match[2]) };
}

/**
 * 既定の状態(今日・全画面でない)なら null を返して view を落とす
 * (URL に既定値を残さない。他タブの「何も開いていない = view 無し」と揃える)。
 */
export function formatFlowsheetView(view: FlowsheetView, today: string): string | null {
  if (view.baseDate === today && !view.fullscreen) return null;
  return `${view.baseDate}${view.fullscreen ? "!" : ""}`;
}

// ---- 種別での絞り込み ----

// タイムラインに出る種別(詳細モーダル専用の検査結果は含まない)。
const CARD_KINDS: KarteItemKind[] = [
  "note",
  "vital",
  "prescription",
  "injection",
  "lab-order",
  "micro-order",
  "patho-order",
  "rad-order",
  "physio-order",
  "endoscopy-order",
  "treatment-order",
  "surgery-order",
  "meal-order",
  "transfusion-order",
  "rehab-order",
  "nutrition-guidance-order",
  "qr",
];

export function formatKarteCard(filter: KarteCardFilter): string {
  return filter.kind === "qr" && filter.questionnaireUrl
    ? `qr:${filter.questionnaireUrl}`
    : filter.kind;
}

// 壊れた値(手打ちの URL や仕様変更後の古いリンク)は「絞り込みなし」として扱う。
export function parseKarteCard(value: string | null): KarteCardFilter | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator < 0) {
    return CARD_KINDS.includes(value as KarteItemKind) ? { kind: value as KarteItemKind } : null;
  }
  // テンプレートの url は "http://..." のようにコロンを含むので、最初の 1 つで切る。
  const kind = value.slice(0, separator) as KarteItemKind;
  const questionnaireUrl = value.slice(separator + 1);
  if (kind !== "qr" || !questionnaireUrl) return null;
  return { kind, questionnaireUrl };
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
