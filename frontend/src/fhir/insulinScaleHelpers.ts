import type { Medicine } from "../api/masterClient";
import type { MedicineDoseConversionMap } from "./doseConversionHelpers";

// インスリンの指示(単位指定・血糖スケール・食事量スケール・単位指定+スケール)。
//
// 注射オーダーの薬剤行(MedicationRequest)の dosageInstruction[0] に持つ:
//   - 単位指定        doseAndRate.doseQuantity(単位)
//   - スケール        ローカル拡張 insulin-scale(種別 + 幅ごとの単位)
//   - 単位指定+スケール  doseQuantity(基本量)+ insulin-scale。施行量 = 基本量 + 該当する幅の単位
//   - スケールのみ    doseQuantity は持たず doseAndRate.doseRange(施行量の最小〜最大)
// dose[x] は choice なので doseQuantity と doseRange は併せ持てない。スケールのみで doseRange を
// 置くのは、単一の量を前提にした読み手(払出数量・カードの量の表示)が量を見失わないため。
// dosageInstruction.text にはスケールの要約を入れ、拡張を読めない相手にも読めるようにする。

export const INSULIN_SCALE_EXT_URL = "http://fhir-client.local/StructureDefinition/insulin-scale";
const INSULIN_SCALE_KIND_SYSTEM = "http://fhir-client.local/CodeSystem/insulin-scale-kind";

/** インスリンの量の単位。投与量換算マスタの from_unit と同じ表記。 */
export const INSULIN_UNIT = "単位";
const UCUM = "http://unitsofmeasure.org";
const INSULIN_UCUM = "[iU]";

/** すい臓ホルモン剤の薬効分類。グルカゴン(mg)も含むので、単位の換算行と併せて判定する。 */
const INSULIN_YAKKO_CODE = "2492";

/** 主食の摂取量(%)で単位を変えるときの基準。経過表の食事摂取量(主食)と同じ値を読む。 */
export type InsulinScaleKind = "glucose" | "meal";

export const INSULIN_SCALE_KIND_OPTIONS: { code: InsulinScaleKind; display: string; unit: string }[] = [
  { code: "glucose", display: "血糖", unit: "mg/dL" },
  { code: "meal", display: "食事量", unit: "%" },
];

export function insulinScaleKindDisplay(kind: InsulinScaleKind): string {
  return INSULIN_SCALE_KIND_OPTIONS.find((o) => o.code === kind)?.display ?? kind;
}

export function insulinScaleKindUnit(kind: InsulinScaleKind): string {
  return INSULIN_SCALE_KIND_OPTIONS.find((o) => o.code === kind)?.unit ?? "";
}

/** スケールの 1 行。幅は両端を含む整数。片側は空でよい(「〜150」「301〜」)。 */
export interface InsulinScaleRow {
  low: string;
  high: string;
  /** その幅で施行する単位(単位指定+スケールでは基本量への上乗せ)。 */
  dose: string;
  /** 「Dr コール」など。 */
  note: string;
}

export interface InsulinScaleValues {
  kind: InsulinScaleKind;
  rows: InsulinScaleRow[];
}

export function emptyInsulinScaleRow(): InsulinScaleRow {
  return { low: "", high: "", dose: "", note: "" };
}

export function emptyInsulinScale(kind: InsulinScaleKind = "glucose"): InsulinScaleValues {
  return { kind, rows: [emptyInsulinScaleRow(), emptyInsulinScaleRow(), emptyInsulinScaleRow()] };
}

/** 薬効分類がすい臓ホルモン剤か。インスリンかどうかは換算行と併せて isInsulinMedicine で決める。 */
export function hasInsulinYakkoCode(medicine: Pick<Medicine, "yakko_code"> | null | undefined): boolean {
  return Boolean(medicine?.yakko_code?.startsWith(INSULIN_YAKKO_CODE));
}

/**
 * インスリン製剤か。薬効分類 2492 で、投与量換算マスタに「単位」の行がある薬剤。保存済みの
 * オーダーから起こした薬剤は薬効分類を持たないので、量の単位が「単位」なら換算行だけで判定する。
 */
