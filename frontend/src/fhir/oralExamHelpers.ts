import type { OralExamCode } from "../api/masterClient";
import { today } from "../lib/dates";
import { transactionBundle, withVersionLock } from "./shared";

/**
 * 口腔診査情報。日本歯科医師会「口腔診査情報標準コード仕様」(JDAOES Ver.1.02、厚労省標準規格 HS034)の
 * 口腔状態スナップショットを Observation で持つ。
 *
 * 1 回の診査(スナップショット)は identifier(`ORAL_EXAM_SNAPSHOT_SYSTEM`)で束ねた次の Observation の組。
 *  - 見出し(code `snapshot`): 入力種別(NS-2)・最新初診日・最終診療日。一覧はこれを引く。
 *  - 歯(code `tooth`): 歯の診査情報レコードグループ 1 つ(歯 1 本、併存グループがあればグループごと)。
 *    歯種は bodySite(MEDIS 標準歯式)、部位(TB)・基本状態(TD)・欠損歯の内容(TM)・その他(TE)・
 *    標準プロファイル 26 項目(TF)は component。
 *  - 現在歯の内容(code `tooth-content`): TP 1 行(併存レコードがあれば行ごと)。親の歯とは
 *    歯種 + 状態コード + 部分コード + 併存グループ連番の一致で結びつける(参照は使わない)。
 *  - 口腔全体(code `mouth`): 口腔内装置等(KS)・矯正関係(KK)・その他の疾病及び異常(SI)・所見(SK)。
 *
 * component の code は「口腔診査情報 CSV 形式データから HL7 への変換仕様」の項目コード(JDAS 表 0003、
 * OBX-3 の TP11 など)、値は項目ごとのコーディングシステム(OID 表)。HL7 の OBX を 1 つずつ
 * component に写した形で、歯・併存グループ・併存レコードの束ね(OBX-4 の T/U/R)を Observation の
 * 単位で表す。
 */

export const ORAL_EXAM_SNAPSHOT_SYSTEM = "http://fhir-client.local/oral-exam-snapshot";
export const ORAL_EXAM_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/oral-exam";
/** 変換仕様の JDAS 表 0003(口腔診査項目コード)。OID が公開されていないのでローカルの URL で持つ。 */
export const JDAOES_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/jdaoes-item";
/** MEDIS 標準歯式コード(MDDF1)。 */
export const TOOTH_CODE_SYSTEM = "urn:oid:1.2.392.200119.4.1401";
const OBSERVATION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";

export type OralExamObservationKind = "snapshot" | "tooth" | "tooth-content" | "mouth";

const KIND_DISPLAY: Record<OralExamObservationKind, string> = {
  snapshot: "口腔診査情報",
  tooth: "歯の診査情報",
  "tooth-content": "現在歯の内容",
  mouth: "口腔全体の診査情報",
};

// ---- コード表 ----

export interface OralExamCodeBook {
  byItem: Map<string, OralExamCode[]>;
  find(item: string, code: string): OralExamCode | undefined;
}

export function buildOralExamCodeBook(codes: OralExamCode[]): OralExamCodeBook {
  const byItem = new Map<string, OralExamCode[]>();
  const byKey = new Map<string, OralExamCode>();
  for (const code of codes) {
    const list = byItem.get(code.item) ?? [];
    list.push(code);
    byItem.set(code.item, list);
    byKey.set(`${code.item}|${code.code}`, code);
  }
  return { byItem, find: (item, code) => byKey.get(`${item}|${code}`) };
}

/**
 * 選択肢。「該当なし」(00)は空欄で表すので外し、有効期限の切れたコード(診療報酬改定で廃止)は
 * 今選ばれているときだけ残す。
 */
export function itemOptions(book: OralExamCodeBook | undefined, item: string, current = ""): OralExamCode[] {
  return (book?.byItem.get(item) ?? []).filter(
    (c) => c.code !== "00" && (c.code === current || !c.note?.includes("有効期限")),
  );
}

export function codeDisplay(book: OralExamCodeBook | undefined, item: string, code: string): string {
  return book?.find(item, code)?.display ?? code;
}

// ---- 歯 ----

export interface ToothDef {
  /** 歯種コード(MDDF1 の 4 桁)。 */
  code: string;
  /** 1 右上 / 2 左上 / 3 左下 / 4 右下。 */
  quadrant: 1 | 2 | 3 | 4;
  /** 正中からの位置(永久歯 1〜8、乳歯 1〜5)。 */
  position: number;
  deciduous: boolean;
  /** 歯式の表記(永久歯は 1〜8、乳歯は A〜E)。 */
  label: string;
  /** 患者の右側か(画面の左に並ぶ)。 */
  right: boolean;
  upper: boolean;
}

const DECIDUOUS_LABELS = ["A", "B", "C", "D", "E"];
const QUADRANT_LABELS = { 1: "右上", 2: "左上", 3: "左下", 4: "右下" } as const;

function toothDef(quadrant: 1 | 2 | 3 | 4, position: number, deciduous: boolean): ToothDef {
  const prefix = deciduous ? 4 + quadrant : quadrant;
  return {
    code: `10${prefix}${position}`,
    quadrant,
    position,
    deciduous,
    label: deciduous ? DECIDUOUS_LABELS[position - 1] : String(position),
    right: quadrant === 1 || quadrant === 4,
    upper: quadrant === 1 || quadrant === 2,
  };
}

function range(from: number, to: number): number[] {
  const step = from <= to ? 1 : -1;
  const out: number[] = [];
  for (let n = from; n !== to + step; n += step) out.push(n);
  return out;
}

/** 歯式図の 4 行。患者の右が画面の左。 */
export const TOOTH_ROWS: { key: string; deciduous: boolean; teeth: ToothDef[] }[] = [
  {
    key: "upper",
    deciduous: false,
    teeth: [...range(8, 1).map((p) => toothDef(1, p, false)), ...range(1, 8).map((p) => toothDef(2, p, false))],
  },
  {
    key: "upper-deciduous",
    deciduous: true,
    teeth: [...range(5, 1).map((p) => toothDef(1, p, true)), ...range(1, 5).map((p) => toothDef(2, p, true))],
  },
  {
    key: "lower-deciduous",
    deciduous: true,
    teeth: [...range(5, 1).map((p) => toothDef(4, p, true)), ...range(1, 5).map((p) => toothDef(3, p, true))],
  },
  {
    key: "lower",
    deciduous: false,
    teeth: [...range(8, 1).map((p) => toothDef(4, p, false)), ...range(1, 8).map((p) => toothDef(3, p, false))],
  },
];

/** 仕様の記録順(右上遠心→右上近心、左上近心→左上遠心、右下遠心→右下近心、左下近心→左下遠心、乳歯を含む実際の並び)。 */
const TOOTH_ORDER: string[] = (() => {
  const order: string[] = [];
  const push = (q: 1 | 2 | 3 | 4, positions: number[], deciduous: boolean) =>
    positions.forEach((p) => order.push(toothDef(q, p, deciduous).code));
  push(1, range(8, 6), false);
  push(1, range(5, 1), true);
  push(1, range(5, 1), false);
  push(2, range(1, 5), false);
  push(2, range(1, 5), true);
  push(2, range(6, 8), false);
  push(4, range(8, 6), false);
  push(4, range(5, 1), true);
  push(4, range(5, 1), false);
  push(3, range(1, 5), false);
  push(3, range(1, 5), true);
  push(3, range(6, 8), false);
  return order;
})();

const SUPERNUMERARY_LETTERS = "ABCDEFGH";

/** 近傍過剰歯か(歯種コード 4 桁目が英字)。 */
export function isSupernumerary(toothCode: string): boolean {
  return /[A-H]$/.test(toothCode);
}

/** 近傍過剰歯の歯種コード(右側上顎中切歯の近傍なら 101A)。 */
export function supernumeraryCode(baseCode: string): string {
  const position = Number(baseCode.slice(3));
  return `${baseCode.slice(0, 3)}${SUPERNUMERARY_LETTERS[position - 1]}`;
}

/** 過剰歯の近傍の歯(101A → 1011)。 */
export function baseToothCode(toothCode: string): string {
  if (!isSupernumerary(toothCode)) return toothCode;
  return `${toothCode.slice(0, 3)}${SUPERNUMERARY_LETTERS.indexOf(toothCode[3]) + 1}`;
}

