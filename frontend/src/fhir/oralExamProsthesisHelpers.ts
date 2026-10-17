import {
  applyMaterial,
  CROWN_REPLACED_ITEMS,
  draftKey,
  isCariesCode,
  materialOf,
  newToothRecord,
  recordsOfTooth,
  sortTeeth,
  TOOTH_ROWS,
  toothDefOf,
  toothLabel,
  usesMissingContent,
  withMaterial,
  withoutEmpty,
  type OralExamCodeBook,
  type ToothContent,
  type ToothRecord,
} from "./oralExamHelpers";

/**
 * ブリッジ・連結冠・有床義歯。複数の歯で 1 つの装置になるものを、装置の単位で読み書きする。
 *
 * 仕様(JDAOES)は装置を歯ごとの項目に分けて持つ。
 *  - ブリッジ・連結冠: 支台歯は現在歯の内容に TP-23(連結冠 01 / ブリッジ支台 02)・TP-24(番号)・TP-21(冠)、
 *    状態コードは支台歯(3)。ポンティックは基本状態 60・欠損歯の内容に TM-2(種類)・TM-3(番号)。
 *    番号は同じ顎で何装置目か(固定性 01〜08、半固定性・可撤性 09〜16)。
 *  - 有床義歯: 範囲のすべての欠損歯に TM-4(床)・TM-5(同じ顎の 2 床目以降)・TM-6(人工歯)・TM-8(大連結子)・
 *    TM-9(補強線)、基本状態 57。鉤歯は現在歯の内容に TP-26(クラスプ)・TP-25(レスト)・TP-34(2 床目以降)。
 * 同じ装置の歯は同じ値でそろえる必要があるので、画面は装置ごとのモーダルで書き、ここで歯ごとに展開する。
 */

export type Jaw = "upper" | "lower";

export const JAW_OPTIONS: { code: Jaw; label: string }[] = [
  { code: "upper", label: "上顎" },
  { code: "lower", label: "下顎" },
];

export function jawOf(toothCode: string): Jaw | undefined {
  const def = toothDefOf(toothCode);
  return def ? (def.upper ? "upper" : "lower") : undefined;
}

/** 装置を置く歯の並び(その顎の永久歯、患者の右から左)。 */
export function jawTeeth(jaw: Jaw): string[] {
  return TOOTH_ROWS.find((row) => row.key === jaw)?.teeth.map((t) => t.code) ?? [];
}

function replaceTooth(teeth: ToothRecord[], toothCode: string, records: ToothRecord[]): ToothRecord[] {
  return sortTeeth([...teeth.filter((t) => t.toothCode !== toothCode), ...records]);
}

function updatePrimary(
  teeth: ToothRecord[],
  toothCode: string,
  update: (record: ToothRecord) => ToothRecord,
  basic = "02",
): ToothRecord[] {
  const records = recordsOfTooth(teeth, toothCode);
  const primary = records[0] ?? newToothRecord(toothCode, basic);
  return replaceTooth(teeth, toothCode, [update(primary), ...records.slice(1)]);
}

/** 喪失(51)に戻す。装置を外した欠損歯の行き先。 */
function toLost(record: ToothRecord): ToothRecord {
  return { ...record, basic: "51", stateCode: "2", contents: [], missing: {}, remark: withMaterial(record.remark, "") };
}

function mergeFirst(contents: ToothContent[], values: Record<string, string>): ToothContent[] {
  if (!contents.length) return [{ key: draftKey(), values }];
  return [{ ...contents[0], values: { ...contents[0].values, ...values } }, ...contents.slice(1)];
}

function numberLabel(code: string): string {
  const n = Number(code);
  return String(n > 8 ? n - 8 : n);
}

// ---- ブリッジ・連結冠 ----

export type BridgeKind = "bridge" | "splint";

export interface BridgeDraft {
  kind: BridgeKind;
  jaw: Jaw;
  /** TP-24 / TM-3 のコード(01〜16)。 */
  number: string;
  abutments: string[];
  pontics: string[];
  /** 支台の冠(TP-21)。 */
  crown: string;
  /** ポンティックの種類(TM-2)。 */
  pontic: string;
  material: string;
  /** 読み込んだ既存の装置(編集のとき)。 */
  original?: { jaw: Jaw; number: string };
}

export const BRIDGE_KIND_OPTIONS: { code: BridgeKind; label: string; tp23: string }[] = [
  { code: "bridge", label: "ブリッジ", tp23: "02" },
  { code: "splint", label: "連結冠", tp23: "01" },
];

