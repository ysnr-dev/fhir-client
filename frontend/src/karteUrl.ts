import { isKarteNoteType, type KarteCardFilter, type KarteItemKind } from "./fhir/karteTimeline";

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
/**
 * 開いた直後に右ペインで始める登録("discharge-summary:<入院の Encounter id>")。
 * 通知や入院患者一覧のリンクから登録を始めるための一回限りの引数で、KartePage が
 * 読んだら URL から消す(フォームを URL に載せない方針と両立させるため)。
 */
export const KARTE_OPEN_PARAM = "open";

/**
 * 一覧から「カルテのこのフォームを開く」ために渡す一回限りの引数。読んだら URL から消す
 * (フォームそのものは URL に載せない)。
 */
export type KarteOpenTarget =
  | { kind: "discharge-summary"; encounterId: string }
  | { kind: "radiotherapy-review"; srId: string };

export function formatKarteOpen(target: KarteOpenTarget): string {
  const id = target.kind === "discharge-summary" ? target.encounterId : target.srId;
  return `${target.kind}:${id}`;
}

export function parseKarteOpen(value: string | null): KarteOpenTarget | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator < 0) return null;
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!id) return null;
  if (kind === "discharge-summary") return { kind, encounterId: id };
  if (kind === "radiotherapy-review") return { kind, srId: id };
  return null;
}

export const KARTE_TABS = [
  { key: "karte", label: "カルテ" },
  { key: "condition", label: "病名" },
  // 患者の「現在の状態」を区画ごとに読むタブ(時系列ではない)。今は診療上の注意
  // だけで、身体・感染症・生活などの区画を後から足す。
  { key: "profile", label: "プロファイル" },
  { key: "allergy", label: "アレルギー" },
  // 入院時の持参薬。登録・鑑別・継続/中止の判断をタブの中で行う(docs/brought-medication-design.md)。
  { key: "brought-medication", label: "持参薬" },
  // 化学療法。レジメンの投与スケジュールは日付の器(暦)で見る(食事と同じ考え方)。
  { key: "chemo", label: "化学療法" },
  // クリニカルパス。適用したパスを病日 × OAT ユニットのシートで見る(紙のパスシートの形)。
  { key: "pathway", label: "クリニカルパス" },
  // 食事は「開始したら次の指示まで続く」ので、カードを日付順に読むだけでは
  // その日に何を食べているかが分かりにくい。暦の形で見るタブを別に持つ。
  { key: "meal", label: "食事" },
  // チャート。検査値・バイタル・テンプレートの数値の推移に、手術・入退院・化学療法などの
  // 実施歴を重ねて読む。項目の組み合わせは名前を付けて保存する(chart_definitions)。
  { key: "chart", label: "マルチチャート" },
  // 経過表(POMR のフローシート)。上下分割で「上にカルテ、下に経過表」と並べて
  // 読めるよう、カルテ以外のタブとして持つ。
  { key: "flowsheet", label: "経過表" },
  { key: "lab", label: "検体検査" },
  // 検体検査の時系列表示。上下分割で「上にカルテ、下に時系列」と並べて読めるよう、
  // 検体検査タブの中ではなく独立したタブとして持つ。
  { key: "lab-timeline", label: "検体検査時系列" },
  { key: "micro", label: "細菌検査" },
  { key: "patho", label: "病理検査" },
  // 看護指示(指示簿)。「今なにが有効か」を区分ごとに見る情報なので、時系列の
  // カードにはせずタブでのみ見る。
  { key: "nursing", label: "指示簿" },
  // 予約はカルテのカードにしない(タイムラインには出ない)ので、タブでのみ見る。
  { key: "appointment", label: "予約" },
  // 取り込んだファイル(紹介状・同意書・持参の検査結果など)。診療の経過そのもの
  // ではなく「患者に付いている書類の束」なので、タイムラインには出さずタブで見る。
  { key: "file", label: "ファイル" },
  // 取り込んだ DICOM(他院の CD など)。スタディ → シリーズ → 画像の階層を持ち、専用の
  // ビューアで開くので、ファイルとは別のタブにする。
  { key: "imaging", label: "DICOM" },
] as const;

export type KarteTabKey = (typeof KARTE_TABS)[number]["key"];

/**
 * タブ行で 1 つのドロップダウンにまとめるタブ。タブ自体は独立のまま
 * (URL の tab= もタブごと)で、タブ行の見た目だけを階層化する。
 * 並ぶ位置は配下の先頭のタブの位置で、メニューの順もこの keys の順。
 */