export function isDeciduous(toothCode: string): boolean {
  return /^10[5-8]/.test(toothCode);
}

export function toothDefOf(toothCode: string): ToothDef | undefined {
  const base = baseToothCode(toothCode);
  for (const row of TOOTH_ROWS) {
    const found = row.teeth.find((t) => t.code === base);
    if (found) return found;
  }
  return undefined;
}

/** 「右上6」「左下E」「右上1 過剰歯」。 */
export function toothLabel(toothCode: string): string {
  const def = toothDefOf(toothCode);
  if (!def) return toothCode;
  const base = `${QUADRANT_LABELS[def.quadrant]}${def.label}`;
  return isSupernumerary(toothCode) ? `${base} 過剰歯` : base;
}

function toothSortKey(toothCode: string): number {
  const index = TOOTH_ORDER.indexOf(baseToothCode(toothCode));
  return (index < 0 ? 999 : index) * 2 + (isSupernumerary(toothCode) ? 1 : 0);
}

// ---- 歯の基本状態(TD-2) ----

export type ToothCategory =
  | "sound"
  | "present"
  | "observe"
  | "caries"
  | "treated"
  | "caution"
  | "impacted"
  | "missing"
  | "prosthetic"
  | "implant"
  | "unknown";

/** 歯式図の色分け。 */
export function toothCategory(basic: string): ToothCategory {
  const n = Number(basic);
  if (basic === "02" || basic === "03") return "sound";
  if (basic === "04" || basic === "05") return "observe";
  if (basic === "06" || basic === "07" || basic === "08") return "caries";
  if (basic === "09" || basic === "10") return "treated";
  if (basic === "11") return "caution";
  if (n >= 30 && n <= 37) return "impacted";
  if (n >= 56 && n <= 61) return "prosthetic";
  if (n >= 62 && n <= 66) return "implant";
  if (n >= 50 && n <= 69) return "missing";
  if (basic === "98" || basic === "99") return "unknown";
  return "present";
}

/**
 * 欠損歯の内容(TM)を書く歯か。現在歯の内容(TP)とは排他。インプラントは基本状態は欠損歯だが、
 * アバットメント・上部構造は現在歯の内容に書く(仕様 4. 注意事項 2)。
 */
export function usesMissingContent(basic: string): boolean {
  const n = Number(basic);
  return n >= 50 && n <= 69 && !(n >= 62 && n <= 66);
}

/** 基本状態(TD-2)→ 歯科健診記号(TD-3)。コード表 TD-3 の備考どおり。 */
export function checkupSymbolCode(basic: string): string {
  const n = Number(basic);
  if (["01", "02", "12", "13"].includes(basic)) return "01";
  if (basic === "06" || basic === "08") return "02";
  if (basic === "09" || basic === "10") return "03";
  if ((n >= 50 && n <= 55) || n === 67 || n === 68 || n === 69) return "04";
  if (n >= 56 && n <= 66) return "05";
  if (basic === "03") return "06";
  if (basic === "05" || basic === "07") return "07";
  if (basic === "04") return "08";
  if (basic === "11") return "09";
  if (basic === "30" || basic === "31" || basic === "37") return "10";
  if (n >= 32 && n <= 36) return "11";
  if (basic === "98" || basic === "99") return basic;
  return "";
}

const CHECKUP_SYMBOLS: Record<string, string> = {
  "01": "／",
  "02": "C",
  "03": "○",
  "04": "△",
  "05": "(△)",
  "06": "シ",
  "07": "サ",
  "08": "CO",
  "09": "×",
};

/** 歯式図に添える健診記号。 */
export function checkupSymbol(basic: string): string {
  return CHECKUP_SYMBOLS[checkupSymbolCode(basic)] ?? "";
}

/** 基本状態から決まる状態コード(TB-3)の既定値。 */
export function defaultStateCode(basic: string): string {
  const n = Number(basic);
  if (basic === "08" || basic === "09") return "6";
  if (n >= 62 && n <= 66) return "7";
  if (n >= 50 && n <= 69) return "2";
  return "0";
}

// ---- 項目 ----

export interface ItemDef {
  item: string;
  label: string;
  /** 自由記載(valueString)。 */
  text?: boolean;
  /** 歯式(複数の歯)。 */
  teeth?: boolean;
}

/** 現在歯の内容(TP)で常に出す項目。 */
export const TP_MAIN_ITEMS: ItemDef[] = [
  { item: "TP-3", label: "生活歯・失活歯" },
  { item: "TP-9", label: "未処置歯" },
  { item: "TP-11", label: "部分修復" },
  { item: "TP-12", label: "窩洞形態" },
  { item: "TP-21", label: "全部修復" },
  { item: "TP-22", label: "その他修復" },
  { item: "TP-10", label: "テンポラリー" },
  { item: "TP-23", label: "連結冠・ブリッジ支台" },
  { item: "TP-24", label: "連結冠・ブリッジ番号" },
];

/** 歯面(切端・咬合面 IO / 唇側・頬側 B / 口蓋側・舌側 PL / 近心 M / 遠心 D)。 */
export const TP_SURFACE_ITEMS = [
  { item: "TP-13", label: "IO", name: "切端・咬合面" },
  { item: "TP-14", label: "B", name: "唇側面・頬側面" },
  { item: "TP-15", label: "PL", name: "口蓋側面・舌側面" },
  { item: "TP-16", label: "M", name: "近心面" },
  { item: "TP-17", label: "D", name: "遠心面" },
] as const;

/** 歯の主な部位(歯冠部・歯頚部はあり/なし、歯根部は歯根部/根尖部)。 */
export const TP_PART_ITEMS: ItemDef[] = [
  { item: "TP-18", label: "歯冠部" },
  { item: "TP-19", label: "歯頚部" },
  { item: "TP-20", label: "歯根部" },
];

/** 現在歯の内容のうち、畳んでおく項目。 */
export const TP_MORE_ITEMS: ItemDef[] = [
  { item: "TP-4", label: "萌出異常" },
  { item: "TP-5", label: "位置異常" },
  { item: "TP-6", label: "歯根の分割" },
  { item: "TP-7", label: "形態異常・形成異常" },
  { item: "TP-8", label: "過剰歯" },
  { item: "TP-25", label: "レストシート" },
  { item: "TP-26", label: "クラスプ" },
  { item: "TP-27", label: "固定式矯正装置" },
  { item: "TP-28", label: "暫間固定" },
  { item: "TP-29", label: "歯肉の状態" },
  { item: "TP-30", label: "歯石沈着" },
  { item: "TP-31", label: "歯根のう胞" },
  { item: "TP-32", label: "ろう孔" },
  { item: "TP-33", label: "骨瘤" },
  { item: "TP-34", label: "複数義歯番号連携" },
];

export const TP_ITEMS: string[] = [
  ...TP_MAIN_ITEMS.map((d) => d.item),
  ...TP_SURFACE_ITEMS.map((d) => d.item),
  ...TP_PART_ITEMS.map((d) => d.item),
  ...TP_MORE_ITEMS.map((d) => d.item),
];

export const TM_MAIN_ITEMS: ItemDef[] = [
  { item: "TM-2", label: "ポンティック" },
  { item: "TM-3", label: "ブリッジ番号" },
  { item: "TM-4", label: "有床義歯" },
  { item: "TM-6", label: "義歯人工歯" },
];

export const TM_MORE_ITEMS: ItemDef[] = [
  { item: "TM-5", label: "複数義歯番号" },
  { item: "TM-7", label: "義歯補綴隙" },
  { item: "TM-8", label: "義歯大連結子" },
  { item: "TM-9", label: "補強線" },
  { item: "TM-10", label: "骨瘤" },
  { item: "TM-11", label: "アタッチメント" },
  { item: "TM-12", label: "歯根の抜去" },
];

export const TM_ITEMS: string[] = [...TM_MAIN_ITEMS, ...TM_MORE_ITEMS].map((d) => d.item);