export function isSemiFixed(number: string): boolean {
  return Number(number) >= 9;
}

/** 番号の選択肢(固定性 01〜08 / 半固定性・可撤性 09〜16)。表示は同じ顎の何装置目か。 */
export function bridgeNumberOptions(semiFixed: boolean): { code: string; label: string }[] {
  return Array.from({ length: 8 }, (_, i) => {
    const code = String(i + 1 + (semiFixed ? 8 : 0)).padStart(2, "0");
    return { code, label: `${i + 1}装置目` };
  });
}

interface BridgeMember {
  toothCode: string;
  role: "abutment" | "pontic";
  record: ToothRecord;
  content?: ToothContent;
}

function bridgeMembers(teeth: ToothRecord[], jaw: Jaw, number: string): BridgeMember[] {
  const members: BridgeMember[] = [];
  for (const record of teeth) {
    if (jawOf(record.toothCode) !== jaw) continue;
    if (usesMissingContent(record.basic)) {
      if (record.missing["TM-3"] === number) members.push({ toothCode: record.toothCode, role: "pontic", record });
    } else {
      const content = record.contents.find((c) => c.values["TP-24"] === number);
      if (content) members.push({ toothCode: record.toothCode, role: "abutment", record, content });
    }
  }
  return members;
}

/** その歯が属するブリッジ・連結冠(顎と番号)。 */
export function bridgeOfTooth(teeth: ToothRecord[], toothCode: string): { jaw: Jaw; number: string } | null {
  const jaw = jawOf(toothCode);
  if (!jaw) return null;
  for (const record of recordsOfTooth(teeth, toothCode)) {
    const number = usesMissingContent(record.basic)
      ? record.missing["TM-3"]
      : record.contents.find((c) => c.values["TP-24"])?.values["TP-24"];
    if (number) return { jaw, number };
  }
  return null;
}

function usedBridgeNumbers(teeth: ToothRecord[], jaw: Jaw): Set<string> {
  const used = new Set<string>();
  for (const record of teeth) {
    if (jawOf(record.toothCode) !== jaw) continue;
    if (record.missing["TM-3"]) used.add(record.missing["TM-3"]);
    for (const c of record.contents) if (c.values["TP-24"]) used.add(c.values["TP-24"]);
  }
  return used;
}

/** 同じ顎で使っていない最小の番号。 */
export function nextBridgeNumber(teeth: ToothRecord[], jaw: Jaw, semiFixed: boolean, keep?: string): string {
  const used = usedBridgeNumbers(teeth, jaw);
  if (keep) used.delete(keep);
  return bridgeNumberOptions(semiFixed).find((o) => !used.has(o.code))?.code ?? bridgeNumberOptions(semiFixed)[0].code;
}

export function newBridgeDraft(teeth: ToothRecord[], jaw: Jaw): BridgeDraft {
  return {
    kind: "bridge",
    jaw,
    number: nextBridgeNumber(teeth, jaw, false),
    abutments: [],
    pontics: [],
    crown: "01",
    pontic: "05",
    material: "金銀パラジウム",
  };
}

/** 既存のブリッジ・連結冠を読み込む。 */
export function loadBridge(teeth: ToothRecord[], jaw: Jaw, number: string): BridgeDraft {
  const members = bridgeMembers(teeth, jaw, number);
  const abutment = members.find((m) => m.role === "abutment");
  const pontic = members.find((m) => m.role === "pontic");
  return {
    kind: abutment?.content?.values["TP-23"] === "01" ? "splint" : "bridge",
    jaw,
    number,
    abutments: members.filter((m) => m.role === "abutment").map((m) => m.toothCode),
    pontics: members.filter((m) => m.role === "pontic").map((m) => m.toothCode),
    crown: abutment?.content?.values["TP-21"] ?? "01",
    pontic: pontic?.record.missing["TM-2"] ?? "05",
    material: materialOf((abutment ?? pontic)?.record.remark ?? ""),
    original: { jaw, number },
  };
}