export function isInsulinMedicine(
  medicine: Pick<Medicine, "medicine_code" | "yakko_code" | "unit_name"> | null | undefined,
  conversions: MedicineDoseConversionMap | undefined,
): boolean {
  if (!medicine?.medicine_code) return false;
  if (!conversions?.factors.get(medicine.medicine_code)?.has(INSULIN_UNIT)) return false;
  return hasInsulinYakkoCode(medicine) || medicine.unit_name === INSULIN_UNIT;
}

/** 量の単位を「単位」にした薬剤。オーダーの doseQuantity.unit はこの unit_name が写る。 */
export function withInsulinUnit<T extends Medicine>(medicine: T): T {
  return { ...medicine, unit_name: INSULIN_UNIT };
}

/** 単位の Quantity。UCUM の国際単位を添える。 */
export function insulinQuantity(value: number): fhir4.Quantity {
  return { value, unit: INSULIN_UNIT, system: UCUM, code: INSULIN_UCUM };
}

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 単位が入っている行だけ。幅も単位も空の行はフォームの空き行として捨てる。 */
export function filledInsulinScaleRows(scale: InsulinScaleValues): InsulinScaleRow[] {
  return scale.rows.filter((row) => row.low.trim() || row.high.trim() || row.dose.trim() || row.note.trim());
}

/** 行を幅の小さい順に。下限の無い行が先頭。 */
function sortedRows(rows: InsulinScaleRow[]): InsulinScaleRow[] {
  return [...rows].sort((a, b) => (numberOrNull(a.low) ?? -Infinity) - (numberOrNull(b.low) ?? -Infinity));
}

/** スケールの入力の誤り。空なら保存できる。 */
export function validateInsulinScale(scale: InsulinScaleValues): string[] {
  const rows = filledInsulinScaleRows(scale);
  if (rows.length === 0) return ["スケールの行がありません"];
  const errors: string[] = [];
  for (const row of rows) {
    const low = numberOrNull(row.low);
    const high = numberOrNull(row.high);
    const dose = numberOrNull(row.dose);
    if (row.low.trim() && (low === null || !Number.isInteger(low))) errors.push(`下限「${row.low}」は整数で入力してください`);
    if (row.high.trim() && (high === null || !Number.isInteger(high))) errors.push(`上限「${row.high}」は整数で入力してください`);
    if (low === null && high === null) errors.push("下限か上限のどちらかを入力してください");
    if (low !== null && high !== null && low > high) errors.push(`${row.low}〜${row.high} は下限が上限を超えています`);
    if (dose === null || dose < 0) errors.push("各行の単位を 0 以上で入力してください");
  }
  if (errors.length) return errors;

  const sorted = sortedRows(rows);
  for (let i = 1; i < sorted.length; i++) {
    const prevHigh = numberOrNull(sorted[i - 1].high);
    const low = numberOrNull(sorted[i].low);
    if (prevHigh === null || low === null) {
      errors.push("上限の無い行・下限の無い行は両端にだけ置けます");
    } else if (low <= prevHigh) {
      errors.push(`${insulinScaleRangeLabel(sorted[i - 1])} と ${insulinScaleRangeLabel(sorted[i])} の幅が重なっています`);
    } else if (low > prevHigh + 1) {
      errors.push(`${prevHigh + 1}〜${low - 1} に当たる行がありません`);
    }
  }
  return errors;
}

/** 「〜150」「151〜200」「301〜」。 */
export function insulinScaleRangeLabel(row: Pick<InsulinScaleRow, "low" | "high">): string {
  const low = row.low.trim();
  const high = row.high.trim();
  if (low && high) return `${low}〜${high}`;
  if (high) return `〜${high}`;
  return `${low}〜`;
}

/** 「血糖スケール 〜150: 0単位 / 151〜200: 2単位 / 301〜: 4単位 Dr コール」。基本量があれば「基本 4単位 + 」を前に付ける。 */
export function insulinScaleSummary(scale: InsulinScaleValues, baseDose?: number | null): string {
  const rows = sortedRows(filledInsulinScaleRows(scale)).map((row) => {
    const dose = row.dose.trim() ? `${row.dose}${INSULIN_UNIT}` : "";
    const note = row.note.trim();
    return `${insulinScaleRangeLabel(row)}: ${[dose, note].filter(Boolean).join(" ")}`;
  });
  const base = baseDose != null ? `基本 ${baseDose}${INSULIN_UNIT} + ` : "";
  return `${base}${insulinScaleKindDisplay(scale.kind)}スケール ${rows.join(" / ")}`;
}