/** 口腔全体。区分(KS など)ごとに並べる。「有無」の項目(KK-2 など)は中身から決める。 */
export const MOUTH_SECTIONS: { record: string; label: string; items: ItemDef[] }[] = [
  {
    record: "KS",
    label: "口腔内装置等",
    items: [
      { item: "KS-2", label: "口腔内装置等" },
      { item: "KS-4", label: "部位(歯式)", teeth: true },
      { item: "KS-3", label: "部位等", text: true },
      { item: "KS-5", label: "製品情報", text: true },
    ],
  },
  {
    record: "KK",
    label: "矯正関係",
    items: [
      { item: "KK-3", label: "歯列の異常" },
      { item: "KK-4", label: "咬合関係の異常" },
      { item: "KK-5", label: "唇顎口蓋裂" },
      { item: "KK-6", label: "矯正装置" },
      { item: "KK-8", label: "その他の矯正情報", text: true },
      { item: "KK-9", label: "その他の矯正情報(歯式)", teeth: true },
    ],
  },
  {
    record: "SI",
    label: "その他の疾病及び異常",
    items: [
      { item: "SI-3", label: "小帯の異常" },
      { item: "SI-4", label: "骨瘤" },
      { item: "SI-5", label: "骨瘤(歯式)", teeth: true },
      { item: "SI-6", label: "口蓋隆起" },
      { item: "SI-7", label: "その他の疾病及び異常", text: true },
      { item: "SI-8", label: "その他の疾病及び異常(歯式)", teeth: true },
    ],
  },
  {
    record: "SK",
    label: "所見・特記事項",
    items: [
      { item: "SK-3", label: "所見・特記事項", text: true },
      { item: "SK-4", label: "所見・特記事項(歯式)", teeth: true },
    ],
  },
];

/** 区分の「有無」項目(中身があれば 01)。 */
const MOUTH_PRESENCE_ITEM: Record<string, string> = { KK: "KK-2", SI: "SI-2", SK: "SK-2" };

export const MOUTH_ITEM_DEFS: ItemDef[] = MOUTH_SECTIONS.flatMap((s) => s.items);

/** 入力種別(NS-2)の既定値。 */
export const INPUT_TYPE_FIRST_VISIT = "01";
export const INPUT_TYPE_UPDATE = "02";

// ---- 画面の値 ----

export interface ToothContent {
  /** React の key(保存しない)。 */
  key: string;
  /** TP-3〜TP-34 の項目 → コード。空欄の項目は持たない。 */
  values: Record<string, string>;
}

/** 歯の診査情報レコードグループ 1 つ。 */
export interface ToothRecord {
  key: string;
  toothCode: string;
  /** 状態コード(TB-3)。 */
  stateCode: string;
  /** 部分コード(TB-4)。 */
  partCode: string;
  /** 歯の基本状態(TD-2)。 */
  basic: string;
  /** 現在歯の内容(TP)。 */
  contents: ToothContent[];
  /** 欠損歯の内容(TM-2〜TM-12)。 */
  missing: Record<string, string>;
  /** 当該歯製品識別情報の有無(TE-2)・製品名(TE-3)・製造番号等(TE-4)・特記事項(TE-6)。 */
  productKind: string;
  productName: string;
  productNumber: string;
  remark: string;
}

export interface MouthRecord {
  /** コードの項目(KS-2 など)。 */
  values: Record<string, string>;
  /** 自由記載の項目(KS-3 など)。 */
  texts: Record<string, string>;
  /** 歯式の項目(KS-4 など)→ 歯種コード。 */
  teeth: Record<string, string[]>;
}

export interface OralExamSnapshot {
  /** identifier の値。新規はここで決めて保存する。 */
  snapshotId: string;
  /** 見出しの Observation の id。新規は無い。 */
  headerId?: string;
  examDate: string;
  /** 入力種別(NS-2)。 */
  inputType: string;
  /** 最新初診年月日(NS-3)。 */
  firstVisitDate: string;
  /** 最終診療年月日(NS-4)。 */
  lastVisitDate: string;
  note: string;
  performer?: fhir4.Reference;
  teeth: ToothRecord[];
  mouth: MouthRecord;
}

let draftSeq = 0;
export function draftKey(): string {
  draftSeq += 1;
  return `oral-${draftSeq}`;
}

export function emptyMouth(): MouthRecord {
  return { values: {}, texts: {}, teeth: {} };
}

export function emptyContent(): ToothContent {
  return { key: draftKey(), values: {} };
}

export function newToothRecord(toothCode: string, basic: string): ToothRecord {
  return {
    key: draftKey(),
    toothCode,
    stateCode: defaultStateCode(basic),
    partCode: "0",
    basic,
    contents: [],
    missing: {},
    productKind: "",
    productName: "",
    productNumber: "",
    remark: "",
  };
}

export function emptyOralExamSnapshot(): OralExamSnapshot {
  const date = today();
  return {
    snapshotId: crypto.randomUUID(),
    examDate: date,
    inputType: INPUT_TYPE_FIRST_VISIT,
    firstVisitDate: date,
    lastVisitDate: date,
    note: "",
    teeth: [],
    mouth: emptyMouth(),
  };
}

/** 前回の診査を写した新しい診査(治療による更新)。歯と口腔全体を引き継ぎ、日付は今日にする。 */
export function copySnapshotForNew(previous: OralExamSnapshot): OralExamSnapshot {
  return {
    snapshotId: crypto.randomUUID(),
    examDate: today(),
    inputType: INPUT_TYPE_UPDATE,
    firstVisitDate: previous.firstVisitDate,
    lastVisitDate: today(),
    note: "",
    teeth: previous.teeth.map((tooth) => ({
      ...tooth,
      key: draftKey(),
      contents: tooth.contents.map((content) => ({ key: draftKey(), values: { ...content.values } })),
      missing: { ...tooth.missing },
    })),
    mouth: {
      values: { ...previous.mouth.values },
      texts: { ...previous.mouth.texts },
      teeth: Object.fromEntries(Object.entries(previous.mouth.teeth).map(([k, v]) => [k, [...v]])),
    },
  };
}

/** 歯ごとの記録(併存グループの順)。 */
export function recordsOfTooth(teeth: ToothRecord[], toothCode: string): ToothRecord[] {
  return teeth.filter((t) => t.toothCode === toothCode);
}

export function sortTeeth(teeth: ToothRecord[]): ToothRecord[] {
  return teeth
    .map((tooth, index) => ({ tooth, index }))
    .sort((a, b) => toothSortKey(a.tooth.toothCode) - toothSortKey(b.tooth.toothCode) || a.index - b.index)
    .map(({ tooth }) => tooth);
}

/** 歯種コードを記録順に並べる。 */
export function sortToothCodes(codes: string[]): string[] {
  return [...codes].sort((a, b) => toothSortKey(a) - toothSortKey(b));
}

/** 現在歯の内容で塗る歯面(TP-13〜17 のどれかに 01 がある面)。 */
export function filledSurfaces(records: ToothRecord[]): Set<string> {
  const surfaces = new Set<string>();
  for (const record of records) {
    if (usesMissingContent(record.basic)) continue;
    for (const content of record.contents) {
      for (const surface of TP_SURFACE_ITEMS) {
        if (content.values[surface.item]) surfaces.add(surface.item);
      }
    }
  }
  return surfaces;
}

// ---- 標準プロファイル 26 項目(TF) ----

function tfNumber(ref: string | null | undefined): number | null {
  const n = Number(ref?.replace("TF-", ""));
  return Number.isFinite(n) && n >= 3 && n <= 28 ? n : null;
}

/**
 * 標準プロファイル 26 項目を、選んだコードの対応 TF(コード表の備考〔TF-n〕)から導く。
 * 乳歯は TF-3。TF-3〜TF-26 のどれかがあれば TF-27(歯あり・状態不明)は落とし、
 * TF-3〜TF-27 のどれかがあれば TF-28(情報なし)は落とす(仕様の排他関係表)。
 */