/** ブリッジ・連結冠を外す。支台は支台の印だけ消して冠は残し、ポンティックは喪失に戻す。 */
export function removeBridge(teeth: ToothRecord[], jaw: Jaw, number: string): ToothRecord[] {
  let next = teeth;
  for (const member of bridgeMembers(teeth, jaw, number)) {
    next = replaceTooth(
      next,
      member.toothCode,
      recordsOfTooth(next, member.toothCode).map((record) => {
        if (record !== member.record) return record;
        if (member.role === "pontic") return toLost(record);
        const contents = record.contents.map((c) => {
          if (c.values["TP-24"] !== number) return c;
          const values = { ...c.values };
          delete values["TP-23"];
          delete values["TP-24"];
          return { ...c, values };
        });
        return { ...record, stateCode: record.stateCode === "3" ? "0" : record.stateCode, contents: withoutEmpty(contents) };
      }),
    );
  }
  return next;
}

/** 歯の並びで連続しているか(装置の歯の間に、装置に入らない歯が挟まらないか)。 */
function isContiguous(jaw: Jaw, codes: string[]): boolean {
  const order = jawTeeth(jaw);
  const indexes = codes.map((c) => order.indexOf(c)).sort((a, b) => a - b);
  return indexes.every((n, i) => i === 0 || n === indexes[i - 1] + 1);
}

export function validateBridge(teeth: ToothRecord[], draft: BridgeDraft): string[] {
  const errors: string[] = [];
  const all = [...draft.abutments, ...draft.pontics];
  if (draft.kind === "bridge") {
    if (!draft.abutments.length || !draft.pontics.length) errors.push("支台とポンティックを 1 本以上選んでください。");
  } else if (draft.abutments.length < 2) {
    errors.push("連結冠は支台を 2 本以上選んでください。");
  }
  if (all.length && !isContiguous(draft.jaw, all)) errors.push("装置の歯は続けて選んでください。");

  const original = draft.original;
  const sameAsOriginal = (jaw: Jaw, number: string) => original?.jaw === jaw && original.number === number;
  if (!sameAsOriginal(draft.jaw, draft.number) && usedBridgeNumbers(teeth, draft.jaw).has(draft.number)) {
    errors.push("この番号は同じ顎の別の装置で使っています。");
  }
  for (const code of all) {
    const other = bridgeOfTooth(teeth, code);
    if (other && !sameAsOriginal(other.jaw, other.number)) {
      errors.push(`${toothLabel(code)}は別のブリッジ・連結冠(${numberLabel(other.number)}装置目)に入っています。`);
    }
  }
  return errors;
}

/** ブリッジ・連結冠を歯ごとに書く。編集では読み込んだ装置をいったん外してから書き直す。 */
export function applyBridge(teeth: ToothRecord[], draft: BridgeDraft, book: OralExamCodeBook | undefined): ToothRecord[] {
  let next = draft.original ? removeBridge(teeth, draft.original.jaw, draft.original.number) : teeth;
  const tp23 = BRIDGE_KIND_OPTIONS.find((o) => o.code === draft.kind)?.tp23 ?? "02";
  const withMat = (record: ToothRecord) => (draft.material ? applyMaterial(record, draft.material, book) : record);

  for (const code of draft.abutments) {
    next = updatePrimary(next, code, (record) => {
      // 冠はう蝕・部分修復・ほかの冠を置き換える(歯ごとのスタンプの冠と同じ規則)。
      const kept = usesMissingContent(record.basic)
        ? []
        : withoutEmpty(
            record.contents.map((c) => {
              const values = { ...c.values };
              for (const item of [...CROWN_REPLACED_ITEMS, "TP-23", "TP-24"]) delete values[item];
              if (isCariesCode(values["TP-9"])) delete values["TP-9"];
              return { ...c, values };
            }),
          );
      const contents = mergeFirst(kept, { "TP-21": draft.crown, "TP-18": "01", "TP-23": tp23, "TP-24": draft.number });
      return withMat({ ...record, basic: "10", stateCode: "3", contents, missing: {} });
    });
  }
  for (const code of draft.pontics) {
    next = updatePrimary(
      next,
      code,
      (record) =>
        withMat({
          ...record,
          basic: "60",
          stateCode: "2",
          contents: [],
          missing: { "TM-2": draft.pontic, "TM-3": draft.number },
        }),
      "60",
    );
  }
  return next;
}

// ---- 有床義歯 ----

export type DentureType = "PD" | "FD";

export interface DentureDraft {
  jaw: Jaw;
  /** 床番号(TM-5 / TP-34。1 床目は空)。 */
  number: string;
  type: DentureType;
  /** 床(TM-4)。 */
  base: string;
  /** 人工歯(TM-6)。 */
  artificial: string;
  /** 大連結子(TM-8)。 */
  connector: string;
  /** 補強線(TM-9)。 */
  reinforcement: boolean;
  /** クラスプ(TP-26)。 */
  clasp: string;
  /** 床などの材料(人工歯の歯の特記事項)。 */
  material: string;
  replaced: string[];
  clasps: string[];
  rests: string[];
  original?: { jaw: Jaw; number: string };
}

