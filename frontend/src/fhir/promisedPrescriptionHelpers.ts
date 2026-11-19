import type { PromisedPrescription } from "../api/masterClient";

// 約束処方(院内で決めた組み合わせと量に名前を付けたもの)。
// 処方では構成薬をそれぞれ通常の明細(MedicationRequest)として同じ RP に並べ、各明細にこの拡張で
// 約束処方の名称・量と組の番号を写す。請求・調剤・薬剤チェックは構成薬の明細をそのまま読み、
// 画面と処方箋だけが組を「約束処方名 + 内訳」にまとめて見せる。

export const PROMISED_PRESCRIPTION_EXT_URL = "http://fhir-client.local/StructureDefinition/promised-prescription";

/** 構成薬の行が持つ、属する約束処方。 */
export interface PromisedLine {
  /** RP 内の組の番号。同じ約束処方を 2 回入れても別の組になる。 */
  group: number;
  code: string;
  name: string;
  /** 約束処方としての量(用量欄と同じ入力区分)。 */
  amount: string;
  unit: string;
  /** この構成薬の量 ÷ 約束処方の基準量。 */
  ratio: number;
}

export function promisedExtension(promised: PromisedLine): fhir4.Extension {
  return {
    url: PROMISED_PRESCRIPTION_EXT_URL,
    extension: [
      { url: "code", valueString: promised.code },
      { url: "name", valueString: promised.name },
      { url: "group", valueInteger: promised.group },
      ...(Number(promised.amount) > 0
        ? [{ url: "amount", valueQuantity: { value: Number(promised.amount), unit: promised.unit } }]
        : []),
      { url: "ratio", valueDecimal: promised.ratio },
    ],
  };
}

export function promisedOf(mr: fhir4.MedicationRequest): PromisedLine | undefined {
  const parts = mr.extension?.find((ext) => ext.url === PROMISED_PRESCRIPTION_EXT_URL)?.extension;
  if (!parts) return undefined;
  const part = (url: string) => parts.find((ext) => ext.url === url);
  const name = part("name")?.valueString;
  if (!name) return undefined;
  const amount = part("amount")?.valueQuantity;
  return {
    group: part("group")?.valueInteger ?? 0,
    code: part("code")?.valueString ?? "",
    name,
    amount: amount?.value != null ? String(amount.value) : "",
    unit: amount?.unit ?? "",
    ratio: part("ratio")?.valueDecimal ?? 0,
  };
}

function plain(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** 約束処方の量に対する構成薬の量。量が空なら空。 */
export function promisedDose(ratio: number, amount: string): string {
  const value = Number(amount);
  return amount && value > 0 ? plain(ratio * value) : "";
}

/** マスタ 1 件を、基準量で処方したときの構成薬の行(約束処方の情報と量)にする。 */
export function promisedLinesOf(master: PromisedPrescription, group: number): { medicineCode: string; unit: string | null; dose: string; promised: PromisedLine }[] {
  const base = Number(master.base_amount);
  const amount = plain(base);
  return master.items.map((item) => {
    const ratio = Number(item.amount) / base;
    return {
      medicineCode: item.medicine_code,
      unit: item.unit_name,
      dose: promisedDose(ratio, amount),
      promised: { group, code: master.code, name: master.name, amount, unit: master.unit_name, ratio },
    };
  });
}

/** 組の量を変えて、構成薬の量を比例させる。 */
export function rescalePromised<L extends { dose: string; promised?: PromisedLine }>(
  lines: L[],
  group: number,
  amount: string,
): L[] {
  return lines.map((line) =>
    line.promised?.group === group
      ? { ...line, dose: promisedDose(line.promised.ratio, amount), promised: { ...line.promised, amount } }
      : line,
  );
}

/** RP 内で次に使う組の番号。 */
export function nextPromisedGroup(lines: { promised?: PromisedLine }[]): number {
  return Math.max(0, ...lines.map((line) => line.promised?.group ?? 0)) + 1;
}

export type PromisedEntry<L> =
  | { kind: "line"; line: L; index: number }
  | { kind: "promised"; promised: PromisedLine; lines: L[]; index: number };

/** 行の並びを、単独の行と約束処方の組(連続する同じ組の行)に分ける。index は先頭の行の位置。 */
export function collapsePromised<L extends { promised?: PromisedLine }>(lines: L[]): PromisedEntry<L>[] {
  const entries: PromisedEntry<L>[] = [];
  lines.forEach((line, index) => {
    const last = entries[entries.length - 1];
    if (!line.promised) entries.push({ kind: "line", line, index });
    else if (last?.kind === "promised" && last.promised.group === line.promised.group) last.lines.push(line);
    else entries.push({ kind: "promised", promised: line.promised, lines: [line], index });
  });
  return entries;
}

/** 約束処方の量の表示(「100g」)。量が無ければ空。 */
export function promisedAmountText(promised: PromisedLine): string {
  return promised.amount ? `${promised.amount}${promised.unit}` : "";
}

/** マスタの構成薬の要約(「A 25g・B 25g」)。 */
export function promisedItemsSummary(master: PromisedPrescription): string {
  return master.items
    .map((item) => `${item.medicine_name ?? item.medicine_code} ${Number(item.amount)}${item.unit_name ?? ""}`)
    .join("・");
}

// index の行から続く、同じ約束処方の構成薬の行数。約束処方でない行は 1。
export function promisedSpan(lines: { promised?: { group: number } }[], index: number): number {
  const group = lines[index]?.promised?.group;
  if (group === undefined) return 1;
  let end = index + 1;
  while (lines[end]?.promised?.group === group) end += 1;
  return end - index;
}