export function deriveTf(record: ToothRecord, book: OralExamCodeBook | undefined): number[] {
  const found = new Set<number>();
  const add = (item: string, code: string) => {
    const n = tfNumber(book?.find(item, code)?.tf_ref);
    if (n) found.add(n);
  };
  if (isDeciduous(record.toothCode)) found.add(3);
  add("TB-3", record.stateCode);
  add("TD-2", record.basic);
  if (usesMissingContent(record.basic)) {
    for (const [item, code] of Object.entries(record.missing)) add(item, code);
  } else {
    for (const content of record.contents) {
      for (const [item, code] of Object.entries(content.values)) add(item, code);
    }
  }
  if ([...found].some((n) => n <= 26)) found.delete(27);
  if ([...found].some((n) => n <= 27)) found.delete(28);
  return [...found].sort((a, b) => a - b);
}

/** TF 項目の略称(FMC など)。 */
export function tfLabel(book: OralExamCodeBook | undefined, n: number): string {
  const display = book?.find(`TF-${n}`, "01")?.display ?? `TF-${n}`;
  return display.split("・").pop() ?? display;
}

// ---- 集計 ----

export interface OralExamCounts {
  present: number;
  caries: number;
  treated: number;
  missing: number;
}

/** 現在歯・未処置歯・処置歯・喪失歯の本数。歯ごとに最初の併存グループで数え、過剰歯は数えない。 */
export function countTeeth(teeth: ToothRecord[]): OralExamCounts {
  const counts: OralExamCounts = { present: 0, caries: 0, treated: 0, missing: 0 };
  const seen = new Set<string>();
  for (const tooth of teeth) {
    if (seen.has(tooth.toothCode) || isSupernumerary(tooth.toothCode)) continue;
    seen.add(tooth.toothCode);
    const category = toothCategory(tooth.basic);
    if (["sound", "present", "observe", "caries", "treated", "caution"].includes(category)) counts.present += 1;
    if (category === "caries") counts.caries += 1;
    if (category === "treated") counts.treated += 1;
    if (category === "missing" || category === "prosthetic" || category === "implant") counts.missing += 1;
  }
  return counts;
}

// ---- Observation の組み立て ----

function itemCode(item: string): string {
  return item.replace("-", "");
}

function itemConcept(item: string, book: OralExamCodeBook | undefined, label?: string): fhir4.CodeableConcept {
  const display = label ?? book?.byItem.get(item)?.[0]?.item_name ?? item;
  return { coding: [{ system: JDAOES_ITEM_SYSTEM, code: itemCode(item), display: display ?? undefined }] };
}

function codedComponent(
  item: string,
  code: string,
  book: OralExamCodeBook | undefined,
): fhir4.ObservationComponent {
  const entry = book?.find(item, code);
  const system = entry?.cs_oid ? `urn:oid:${entry.cs_oid}` : undefined;
  return {
    code: itemConcept(item, book),
    valueCodeableConcept: { coding: [{ system, code, display: entry?.display }] },
  };
}

function textComponent(item: string, text: string, book: OralExamCodeBook | undefined): fhir4.ObservationComponent {
  return { code: itemConcept(item, book), valueString: text };
}

function toothComponent(
  item: string,
  toothCode: string,
  book: OralExamCodeBook | undefined,
): fhir4.ObservationComponent {
  // 歯式の項目は 6 桁の歯式コード(歯種 4 桁 + 状態 0 現存歯 + 部分 0 指定なし)。
  return {
    code: itemConcept(item, book),
    valueCodeableConcept: {
      coding: [{ system: TOOTH_CODE_SYSTEM, code: `${toothCode}00`, display: toothLabel(toothCode) }],
    },
  };
}

function kindConcept(kind: OralExamObservationKind): fhir4.CodeableConcept {
  return {
    coding: [{ system: ORAL_EXAM_CODE_SYSTEM, code: kind, display: KIND_DISPLAY[kind] }],
    text: KIND_DISPLAY[kind],
  };
}

function bodySiteOf(toothCode: string, book: OralExamCodeBook | undefined): fhir4.CodeableConcept {
  const display = book?.find("TB-2", toothCode)?.display;
  return { coding: [{ system: TOOTH_CODE_SYSTEM, code: toothCode, display }], text: toothLabel(toothCode) };
}

/** 2 桁の連番(併存グループ・併存レコード)。1 つだけなら付けない。 */
function seqOf(index: number, total: number): string {
  return total > 1 ? String(index + 1).padStart(2, "0") : "";
}

interface BuildContext {
  patientId: string;
  book: OralExamCodeBook | undefined;
}

function baseObservation(
  snapshot: OralExamSnapshot,
  kind: OralExamObservationKind,
  { patientId }: BuildContext,
): fhir4.Observation {
  return {
    resourceType: "Observation",
    status: "final",
    identifier: [{ system: ORAL_EXAM_SNAPSHOT_SYSTEM, value: snapshot.snapshotId }],
    category: [{ coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: "exam", display: "Exam" }] }],
    code: kindConcept(kind),
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: snapshot.examDate,
    ...(snapshot.performer ? { performer: [snapshot.performer] } : {}),
  };
}

function groupKeyComponents(
  tooth: ToothRecord,
  groupSeq: string,
  book: OralExamCodeBook | undefined,
): fhir4.ObservationComponent[] {
  return [
    codedComponent("TB-3", tooth.stateCode || "0", book),
    codedComponent("TB-4", tooth.partCode || "0", book),
    ...(groupSeq ? [codedComponent("TB-5", groupSeq, book)] : []),
  ];
}

function buildHeader(snapshot: OralExamSnapshot, context: BuildContext): fhir4.Observation {
  const { book } = context;
  const component: fhir4.ObservationComponent[] = [codedComponent("NS-2", snapshot.inputType, book)];
  if (snapshot.firstVisitDate) {
    component.push({ code: itemConcept("NS-3", book, "最新初診年月日"), valueDateTime: snapshot.firstVisitDate });
  }
  if (snapshot.lastVisitDate) {
    component.push({ code: itemConcept("NS-4", book, "最終診療年月日"), valueDateTime: snapshot.lastVisitDate });
  }
  return {
    ...baseObservation(snapshot, "snapshot", context),
    ...(snapshot.headerId ? { id: snapshot.headerId } : {}),
    component,
    ...(snapshot.note.trim() ? { note: [{ text: snapshot.note.trim() }] } : {}),
  };
}

function buildTooth(
  snapshot: OralExamSnapshot,
  tooth: ToothRecord,
  groupSeq: string,
  context: BuildContext,
): fhir4.Observation[] {
  const { book } = context;
  const bodySite = bodySiteOf(tooth.toothCode, book);
  const keyComponents = groupKeyComponents(tooth, groupSeq, book);
  const component: fhir4.ObservationComponent[] = [...keyComponents, codedComponent("TD-2", tooth.basic, book)];
  const symbol = checkupSymbolCode(tooth.basic);
  if (symbol) component.push(codedComponent("TD-3", symbol, book));

  const missing = usesMissingContent(tooth.basic);
  if (missing) {
    for (const item of TM_ITEMS) {
      const code = tooth.missing[item];
      if (code) component.push(codedComponent(item, code, book));
    }
  }

  if (tooth.productKind) component.push(codedComponent("TE-2", tooth.productKind, book));
  if (tooth.productName.trim()) component.push(textComponent("TE-3", tooth.productName.trim(), book));
  if (tooth.productNumber.trim()) component.push(textComponent("TE-4", tooth.productNumber.trim(), book));
  if (tooth.remark.trim()) {
    component.push(codedComponent("TE-5", "01", book));
    component.push(textComponent("TE-6", tooth.remark.trim(), book));
  }

  const tf = deriveTf(tooth, book);
  if (tf.length) component.push(codedComponent("TF-2", "01", book));
  for (const n of tf) component.push(codedComponent(`TF-${n}`, "01", book));

  const observations: fhir4.Observation[] = [
    { ...baseObservation(snapshot, "tooth", context), bodySite, component },
  ];

  if (!missing) {
    const contents = tooth.contents.filter((c) => Object.values(c.values).some(Boolean));
    contents.forEach((content, index) => {
      const recordSeq = seqOf(index, contents.length);
      const contentComponents: fhir4.ObservationComponent[] = [
        ...keyComponents,
        ...(recordSeq ? [codedComponent("TP-2", recordSeq, book)] : []),
      ];
      for (const item of TP_ITEMS) {
        const code = content.values[item];
        if (code) contentComponents.push(codedComponent(item, code, book));
      }
      observations.push({
        ...baseObservation(snapshot, "tooth-content", context),
        bodySite,
        component: contentComponents,
      });
    });
  }
  return observations;
}