export const DENTURE_TYPE_OPTIONS: { code: DentureType; label: string }[] = [
  { code: "PD", label: "局部義歯" },
  { code: "FD", label: "総義歯" },
];

/** 総義歯の床のコード(TM-4)。それ以外(顎補綴を除く)は局部義歯として選ばせる。 */
function isFullDentureBase(code: string): boolean {
  const n = Number(code);
  return (n >= 8 && n <= 14) || (n >= 35 && n <= 40);
}

function isJawProsthesisBase(code: string): boolean {
  const n = Number(code);
  return n === 22 || (n >= 24 && n <= 28);
}

/** 床の選択肢を義歯の種類で絞る。 */
export function dentureBaseFilter(type: DentureType): (code: string) => boolean {
  return (code) => !isJawProsthesisBase(code) && (type === "FD" ? isFullDentureBase(code) : !isFullDentureBase(code));
}

const DEFAULT_BASE: Record<DentureType, string> = { PD: "16", FD: "09" };

export function newDentureDraft(jaw: Jaw, number = ""): DentureDraft {
  return {
    jaw,
    number,
    type: "PD",
    base: DEFAULT_BASE.PD,
    artificial: "",
    connector: "",
    reinforcement: false,
    clasp: "05",
    material: "",
    replaced: [],
    clasps: [],
    rests: [],
  };
}

/** 義歯の種類を変える。総義歯はその顎の歯を全部人工歯にし、鉤は持たない。 */
export function withDentureType(draft: DentureDraft, type: DentureType): DentureDraft {
  return {
    ...draft,
    type,
    base: dentureBaseFilter(type)(draft.base) ? draft.base : DEFAULT_BASE[type],
    replaced: type === "FD" ? jawTeeth(draft.jaw) : draft.replaced,
    clasps: type === "FD" ? [] : draft.clasps,
    rests: type === "FD" ? [] : draft.rests,
  };
}

function dentureMembers(teeth: ToothRecord[], jaw: Jaw, number: string) {
  const replaced: ToothRecord[] = [];
  const supports: { record: ToothRecord; content: ToothContent }[] = [];
  for (const record of teeth) {
    if (jawOf(record.toothCode) !== jaw) continue;
    if (usesMissingContent(record.basic)) {
      if (record.missing["TM-4"] && (record.missing["TM-5"] ?? "") === number) replaced.push(record);
    } else {
      for (const content of record.contents) {
        if ((content.values["TP-26"] || content.values["TP-25"]) && (content.values["TP-34"] ?? "") === number) {
          supports.push({ record, content });
        }
      }
    }
  }
  return { replaced, supports };
}

/** その歯が属する有床義歯(顎と床番号)。人工歯・鉤歯のどちらでも。 */
export function dentureOfTooth(teeth: ToothRecord[], toothCode: string): { jaw: Jaw; number: string } | null {
  const jaw = jawOf(toothCode);
  if (!jaw) return null;
  for (const record of recordsOfTooth(teeth, toothCode)) {
    if (usesMissingContent(record.basic) && record.missing["TM-4"]) return { jaw, number: record.missing["TM-5"] ?? "" };
    const support = record.contents.find((c) => c.values["TP-26"] || c.values["TP-25"]);
    if (!usesMissingContent(record.basic) && support) return { jaw, number: support.values["TP-34"] ?? "" };
  }
  return null;
}

/** 既存の有床義歯を読み込む。無ければ新しい下書き。 */
export function loadDenture(teeth: ToothRecord[], jaw: Jaw, number: string): DentureDraft {
  const { replaced, supports } = dentureMembers(teeth, jaw, number);
  if (!replaced.length && !supports.length) return newDentureDraft(jaw, number);
  const first = replaced[0];
  const base = first?.missing["TM-4"] ?? DEFAULT_BASE.PD;
  return {
    jaw,
    number,
    type: isFullDentureBase(base) ? "FD" : "PD",
    base,
    artificial: first?.missing["TM-6"] ?? "",
    connector: first?.missing["TM-8"] ?? "",
    reinforcement: Boolean(first?.missing["TM-9"]),
    clasp: supports.find((s) => s.content.values["TP-26"])?.content.values["TP-26"] ?? "05",
    material: materialOf(first?.remark ?? ""),
    replaced: replaced.map((r) => r.toothCode),
    clasps: supports.filter((s) => s.content.values["TP-26"]).map((s) => s.record.toothCode),
    rests: supports.filter((s) => s.content.values["TP-25"]).map((s) => s.record.toothCode),
    original: { jaw, number },
  };
}