export const KARTE_TAB_GROUPS: ReadonlyArray<{ label: string; keys: readonly KarteTabKey[] }> = [
  { label: "患者情報", keys: ["profile", "allergy", "brought-medication"] },
  { label: "診療情報", keys: ["chemo", "pathway", "meal", "chart"] },
  { label: "検査結果", keys: ["lab", "lab-timeline", "micro", "patho"] },
];

/** そのタブを畳んでいるグループ。畳んでいなければ undefined。 */
export function findKarteTabGroup(key: string) {
  return KARTE_TAB_GROUPS.find((group) => (group.keys as readonly string[]).includes(key));
}

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
  | Exclude<KarteItemKind, "vital" | "pathway-evaluation">
  | "lab-result"
  | "micro-result"
  | "patho-result"
  | "rad-result";

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
  "radiotherapy-order",
  "nutrition-guidance-order",
  "consult-order",
  "lab-result",
  "micro-result",
  "patho-result",
  "rad-result",
  "qr",
];

export function formatKarteDetail(target: KarteDetailTarget): string {
  return `${target.kind}:${target.id}`;
}

// ---- 経過表の表示状態 ----
//
// 経過表は「どの週を見ているか」が読む位置そのものなので、他タブの view(開いている
// もの の id)と同じ枠に載せる。リロードで今日に戻らず、特定の週をリンクで共有できる。
// 形は「基準日[~日数][/見ている日][!]」。日数は既定(1 週間)なら省き、末尾の「!」は全画面。
// 入力途中の状態ではないので載せてよい。**基準日と日数を残す**のは、24 時間表示から
// 戻ったときに元の期間へ帰るため(見ていた日で期間を作り直すとずれる)。
// 区切りに「+」を使わないのは、クエリ文字列の「+」が空白に解釈されるため。

export interface FlowsheetView {
  /** 期間表示の基準日(表の右端)。24 時間表示のときも、戻る先として保つ。 */
  baseDate: string;
  /** 表示する日数(既定は 1 週間)。 */
  days?: number;
  /** 24 時間表示している日。無ければ期間表示。 */
  day?: string;
  fullscreen?: boolean;
}

export function parseFlowsheetView(value: string | undefined): Partial<FlowsheetView> {
  const match = /^(\d{4}-\d{2}-\d{2})(?:~(\d+))?(?:\/(\d{4}-\d{2}-\d{2}))?(!)?$/.exec(
    value ?? "",
  );
  if (!match) return {};
  return {
    baseDate: match[1],
    days: match[2] ? Number(match[2]) : undefined,
    day: match[3],
    fullscreen: Boolean(match[4]),
  };
}

/**
 * 既定の状態(今日・全画面でない)なら null を返して view を落とす
 * (URL に既定値を残さない。他タブの「何も開いていない = view 無し」と揃える)。
 */
export function formatFlowsheetView(view: FlowsheetView, today: string): string | null {
  if (view.baseDate === today && !view.days && !view.day && !view.fullscreen) return null;
  return [
    view.baseDate,
    view.days ? `~${view.days}` : "",
    view.day ? `/${view.day}` : "",
    view.fullscreen ? "!" : "",
  ].join("");
}

// ---- チャートの表示状態 ----
//
// 経過表と同じく「どこを見ているか」が読む位置そのものなので view に載せる。
// 形は「[基準日][@中心の日][~単位列数][/定義 id][o|s][n][!]」。例 "2026-09-23~m12/5on"。単位は d/m/y の 1 文字。
// 「@中心の日」はイベントを基準に前後を見ているときの、その日(各グラフに線を引き、ツールチップに日数を出す)。
// 「n」はグラフ上に数値を出している状態。
// グラフは o=まとめる / s=項目ごと で、**書いていなければ定義の設定に従う**
// (真偽値 1 文字だと「指定なし」と「まとめない」が区別できない)。
// 基準日が今日で、単位・列数が定義のままなら省く(既定値を URL に残さない)。
// 区切りに「+」を使わないのは、クエリ文字列の「+」が空白に解釈されるため。

/** チャートの横軸の単位。fhir/chartDefinitionHelpers.ts の ChartAxisUnit と対。 */
export type ChartViewUnit = "day" | "month" | "year";

const CHART_UNIT_LETTERS: Record<ChartViewUnit, string> = { day: "d", month: "m", year: "y" };
const CHART_UNIT_BY_LETTER: Record<string, ChartViewUnit> = { d: "day", m: "month", y: "year" };