function buildMouth(snapshot: OralExamSnapshot, context: BuildContext): fhir4.Observation | null {
  const { book } = context;
  const { values, texts, teeth } = snapshot.mouth;
  const component: fhir4.ObservationComponent[] = [];
  for (const section of MOUTH_SECTIONS) {
    const parts: fhir4.ObservationComponent[] = [];
    for (const def of section.items) {
      if (def.teeth) {
        for (const toothCode of teeth[def.item] ?? []) parts.push(toothComponent(def.item, toothCode, book));
      } else if (def.text) {
        const text = texts[def.item]?.trim();
        if (text) parts.push(textComponent(def.item, text, book));
      } else if (values[def.item]) {
        parts.push(codedComponent(def.item, values[def.item], book));
      }
    }
    const presence = MOUTH_PRESENCE_ITEM[section.record];
    if (parts.length && presence) component.push(codedComponent(presence, "01", book));
    if (section.record === "KK" && (texts["KK-8"]?.trim() || teeth["KK-9"]?.length)) {
      component.push(codedComponent("KK-7", "01", book));
    }
    component.push(...parts);
  }
  if (!component.length) return null;
  return { ...baseObservation(snapshot, "mouth", context), component };
}

/** 見出しと子(歯・現在歯の内容・口腔全体)の Observation。 */
export function buildOralExamObservations(
  snapshot: OralExamSnapshot,
  patientId: string,
  book: OralExamCodeBook | undefined,
): { header: fhir4.Observation; children: fhir4.Observation[] } {
  const context = { patientId, book };
  const children: fhir4.Observation[] = [];
  const teeth = sortTeeth(snapshot.teeth.filter((t) => t.basic));
  const byTooth = new Map<string, ToothRecord[]>();
  for (const tooth of teeth) byTooth.set(tooth.toothCode, [...(byTooth.get(tooth.toothCode) ?? []), tooth]);
  for (const records of byTooth.values()) {
    records.forEach((tooth, index) => {
      children.push(...buildTooth(snapshot, tooth, seqOf(index, records.length), context));
    });
  }
  const mouth = buildMouth(snapshot, context);
  if (mouth) children.push(mouth);
  return { header: buildHeader(snapshot, context), children };
}

/**
 * 保存の transaction。見出しは新規なら POST、編集なら読んだ版で PUT(楽観ロック。子の作り直しも
 * 含めて、見出しの版でスナップショット全体の競合を見る)。子は前回のものを消して作り直す
 * (歯の追加・削除や併存グループの組み替えで対応付けが崩れないように)。
 */
export function oralExamSaveBundle(
  header: fhir4.Observation,
  children: fhir4.Observation[],
  loaded?: { header: fhir4.Observation; childIds: string[] },
): fhir4.Bundle {
  const entries: fhir4.BundleEntry[] = [
    ...(loaded?.childIds ?? []).map((id) => ({ request: { method: "DELETE" as const, url: `Observation/${id}` } })),
    header.id
      ? { resource: header, request: { method: "PUT" as const, url: `Observation/${header.id}` } }
      : { fullUrl: `urn:uuid:${crypto.randomUUID()}`, resource: header, request: { method: "POST" as const, url: "Observation" } },
    ...children.map((resource) => ({
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource,
      request: { method: "POST" as const, url: "Observation" },
    })),
  ];
  return withVersionLock(transactionBundle(entries), loaded?.header);
}

export function oralExamDeleteBundle(ids: string[]): fhir4.Bundle {
  return transactionBundle(ids.map((id) => ({ request: { method: "DELETE" as const, url: `Observation/${id}` } })));
}

// ---- 読み戻し ----

export function snapshotIdOf(observation: fhir4.Observation): string {
  return observation.identifier?.find((i) => i.system === ORAL_EXAM_SNAPSHOT_SYSTEM)?.value ?? "";
}

export function oralExamKindOf(observation: fhir4.Observation): OralExamObservationKind | "" {
  const code = observation.code?.coding?.find((c) => c.system === ORAL_EXAM_CODE_SYSTEM)?.code ?? "";
  return code === "snapshot" || code === "tooth" || code === "tooth-content" || code === "mouth" ? code : "";
}

function componentsOf(observation: fhir4.Observation, item: string): fhir4.ObservationComponent[] {
  const code = itemCode(item);
  return (observation.component ?? []).filter((c) =>
    c.code?.coding?.some((coding) => coding.system === JDAOES_ITEM_SYSTEM && coding.code === code),
  );
}

function codeOfItem(observation: fhir4.Observation, item: string): string {
  return componentsOf(observation, item)[0]?.valueCodeableConcept?.coding?.[0]?.code ?? "";
}

function stringOfItem(observation: fhir4.Observation, item: string): string {
  return componentsOf(observation, item)[0]?.valueString ?? "";
}

function dateOfItem(observation: fhir4.Observation, item: string): string {
  return componentsOf(observation, item)[0]?.valueDateTime?.slice(0, 10) ?? "";
}

function toothCodeOf(observation: fhir4.Observation): string {
  return observation.bodySite?.coding?.find((c) => c.system === TOOTH_CODE_SYSTEM)?.code ?? "";
}

function groupKeyOf(observation: fhir4.Observation): string {
  return [
    toothCodeOf(observation),
    codeOfItem(observation, "TB-3"),
    codeOfItem(observation, "TB-4"),
    codeOfItem(observation, "TB-5"),
  ].join("|");
}

export interface OralExamSnapshotSummary {
  headerId: string;
  snapshotId: string;
  examDate: string;
  inputType: string;
  performer: string;
}

export function summarizeOralExamHeader(header: fhir4.Observation): OralExamSnapshotSummary {
  return {
    headerId: header.id ?? "",
    snapshotId: snapshotIdOf(header),
    examDate: header.effectiveDateTime?.slice(0, 10) ?? "",
    inputType: codeOfItem(header, "NS-2"),
    performer: header.performer?.[0]?.display ?? "",
  };
}

/** identifier で引いた 1 回の診査の Observation を、画面の値に戻す。見出しが無ければ null。 */
export function parseOralExamSnapshot(observations: fhir4.Observation[]): OralExamSnapshot | null {
  const header = observations.find((o) => oralExamKindOf(o) === "snapshot");
  if (!header) return null;

  const contentsByGroup = new Map<string, fhir4.Observation[]>();
  for (const observation of observations) {
    if (oralExamKindOf(observation) !== "tooth-content") continue;
    const key = groupKeyOf(observation);
    contentsByGroup.set(key, [...(contentsByGroup.get(key) ?? []), observation]);
  }

  const teeth: ToothRecord[] = observations
    .filter((o) => oralExamKindOf(o) === "tooth")
    .sort((a, b) => codeOfItem(a, "TB-5").localeCompare(codeOfItem(b, "TB-5")))
    .map((observation) => {
      const contents = (contentsByGroup.get(groupKeyOf(observation)) ?? [])
        .sort((a, b) => codeOfItem(a, "TP-2").localeCompare(codeOfItem(b, "TP-2")))
        .map((content) => {
          const values: Record<string, string> = {};
          for (const item of TP_ITEMS) {
            const code = codeOfItem(content, item);
            if (code) values[item] = code;
          }
          return { key: draftKey(), values };
        });
      const missing: Record<string, string> = {};
      for (const item of TM_ITEMS) {
        const code = codeOfItem(observation, item);
        if (code) missing[item] = code;
      }
      return {
        key: draftKey(),
        toothCode: toothCodeOf(observation),
        stateCode: codeOfItem(observation, "TB-3") || "0",
        partCode: codeOfItem(observation, "TB-4") || "0",
        basic: codeOfItem(observation, "TD-2"),
        contents,
        missing,
        productKind: codeOfItem(observation, "TE-2"),
        productName: stringOfItem(observation, "TE-3"),
        productNumber: stringOfItem(observation, "TE-4"),
        remark: stringOfItem(observation, "TE-6"),
      };
    })
    .filter((t) => t.toothCode);

  const mouth = emptyMouth();
  const mouthObservation = observations.find((o) => oralExamKindOf(o) === "mouth");
  if (mouthObservation) {
    for (const def of MOUTH_ITEM_DEFS) {
      if (def.teeth) {
        const codes = componentsOf(mouthObservation, def.item)
          .map((c) => c.valueCodeableConcept?.coding?.[0]?.code?.slice(0, 4) ?? "")
          .filter(Boolean);
        if (codes.length) mouth.teeth[def.item] = codes;
      } else if (def.text) {
        const text = stringOfItem(mouthObservation, def.item);
        if (text) mouth.texts[def.item] = text;
      } else {
        const code = codeOfItem(mouthObservation, def.item);
        if (code) mouth.values[def.item] = code;
      }
    }
  }

  return {
    snapshotId: snapshotIdOf(header),
    headerId: header.id,
    examDate: header.effectiveDateTime?.slice(0, 10) ?? "",
    inputType: codeOfItem(header, "NS-2"),
    firstVisitDate: dateOfItem(header, "NS-3"),
    lastVisitDate: dateOfItem(header, "NS-4"),
    note: header.note?.[0]?.text ?? "",
    performer: header.performer?.[0],
    teeth: sortTeeth(teeth),
    mouth,
  };
}