/** 有床義歯を外す。人工歯の歯は喪失に戻し、鉤歯はクラスプ・レストを消す。 */
export function removeDenture(teeth: ToothRecord[], jaw: Jaw, number: string): ToothRecord[] {
  const { replaced, supports } = dentureMembers(teeth, jaw, number);
  let next = teeth;
  for (const record of replaced) {
    next = replaceTooth(
      next,
      record.toothCode,
      recordsOfTooth(next, record.toothCode).map((r) => (r === record ? toLost(r) : r)),
    );
  }
  for (const { record, content } of supports) {
    next = replaceTooth(
      next,
      record.toothCode,
      recordsOfTooth(next, record.toothCode).map((r) => {
        if (r !== record) return r;
        const contents = r.contents.map((c) => {
          if (c !== content) return c;
          const values = { ...c.values };
          delete values["TP-25"];
          delete values["TP-26"];
          delete values["TP-34"];
          return { ...c, values };
        });
        return { ...r, contents: withoutEmpty(contents) };
      }),
    );
  }
  return next;
}

export function validateDenture(teeth: ToothRecord[], draft: DentureDraft): string[] {
  const errors: string[] = [];
  if (!draft.replaced.length) errors.push("人工歯の歯を 1 本以上選んでください。");
  for (const code of [...draft.clasps, ...draft.rests]) {
    const primary = recordsOfTooth(teeth, code)[0];
    if (primary && usesMissingContent(primary.basic)) {
      errors.push(`${toothLabel(code)}は欠損歯なのでクラスプ・レストを付けられません。`);
    }
  }
  const original = draft.original;
  if (!(original?.jaw === draft.jaw && original.number === draft.number)) {
    const existing = dentureMembers(teeth, draft.jaw, draft.number);
    if (existing.replaced.length || existing.supports.length) {
      errors.push("同じ顎・同じ床番号の義歯がすでにあります。床番号を変えてください。");
    }
  }
  return errors;
}

/** 有床義歯を歯ごとに書く。編集では読み込んだ義歯をいったん外してから書き直す。 */
export function applyDenture(
  teeth: ToothRecord[],
  draft: DentureDraft,
  book: OralExamCodeBook | undefined,
): ToothRecord[] {
  let next = draft.original ? removeDenture(teeth, draft.original.jaw, draft.original.number) : teeth;
  const missing: Record<string, string> = { "TM-4": draft.base };
  if (draft.number) missing["TM-5"] = draft.number;
  if (draft.artificial) missing["TM-6"] = draft.artificial;
  if (draft.connector) missing["TM-8"] = draft.connector;
  if (draft.reinforcement) missing["TM-9"] = "01";

  for (const code of draft.replaced) {
    next = updatePrimary(
      next,
      code,
      (record) => {
        const written = { ...record, basic: "57", stateCode: "2", contents: [], missing: { ...missing } };
        return draft.material ? applyMaterial(written, draft.material, book) : written;
      },
      "57",
    );
  }
  for (const code of new Set([...draft.clasps, ...draft.rests])) {
    const values: Record<string, string> = {};
    if (draft.clasps.includes(code)) values["TP-26"] = draft.clasp;
    if (draft.rests.includes(code)) values["TP-25"] = "01";
    if (draft.number) values["TP-34"] = draft.number;
    next = updatePrimary(next, code, (record) => ({ ...record, contents: mergeFirst(record.contents, values) }));
  }
  return next;
}

// ---- 歯式図の装置の線 ----

export interface ProsthesisMark {
  bridge: boolean;
  denture: boolean;
}

/** 歯ごとの装置の印(歯式図で、同じ装置の歯の間に線を引く)。 */
export function prosthesisMarks(teeth: ToothRecord[]): Map<string, ProsthesisMark> {
  const marks = new Map<string, ProsthesisMark>();
  for (const record of teeth) {
    const mark = marks.get(record.toothCode) ?? { bridge: false, denture: false };
    if (bridgeOfTooth([record], record.toothCode)) mark.bridge = true;
    if (dentureOfTooth([record], record.toothCode)) mark.denture = true;
    marks.set(record.toothCode, mark);
  }
  return marks;
}
