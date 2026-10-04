import type { Medicine } from "../api/masterClient";
import type { MedicineDoseConversionMap } from "./doseConversionHelpers";

// インスリンの指示(単位指定・血糖スケール・食事量スケール・フリースケール・単位指定+スケール)。
//
// 注射オーダーの薬剤行(MedicationRequest)の dosageInstruction[0] に持つ:
//   - 単位指定        doseAndRate.doseQuantity(単位)
//   - スケール        ローカル拡張 insulin-scale(種別 + 幅ごとの単位)
//   - 単位指定+スケール  doseQuantity(基本量)+ insulin-scale。施行量 = 基本量 + 該当する幅の単位
//   - スケールのみ    doseQuantity は持たず doseAndRate.doseRange(施行量の最小〜最大)
// dose[x] は choice なので doseQuantity と doseRange は併せ持てない。スケールのみで doseRange を
// 置くのは、単一の量を前提にした読み手(払出数量・カードの量の表示)が量を見失わないため。
// dosageInstruction.text にはスケールの要約を入れ、拡張を読めない相手にも読めるようにする。
//
// フリースケールは幅の代わりに条件を文で書き(「BS 200 以上かつ食事 5 割以上」)、実施入力で
// 当てはまる行を手で選ぶ。施設のスケールセット(マスタ)から写したときは、どのセットかを拡張に残す
// (写した後に行を直せば外す)。

export const INSULIN_SCALE_EXT_URL = "http://fhir-client.local/StructureDefinition/insulin-scale";
const INSULIN_SCALE_KIND_SYSTEM = "http://fhir-client.local/CodeSystem/insulin-scale-kind";

/** インスリンの量の単位。投与量換算マスタの from_unit と同じ表記。 */
export const INSULIN_UNIT = "単位";
const UCUM = "http://unitsofmeasure.org";
export const INSULIN_UCUM = "[iU]";

/** すい臓ホルモン剤の薬効分類。グルカゴン(mg)も含むので、単位の換算行と併せて判定する。 */
const INSULIN_YAKKO_CODE = "2492";

const INSULIN_SCALE_SET_SYSTEM = "http://fhir-client.local/CodeSystem/insulin-scale-set";

/**
 * スケールの種別。血糖(mg/dL)・食事量(主食の摂取量 %。経過表の食事摂取量と同じ値を読む)は
 * 測った値で行が決まり、フリースケールは条件の文を読んで行を選ぶ。
 */
export type InsulinScaleKind = "glucose" | "meal" | "free";
/** 測った値で行が決まる種別。 */
export type MeasuredInsulinScaleKind = Exclude<InsulinScaleKind, "free">;

export const INSULIN_SCALE_KIND_OPTIONS: { code: InsulinScaleKind; display: string; unit: string }[] = [
  { code: "glucose", display: "血糖", unit: "mg/dL" },
  { code: "meal", display: "食事量", unit: "%" },
  { code: "free", display: "フリー", unit: "" },
];

export function isMeasuredInsulinScaleKind(kind: InsulinScaleKind): kind is MeasuredInsulinScaleKind {
  return kind !== "free";
}

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
  /** フリースケールの条件(幅の代わり)。 */
  condition: string;
  /** その行で施行する単位(単位指定+スケールでは基本量への上乗せ)。 */
  dose: string;
  /** 「Dr コール」など。 */
  note: string;
}

/** 写した元のスケールセット(マスタ)。 */
export interface InsulinScaleSetRef {
  id: number;
  name: string;
}

export interface InsulinScaleValues {
  kind: InsulinScaleKind;
  rows: InsulinScaleRow[];
  /** スケールセットから写したまま直していなければ、その元。 */
  set?: InsulinScaleSetRef | null;
}

export function emptyInsulinScaleRow(): InsulinScaleRow {
  return { low: "", high: "", condition: "", dose: "", note: "" };
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
  return scale.rows.filter(
    (row) => row.low.trim() || row.high.trim() || row.condition.trim() || row.dose.trim() || row.note.trim(),
  );
}

/**
 * 並べる順。血糖・食事量は幅の小さい順(下限の無い行が先頭)、フリースケールは入力した順
 * (条件に大小が無い)。
 */
function orderedRows(scale: InsulinScaleValues): InsulinScaleRow[] {
  const rows = filledInsulinScaleRows(scale);
  if (scale.kind === "free") return rows;
  return [...rows].sort((a, b) => (numberOrNull(a.low) ?? -Infinity) - (numberOrNull(b.low) ?? -Infinity));
}