// ---- 材料(当該歯特記事項 TE-6) ----

/**
 * 修復・補綴の材料。仕様のコードは見た目の色(銀色・黒色・金色・歯冠色)までで合金名を持たないので、
 * 配布の「口腔状態モデルケースとコード化例」と同じく特記事項(TE-6)の先頭に材料名を書く。
 * 表記はモデルケースに合わせる(照合で表記がそろっていることが大事なため)。
 * color は金属の色。選ぶと修復コードの色をそれに合わせる。
 */
export const ORAL_EXAM_MATERIALS: { name: string; color?: MetalColor }[] = [
  { name: "金銀パラジウム", color: "銀色" },
  { name: "銀合金", color: "銀色" },
  { name: "金合金", color: "金色" },
  { name: "チタン", color: "銀色" },
  { name: "コバルトクロム", color: "銀色" },
  { name: "金床" },
  { name: "CAD/CAM冠用材料" },
  { name: "ハイブリッドレジン" },
  { name: "硬質レジン" },
  { name: "コンポジットレジン" },
  { name: "グラスアイオノマー" },
  { name: "セラミック" },
  { name: "ジルコニア" },
  { name: "ファイバーポスト" },
];

export type MetalColor = "銀色" | "黒色" | "金色";

const MATERIAL_SEPARATOR = "、";

/** 特記事項の先頭にある材料名(無ければ空)。 */
export function materialOf(remark: string): string {
  return (
    ORAL_EXAM_MATERIALS.find(
      (m) => remark === m.name || remark.startsWith(`${m.name}${MATERIAL_SEPARATOR}`),
    )?.name ?? ""
  );
}

/** 特記事項の先頭の材料名を差し替える(材料の後ろの自由記載は残す)。 */
export function withMaterial(remark: string, material: string): string {
  const current = materialOf(remark);
  const rest = current ? remark.slice(current.length).replace(/^、/, "") : remark;
  if (!material) return rest;
  return rest ? `${material}${MATERIAL_SEPARATOR}${rest}` : material;
}

const METAL_COLORS: MetalColor[] = ["銀色", "黒色", "金色"];

/**
 * 修復・補綴のコードを同じ種類の別の色のコードに置き換える(銀色 → 金色など)。
 * コード表で色だけが違う名称のコードを探し、無ければそのまま。
 */
function recolorCode(book: OralExamCodeBook | undefined, item: string, code: string, color: MetalColor): string {
  const display = book?.find(item, code)?.display;
  const current = METAL_COLORS.find((c) => display?.includes(c));
  if (!display || !current || current === color) return code;
  const target = display.replace(current, color);
  return book?.byItem.get(item)?.find((c) => c.display === target)?.code ?? code;
}

/** 歯の材料を変える。特記事項の材料名を差し替え、金属の色をその材料に合わせる。 */
export function applyMaterial(
  record: ToothRecord,
  material: string,
  book: OralExamCodeBook | undefined,
): ToothRecord {
  const color = ORAL_EXAM_MATERIALS.find((m) => m.name === material)?.color;
  const recolor = (values: Record<string, string>) =>
    color
      ? Object.fromEntries(Object.entries(values).map(([item, code]) => [item, recolorCode(book, item, code, color)]))
      : values;
  return {
    ...record,
    remark: withMaterial(record.remark, material),
    contents: record.contents.map((c) => ({ ...c, values: recolor(c.values) })),
    missing: recolor(record.missing),
  };
}

// ---- スタンプ(歯式図に押して入れる、よく使う状態) ----

export type StampGroup = "state" | "caries" | "restoration" | "prosthesis";

export interface OralExamStamp {
  key: string;
  /** パレットの表記。 */
  label: string;
  /** パレットのツールチップ(コード表の名称)。 */
  title: string;
  group: StampGroup;
  /** 歯の基本状態(TD-2)を決め打ちするスタンプ。現在歯の内容・欠損歯の内容は置き換える。 */
  basic?: string;
  stateCode?: string;
  /** 現在歯の内容(TP)に足す値。先頭の項目がその内容の種類(TP-9 = う蝕、TP-11 = 部分修復など)。 */
  content?: Record<string, string>;
  /** 欠損歯の内容(TM)。 */
  missing?: Record<string, string>;
  /** 歯面を押すとその面に付く。 */
  surface?: boolean;
  /** 冠(う蝕・部分修復・ほかの冠を置き換える)。 */
  crown?: boolean;
  /** 現在歯の内容の 1 行目に書き足す(クラスプ・レスト・失活歯。別の併存レコードにしない)。 */
  attach?: boolean;
  /** 義歯(床番号を付ける)。欠損歯側は TM-5、鉤歯側は TP-34。 */
  denture?: "base" | "clasp";
  /** 特記事項に書く材料。 */
  material?: string;
  /** 記録を消す。 */
  erase?: boolean;
}

export const STAMP_GROUP_LABELS: Record<StampGroup, string> = {
  state: "状態",
  caries: "う蝕",
  restoration: "修復",
  prosthesis: "欠損・補綴",
};

/** 同じ顎の何床目の義歯か。1 床目は番号を付けない(コード表の「同顎２床目」「同顎３床目」)。 */
export const DENTURE_NUMBERS = [
  { code: "", label: "1床目" },
  { code: "01", label: "2床目" },
  { code: "02", label: "3床目" },
] as const;

const GOLD_PALLADIUM = "金銀パラジウム";
const CAD_CAM = "CAD/CAM冠用材料";