/** スケールで施行しうる量の最小・最大(基本量込み)。 */
export function insulinDoseRange(
  scale: InsulinScaleValues,
  baseDose: number | null,
): { low: number; high: number } | null {
  const doses = filledInsulinScaleRows(scale)
    .map((row) => numberOrNull(row.dose))
    .filter((dose): dose is number => dose !== null);
  if (doses.length === 0) return null;
  const base = baseDose ?? 0;
  return { low: base + Math.min(...doses), high: base + Math.max(...doses) };
}

/** 測定値(血糖 mg/dL・主食 %)に当たる行。どの幅にも入らなければ null。 */
export function matchInsulinScaleRow(scale: InsulinScaleValues, value: number): InsulinScaleRow | null {
  return (
    filledInsulinScaleRows(scale).find((row) => {
      const low = numberOrNull(row.low);
      const high = numberOrNull(row.high);
      return (low === null || value >= low) && (high === null || value <= high);
    }) ?? null
  );
}

export interface InsulinDoseGuide {
  /** 案内する施行量。測定値が無い・どの幅にも入らない・行に単位が無いときは null。 */
  dose: number | null;
  row: InsulinScaleRow | null;
}

/** 測定値から施行量を案内する。施行量 = 基本量 + 当たった行の単位。 */
export function guideInsulinDose(
  scale: InsulinScaleValues,
  baseDose: number | null,
  value: number | null,
): InsulinDoseGuide {
  if (value === null) return { dose: null, row: null };
  const row = matchInsulinScaleRow(scale, value);
  const dose = row ? numberOrNull(row.dose) : null;
  return { dose: dose === null ? null : (baseDose ?? 0) + dose, row };
}

// ---- FHIR ----

export function buildInsulinScaleExtension(scale: InsulinScaleValues): fhir4.Extension {
  const kind = INSULIN_SCALE_KIND_OPTIONS.find((o) => o.code === scale.kind);
  return {
    url: INSULIN_SCALE_EXT_URL,
    extension: [
      { url: "kind", valueCoding: { system: INSULIN_SCALE_KIND_SYSTEM, code: scale.kind, display: kind?.display } },
      ...sortedRows(filledInsulinScaleRows(scale)).map((row) => {
        const low = numberOrNull(row.low);
        const high = numberOrNull(row.high);
        const dose = numberOrNull(row.dose);
        return {
          url: "row",
          extension: [
            ...(low !== null ? [{ url: "low", valueDecimal: low }] : []),
            ...(high !== null ? [{ url: "high", valueDecimal: high }] : []),
            ...(dose !== null ? [{ url: "dose", valueQuantity: insulinQuantity(dose) }] : []),
            ...(row.note.trim() ? [{ url: "note", valueString: row.note.trim() }] : []),
          ],
        };
      }),
    ],
  };
}

/** dosageInstruction からスケールを読む。無ければ null。 */
export function insulinScaleOf(dosage: fhir4.Dosage | undefined): InsulinScaleValues | null {
  const extension = dosage?.extension?.find((e) => e.url === INSULIN_SCALE_EXT_URL);
  if (!extension) return null;
  const code = extension.extension?.find((e) => e.url === "kind")?.valueCoding?.code;
  const kind: InsulinScaleKind = code === "meal" ? "meal" : "glucose";
  const rows = (extension.extension ?? [])
    .filter((e) => e.url === "row")
    .map((e) => {
      const part = (url: string) => e.extension?.find((x) => x.url === url);
      const low = part("low")?.valueDecimal;
      const high = part("high")?.valueDecimal;
      const dose = part("dose")?.valueQuantity?.value;
      return {
        low: low != null ? String(low) : "",
        high: high != null ? String(high) : "",
        dose: dose != null ? String(dose) : "",
        note: part("note")?.valueString ?? "",
      };
    });
  return { kind, rows };
}