export interface ChartView {
  /** 期間の右端。省略は今日。 */
  baseDate?: string;
  /** 前後を見る基準にしている日。 */
  anchor?: string;
  /** 定義の既定と違う単位を見ているときだけ入る。 */
  unit?: ChartViewUnit;
  columns?: number;
  /** 見ているチャート定義の id。 */
  chartId?: number;
  /** 全項目を 1 つのグラフに重ねて見ている。 */
  overlay?: boolean;
  /** グラフ上に数値を出している。 */
  values?: boolean;
  fullscreen?: boolean;
}

export function parseChartView(value: string | undefined): ChartView {
  const match =
    /^(\d{4}-\d{2}-\d{2})?(?:@(\d{4}-\d{2}-\d{2}))?(?:~([dmy])(\d+))?(?:\/(\d+))?([os])?(n)?(!)?$/.exec(
      value ?? "",
    );
  if (!match) return {};
  const unit = match[3] ? CHART_UNIT_BY_LETTER[match[3]] : undefined;
  return {
    baseDate: match[1],
    anchor: match[2],
    unit,
    columns: match[4] ? Number(match[4]) : undefined,
    chartId: match[5] ? Number(match[5]) : undefined,
    overlay: match[6] === "o" ? true : match[6] === "s" ? false : undefined,
    values: Boolean(match[7]),
    fullscreen: Boolean(match[8]),
  };
}

/** 何も指定が無ければ null を返して view を落とす(他タブの「何も開いていない」と揃える)。 */
export function formatChartView(view: ChartView, today: string): string | null {
  const baseDate = view.baseDate && view.baseDate !== today ? view.baseDate : "";
  const anchor = view.anchor ? `@${view.anchor}` : "";
  const axis = view.unit && view.columns ? `~${CHART_UNIT_LETTERS[view.unit]}${view.columns}` : "";
  const chart = view.chartId ? `/${view.chartId}` : "";
  const overlay = view.overlay === undefined ? "" : view.overlay ? "o" : "s";
  const values = view.values ? "n" : "";
  const full = view.fullscreen ? "!" : "";
  const formatted = `${baseDate}${anchor}${axis}${chart}${overlay}${values}${full}`;
  return formatted || null;
}

// ---- パスシートの表示状態 ----
//
// 形は「適用の id[~表示][@病日][!]」。適用が複数ある入院でどれを見ているか、日めくり(day)か
// オーバービュー(sheet)か、日めくりで開いている病日(病日の CarePlan の id)、全画面かどうか(経過表と同じ
// 末尾の「!」)。表示を省くと進行中の適用は日めくり、終わった適用はオーバービューで開く。既定ばかりなら view を落とす。

export type PathwaySheetMode = "day" | "sheet";

export interface PathwaySheetView {
  applyId?: string;
  mode?: PathwaySheetMode;
  /** 日めくりで開いている病日(病日の CarePlan の id)。 */
  eventId?: string;
  fullscreen?: boolean;
}

export function parsePathwaySheetView(value: string | undefined): PathwaySheetView {
  const match = /^([^~@!]*)(?:~(day|sheet))?(?:@([^!]*))?(!)?$/.exec(value ?? "");
  if (!match) return {};
  return {
    applyId: match[1] || undefined,
    mode: (match[2] as PathwaySheetMode | undefined) || undefined,
    eventId: match[3] || undefined,
    fullscreen: Boolean(match[4]),
  };
}

export function formatPathwaySheetView(view: PathwaySheetView): string | null {
  if (!view.applyId && !view.mode && !view.eventId && !view.fullscreen) return null;
  return [
    view.applyId ?? "",
    view.mode ? `~${view.mode}` : "",
    view.eventId ? `@${view.eventId}` : "",
    view.fullscreen ? "!" : "",
  ].join("");
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
  "radiotherapy-order",
  "nutrition-guidance-order",
  "qr",
  "pathway-evaluation",
];

export function formatKarteCard(filter: KarteCardFilter): string {
  if (filter.kind === "qr" && filter.questionnaireUrl) return `qr:${filter.questionnaireUrl}`;
  if (filter.kind === "note" && filter.noteType) return `note:${filter.noteType}`;
  return filter.kind;
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
  const rest = value.slice(separator + 1);
  if (!rest) return null;
  if (kind === "qr") return { kind, questionnaireUrl: rest };
  if (kind === "note" && isKarteNoteType(rest)) return { kind, noteType: rest };
  return null;
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