export const ORAL_EXAM_STAMPS: OralExamStamp[] = [
  { key: "sound", label: "健全", title: "現在歯【健全歯／】(治療痕なし)", group: "state", basic: "02" },
  { key: "co", label: "CO", title: "現在歯【要観察歯ＣＯ】", group: "state", basic: "04" },
  { key: "sealant", label: "シーラント", title: "現在歯【健全歯(シーラント：シ)】", group: "state", basic: "03" },
  { key: "unerupted", label: "未萌出", title: "未萌出歯", group: "state", basic: "36" },
  { key: "impacted", label: "埋伏", title: "埋伏歯(ＲＴ)(詳細不明)", group: "state", basic: "32" },
  { key: "unknown", label: "未検査", title: "記号なし(未検査)", group: "state", basic: "98" },
  { key: "c1", label: "C1", title: "未処置歯 Ｃ１", group: "caries", content: { "TP-9": "02" }, surface: true },
  { key: "c2", label: "C2", title: "未処置歯 Ｃ２", group: "caries", content: { "TP-9": "03" }, surface: true },
  { key: "c3", label: "C3", title: "未処置歯 Ｃ３", group: "caries", content: { "TP-9": "04" }, surface: true },
  {
    key: "c4",
    label: "C4・残根",
    title: "残根、Ｃ４",
    group: "caries",
    basic: "08",
    stateCode: "6",
    content: { "TP-9": "10", "TP-3": "02" },
  },
  {
    key: "cr",
    label: "CR",
    title: "部分修復(歯冠色充填)(ＣＦ、ＲＦ、ＧＣＦ)・コンポジットレジン",
    group: "restoration",
    content: { "TP-11": "03" },
    surface: true,
    material: "コンポジットレジン",
  },
  {
    key: "inlay",
    label: "インレー",
    title: "部分修復(金属インレー・銀色)(Ｉｎ)・金銀パラジウム",
    group: "restoration",
    content: { "TP-11": "20" },
    surface: true,
    material: GOLD_PALLADIUM,
  },
  {
    key: "cadcam-inlay",
    label: "CAD/CAMインレー",
    title: "部分修復(非金属インレー・レジン系(様)・歯冠色)(Ｉｎ)・CAD/CAM冠用材料",
    group: "restoration",
    content: { "TP-11": "23" },
    surface: true,
    material: CAD_CAM,
  },
  {
    key: "fmc",
    label: "FMC",
    title: "全部修復(全部金属冠・銀色)(ＦＭＣ)・金銀パラジウム",
    group: "restoration",
    content: { "TP-21": "01", "TP-18": "01" },
    crown: true,
    material: GOLD_PALLADIUM,
  },
  {
    key: "veneer-crown",
    label: "前装冠",
    title: "全部修復(前装金属冠・銀色)(前装ＭＣ)・金銀パラジウム",
    group: "restoration",
    content: { "TP-21": "07", "TP-18": "01" },
    crown: true,
    material: GOLD_PALLADIUM,
  },
  {
    key: "cadcam-crown",
    label: "CAD/CAM冠",
    title: "全部修復(全部非金属冠・レジン系(様)・歯冠色)(ＪＣ)・CAD/CAM冠用材料",
    group: "restoration",
    content: { "TP-21": "04", "TP-18": "01" },
    crown: true,
    material: CAD_CAM,
  },
  {
    key: "ceramic-crown",
    label: "セラミック冠",
    title: "全部修復(全部非金属冠・セラミック系(様)・歯冠色)(ＪＣ)・セラミック",
    group: "restoration",
    content: { "TP-21": "05", "TP-18": "01" },
    crown: true,
    material: "セラミック",
  },
  {
    key: "endo",
    label: "失活歯",
    title: "失活歯(根管充填歯など)",
    group: "restoration",
    content: { "TP-3": "02" },
    attach: true,
  },
  {
    key: "abutment",
    label: "Br支台",
    title: "全部金属冠のブリッジ支台歯(同顎１装置目)・金銀パラジウム",
    group: "prosthesis",
    content: { "TP-23": "02", "TP-21": "01", "TP-18": "01", "TP-24": "01" },
    crown: true,
    material: GOLD_PALLADIUM,
  },
  {
    key: "pontic",
    label: "ポンティック",
    title: "欠損歯【喪失歯(欠損補綴歯・ポンティック)】鋳造ポンティック・銀色・金銀パラジウム",
    group: "prosthesis",
    basic: "60",
    missing: { "TM-2": "05", "TM-3": "01" },
    material: GOLD_PALLADIUM,
  },
  {
    key: "partial-denture",
    label: "部分床義歯",
    title: "欠損歯【喪失歯(欠損補綴歯・義歯)】局部義歯(内容不明)(ＰＤ)",
    group: "prosthesis",
    basic: "57",
    missing: { "TM-4": "15" },
    denture: "base",
  },
  {
    key: "full-denture",
    label: "総義歯",
    title: "欠損歯【喪失歯(欠損補綴歯・義歯)】総義歯(内容不明)(ＦＤ)",
    group: "prosthesis",
    basic: "57",
    missing: { "TM-4": "08" },
    denture: "base",
  },
  {
    key: "clasp",
    label: "クラスプ",
    title: "鋳造鉤(二腕鉤・レスト付き・銀色)(Ｃｌ)",
    group: "prosthesis",
    content: { "TP-26": "05" },
    attach: true,
    denture: "clasp",
  },
  {
    key: "rest",
    label: "レスト",
    title: "レストシート等あり",
    group: "prosthesis",
    content: { "TP-25": "01" },
    attach: true,
    denture: "clasp",
  },
  {
    key: "implant",
    label: "インプラント",
    title: "欠損歯【喪失歯(インプラント・タイプ不明)】アバットメント",
    group: "prosthesis",
    basic: "62",
    content: { "TP-22": "10" },
  },
  { key: "missing", label: "喪失", title: "欠損歯【喪失歯△】", group: "prosthesis", basic: "51" },
  { key: "erase", label: "消す", title: "この歯の記録を消す", group: "prosthesis", erase: true },
];

/** う蝕(治療が要る)の未処置歯コード(TP-9)。咬耗・破折・酸蝕症などは含めない。 */
function isCariesCode(code: string | undefined): boolean {
  const n = Number(code);
  return Boolean(code) && ((n >= 1 && n <= 8) || (n >= 22 && n <= 32));
}

const RESTORATION_ITEMS = ["TP-11", "TP-21", "TP-22"];

/** 冠を被せると無くなる内容(う蝕・部分修復・窩洞・ほかの冠・仮歯と、それらの歯面)。 */
const CROWN_REPLACED_ITEMS = ["TP-10", "TP-11", "TP-12", "TP-21", ...TP_SURFACE_ITEMS.map((s) => s.item)];

/** 現在歯の内容から基本状態を決める(う蝕があれば未処置歯、修復があれば処置歯)。 */
function basicFromContents(contents: ToothContent[], current: string): string {
  if (contents.some((c) => c.values["TP-9"] === "10" || c.values["TP-9"] === "11")) return "08";
  if (contents.some((c) => isCariesCode(c.values["TP-9"]))) return "06";
  if (contents.some((c) => RESTORATION_ITEMS.some((item) => c.values[item]))) return "10";
  return current && !usesMissingContent(current) && current !== "08" && current !== "06" ? current : "02";
}

function surfaceCount(values: Record<string, string>): number {
  return TP_SURFACE_ITEMS.filter((s) => values[s.item]).length;
}

function withoutEmpty(contents: ToothContent[]): ToothContent[] {
  return contents.filter((c) => Object.values(c.values).some(Boolean));
}

export interface ApplyStampOptions {
  /** 押した歯面(TP-13〜17)。 */
  face?: string;
  /** 義歯の床番号(DENTURE_NUMBERS の code)。 */
  dentureNumber?: string;
  book?: OralExamCodeBook;
}

/**
 * スタンプを歯に押した結果(その歯の併存グループの並び)。最初の併存グループに書き、
 * ほかのグループはそのまま残す。
 */
export function applyStamp(
  records: ToothRecord[],
  toothCode: string,
  stamp: OralExamStamp,
  { face, dentureNumber = "", book }: ApplyStampOptions = {},
): ToothRecord[] {
  if (stamp.erase) return [];
  const primary = records[0] ?? newToothRecord(toothCode, stamp.basic ?? "02");
  const rest = records.slice(1);
  const newContent = (values: Record<string, string>): ToothContent => ({ key: draftKey(), values: { ...values } });
  const finish = (record: ToothRecord) => [
    stamp.material ? applyMaterial(record, stamp.material, book) : record,
    ...rest,
  ];

  if (stamp.basic) {
    const missing: Record<string, string> = { ...stamp.missing };
    if (stamp.denture === "base" && dentureNumber) missing["TM-5"] = dentureNumber;
    return finish({
      ...primary,
      basic: stamp.basic,
      stateCode: stamp.stateCode ?? defaultStateCode(stamp.basic),
      contents: stamp.content ? [newContent(stamp.content)] : [],
      missing,
    });
  }

  const content: Record<string, string> = { ...stamp.content };
  if (stamp.denture === "clasp" && dentureNumber) content["TP-34"] = dentureNumber;
  const [kind] = Object.keys(content);
  const code = content[kind];
  // 欠損歯にう蝕や修復を押したら、現在歯に戻して書く。
  let contents = usesMissingContent(primary.basic) || primary.basic === "08" ? [] : [...primary.contents];

  if (stamp.crown) {
    // 冠はう蝕・部分修復・ほかの冠を置き換える。同じ行のクラスプ・レスト・失活歯などは残す。
    contents = withoutEmpty(
      contents.map((c) => {
        const values = { ...c.values };
        for (const item of CROWN_REPLACED_ITEMS) delete values[item];
        if (isCariesCode(values["TP-9"])) delete values["TP-9"];
        return { ...c, values };
      }),
    );
    if (contents.length) contents[0] = { ...contents[0], values: { ...contents[0].values, ...content } };
    else contents.push(newContent(content));
  } else if (stamp.attach) {
    if (contents.length) {
      const values = { ...contents[0].values, ...content };
      if (stamp.denture === "clasp" && !dentureNumber) delete values["TP-34"];
      contents[0] = { ...contents[0], values };
    } else contents.push(newContent(content));
  } else if (stamp.surface && face) {
    const same = contents.find((c) => c.values[kind] === code);
    if (same) {
      const values = { ...same.values };
      if (values[face]) delete values[face];
      else values[face] = "01";
      contents = surfaceCount(values) || !surfaceCount(same.values)
        ? contents.map((c) => (c === same ? { ...c, values } : c))
        : contents.filter((c) => c !== same);
    } else {
      contents.push(newContent({ ...content, [face]: "01" }));
    }
    // 修復した面のう蝕は消す(面が無くなったう蝕の内容ごと)。
    if (kind === "TP-11") {
      contents = contents.flatMap((c) => {
        if (!isCariesCode(c.values["TP-9"]) || !c.values[face]) return [c];
        const values = { ...c.values };
        delete values[face];
        return surfaceCount(values) ? [{ ...c, values }] : [];
      });
    }
  } else {
    const same = contents.find((c) => c.values[kind]);
    if (same) contents = contents.map((c) => (c === same ? { ...c, values: { ...c.values, ...content } } : c));
    else contents.push(newContent(content));
  }

  const basic = basicFromContents(contents, primary.basic);
  return finish({ ...primary, basic, stateCode: defaultStateCode(basic), contents, missing: {} });
}