/** スケールの入力の誤り。空なら保存できる。 */
export function validateInsulinScale(scale: InsulinScaleValues): string[] {
  const rows = filledInsulinScaleRows(scale);
  if (rows.length === 0) return ["スケールの行がありません"];
  const errors: string[] = [];
  if (scale.kind === "free") {
    for (const row of rows) {
      const dose = numberOrNull(row.dose);
      if (!row.condition.trim()) errors.push("各行の条件を入力してください");
      if (dose === null || dose < 0) errors.push("各行の単位を 0 以上で入力してください");
    }
    return errors;
  }
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

  const sorted = orderedRows(scale);
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

/** 行の見出し。血糖・食事量は幅(「〜150」「151〜200」「301〜」)、フリースケールは条件。 */
export function insulinScaleRowLabel(row: InsulinScaleRow): string {
  return row.condition.trim() || insulinScaleRangeLabel(row);
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
  const rows = orderedRows(scale).map((row) => {
    const dose = row.dose.trim() ? `${row.dose}${INSULIN_UNIT}` : "";
    const note = row.note.trim();
    return `${insulinScaleRowLabel(row)}: ${[dose, note].filter(Boolean).join(" ")}`;
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

/** 測定値(血糖 mg/dL・主食 %)に当たる行。どの幅にも入らなければ null。フリースケールは選ぶので常に null。 */
export function matchInsulinScaleRow(scale: InsulinScaleValues, value: number): InsulinScaleRow | null {
  if (scale.kind === "free") return null;
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

/** 選んだ行(フリースケール)から施行量を出す。行が無ければ null。 */
export function guideInsulinDoseByRow(
  scale: InsulinScaleValues,
  baseDose: number | null,
  rowIndex: number | null,
): InsulinDoseGuide {
  const row = rowIndex === null ? null : (filledInsulinScaleRows(scale)[rowIndex] ?? null);
  const dose = row ? numberOrNull(row.dose) : null;
  return { dose: dose === null ? null : (baseDose ?? 0) + dose, row };
}

/** スケールセットの行を写したスケール。元のセットを覚えておく。 */
export function insulinScaleFromSet(set: {
  id: number;
  name: string;
  kind: InsulinScaleKind;
  rows: Partial<InsulinScaleRow>[];
}): InsulinScaleValues {
  return {
    kind: set.kind,
    rows: set.rows.map((row) => ({ ...emptyInsulinScaleRow(), ...row })),
    set: { id: set.id, name: set.name },
  };
}

// ---- FHIR ----

export function buildInsulinScaleExtension(scale: InsulinScaleValues): fhir4.Extension {
  const kind = INSULIN_SCALE_KIND_OPTIONS.find((o) => o.code === scale.kind);
  return {
    url: INSULIN_SCALE_EXT_URL,
    extension: [
      { url: "kind", valueCoding: { system: INSULIN_SCALE_KIND_SYSTEM, code: scale.kind, display: kind?.display } },
      ...(scale.set
        ? [
            {
              url: "set",
              valueCoding: { system: INSULIN_SCALE_SET_SYSTEM, code: String(scale.set.id), display: scale.set.name },
            },
          ]
        : []),
      ...orderedRows(scale).map((row) => {
        const low = numberOrNull(row.low);
        const high = numberOrNull(row.high);
        const dose = numberOrNull(row.dose);
        return {
          url: "row",
          extension: [
            ...(low !== null ? [{ url: "low", valueDecimal: low }] : []),
            ...(high !== null ? [{ url: "high", valueDecimal: high }] : []),
            ...(row.condition.trim() ? [{ url: "condition", valueString: row.condition.trim() }] : []),
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
  const kind: InsulinScaleKind = code === "meal" || code === "free" ? code : "glucose";
  const setCoding = extension.extension?.find((e) => e.url === "set")?.valueCoding;
  const setId = Number(setCoding?.code);
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
        condition: part("condition")?.valueString ?? "",
        dose: dose != null ? String(dose) : "",
        note: part("note")?.valueString ?? "",
      };
    });
  return {
    kind,
    rows,
    set: setCoding && Number.isInteger(setId) ? { id: setId, name: setCoding.display ?? "" } : null,
  };
}