// ---- 歯式図の略号 ----

type AbbrRule = { item: string; abbr: (code: string) => string };

function inRange(code: string, ...ranges: [number, number][]): boolean {
  const n = Number(code);
  return ranges.some(([from, to]) => n >= from && n <= to);
}

function pick(code: string, table: [[number, number][], string][]): string {
  return table.find(([ranges]) => inRange(code, ...ranges))?.[1] ?? "";
}

/**
 * 歯式図に添える略号。並びが優先順(う蝕 → 冠 → その他修復 → 部分修復 → 仮歯 → 支台 → 欠損補綴 → 鉤 → 矯正)。
 * 紙の歯式で使う略称(レセプトの略称名・標準プロファイル 26 項目の略号)に寄せる。
 */
const ABBR_RULES: AbbrRule[] = [
  {
    item: "TP-9",
    abbr: (code) =>
      pick(code, [
        [[[1, 1]], "C"],
        [[[2, 2], [5, 5]], "C1"],
        [[[3, 3], [6, 6]], "C2"],
        [[[4, 4], [7, 7]], "C3"],
        [[[8, 8]], "仮封"],
        [[[10, 11]], "C4"],
        [[[12, 12]], "Att"],
        [[[13, 13]], "Abr"],
        [[[14, 14]], "WSD"],
        [[[15, 15]], "FrT"],
        [[[16, 21]], "Ero"],
        [[[22, 24]], "窩洞"],
        [[[25, 27], [32, 32]], "形成"],
        [[[28, 31]], "コア"],
      ]),
  },
  {
    item: "TP-21",
    abbr: (code) =>
      pick(code, [
        [[[1, 3]], "FMC"],
        [[[4, 4]], "HJC"],
        [[[5, 5]], "セラ"],
        [[[6, 6]], "JC"],
        [[[7, 9]], "前装"],
        [[[10, 12]], "MB"],
        [[[13, 21]], "外冠"],
        [[[22, 36]], "帯環"],
        [[[37, 40]], "PC"],
        [[[41, 42]], "乳歯冠"],
        [[[43, 43]], "保隙"],
        [[[44, 44]], "既製冠"],
      ]),
  },
  {
    item: "TP-22",
    abbr: (code) =>
      pick(code, [
        [[[1, 6]], "根面板"],
        [[[7, 9]], "内冠"],
        [[[10, 10]], "Abu"],
        [[[11, 13]], "At"],
      ]),
  },
  {
    item: "TP-11",
    abbr: (code) =>
      pick(code, [
        [[[1, 3]], "CR"],
        [[[4, 6]], "AF"],
        [[[7, 7]], "GF"],
        [[[8, 25]], "In"],
        [[[26, 31]], "On"],
        [[[32, 37]], "3/4"],
        [[[38, 43]], "4/5"],
        [[[44, 46]], "LV"],
        [[[47, 52]], "接着冠"],
      ]),
  },
  { item: "TP-10", abbr: () => "TeC" },
  { item: "TP-23", abbr: (code) => pick(code, [[[[1, 1]], "連結"], [[[2, 2]], "Br"], [[[3, 3]], "隙支台"]]) },
  { item: "TM-2", abbr: (code) => pick(code, [[[[1, 19]], "Pon"], [[[20, 34]], "隙"]]) },
  {
    item: "TM-4",
    abbr: (code) =>
      pick(code, [
        [[[8, 14], [35, 40]], "FD"],
        [[[15, 21], [41, 46]], "PD"],
        [[[22, 22], [24, 28]], "顎補綴"],
        [[[1, 7], [23, 23], [29, 34]], "Den"],
      ]),
  },
  { item: "TP-27", abbr: () => "矯正" },
  { item: "TP-28", abbr: () => "固定" },
];

/** 内容の無い歯でも基本状態から分かる略号。 */
function basicAbbr(basic: string): string {
  return pick(basic, [
    [[[13, 13]], "MPM"],
    [[[30, 31]], "HRT"],
    [[[32, 34]], "RT"],
    [[[35, 35]], "HIT"],
    [[[36, 36]], "未萌出"],
    [[[37, 37]], "萌出中"],
    [[[57, 59]], "Den"],
    [[[60, 60]], "Pon"],
    [[[61, 61]], "隙"],
    [[[62, 66]], "Im"],
  ]);
}

/** 2 床目・3 床目の義歯は略号に床の番号を付ける(PD2 など)。 */
function dentureSuffix(number: string | undefined): string {
  return number === "01" ? "2" : number === "02" ? "3" : "";
}

/** CAD/CAM の材料で作った非金属の修復(特記事項の材料で見分ける)。 */
function isCadCam(record: ToothRecord): boolean {
  return materialOf(record.remark) === CAD_CAM;
}

/** 歯式図に添える略号(優先順、重複なし)。併存グループ全部から集める。クラスプ・レストは別(toothClaspMarks)。 */
export function toothAbbreviations(records: ToothRecord[]): string[] {
  const found = new Set<string>();
  for (const record of records) {
    const sources = usesMissingContent(record.basic) ? [record.missing] : record.contents.map((c) => c.values);
    for (const rule of ABBR_RULES) {
      for (const values of sources) {
        const code = values[rule.item];
        if (!code) continue;
        let abbr = rule.abbr(code);
        if (!abbr) continue;
        if (isCadCam(record) && (rule.item === "TP-21" || rule.item === "TP-11") && /^(HJC|JC|In)$/.test(abbr)) {
          abbr = rule.item === "TP-21" ? "CAD" : "CAD-In";
        }
        if (rule.item === "TM-4") abbr += dentureSuffix(values["TM-5"]);
        found.add(abbr);
      }
    }
    if (inRange(record.basic, [62, 66])) found.add("Im");
    if (!found.size) {
      const abbr = basicAbbr(record.basic);
      if (abbr) found.add(abbr);
    }
  }
  return [...found];
}

/**
 * クラスプ・レストの印(Cl・R、2 床目以降は Cl2 など)。略号は 2 つまでしか出さないので、
 * 鉤歯であることが隠れないよう別に出す。
 */
export function toothClaspMarks(records: ToothRecord[]): string[] {
  const marks = new Set<string>();
  for (const record of records) {
    if (usesMissingContent(record.basic)) continue;
    for (const content of record.contents) {
      const suffix = dentureSuffix(content.values["TP-34"]);
      if (content.values["TP-26"]) marks.add(`Cl${suffix}`);
      if (content.values["TP-25"]) marks.add(`R${suffix}`);
    }
  }
  return [...marks];
}
