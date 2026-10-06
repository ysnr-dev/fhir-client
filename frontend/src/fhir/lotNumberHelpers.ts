// 薬剤のロット番号(docs/lot-number-design.md)。
//
// どの実施入力も 1 薬剤 = MedicationAdministration 1 件で、薬は medicationCodeableConcept に持つ
// (contained Medication は使わない。docs/transfusion-order-design.md §2.6)。ロットも Medication.batch
// ではなく MedicationAdministration のローカル拡張に持つ。輸血の製剤番号(transfusion-lot-number)と
// 同じ作法で、上流の lot-number 検索は両方の拡張を引く。

export const MEDICATION_LOT_NUMBER_EXT_URL = "http://fhir-client.local/StructureDefinition/medication-lot-number";
const TRANSFUSION_LOT_NUMBER_EXT_URL = "http://fhir-client.local/StructureDefinition/transfusion-lot-number";
const LOT_NUMBER_EXT_URLS = [MEDICATION_LOT_NUMBER_EXT_URL, TRANSFUSION_LOT_NUMBER_EXT_URL];

/** バーコードリーダーや IME の入力を半角英数・記号にそろえ、前後の空白を落とす。 */
export function normalizeLotNumber(value: string): string {
  return value.normalize("NFKC").trim();
}

/** 記録したロット番号(薬剤・輸血の製剤番号)。無ければ空文字。 */
export function lotNumberOf(administration: fhir4.MedicationAdministration): string {
  return administration.extension?.find((e) => LOT_NUMBER_EXT_URLS.includes(e.url ?? ""))?.valueString ?? "";
}

/** ロット番号の拡張を付け替えた写し。空なら拡張を外す。拡張以外は触らない。 */
export function withLotNumber(
  administration: fhir4.MedicationAdministration,
  lotNumber: string,
): fhir4.MedicationAdministration {
  const lot = normalizeLotNumber(lotNumber);
  const others = (administration.extension ?? []).filter((e) => e.url !== MEDICATION_LOT_NUMBER_EXT_URL);
  const extension = lot ? [...others, { url: MEDICATION_LOT_NUMBER_EXT_URL, valueString: lot }] : others;
  const next: fhir4.MedicationAdministration = { ...administration, extension };
  if (!extension.length) delete next.extension;
  return next;
}

/** 薬剤の表示に添えるロット(「ロット AB1234」)。無ければ空文字。 */
export function lotNumberLabel(administration: fhir4.MedicationAdministration): string {
  const lot = lotNumberOf(administration);
  return lot ? `ロット ${lot}` : "";
}

/**
 * 同じ記録の中で、同じ薬に同じロットを書いた行の位置。取り違えの入力(2 本目に 1 本目のロットを
 * 読ませたなど)を行のエラーにする。
 */
export function duplicateLotIndexes(lines: { code: string; lotNumber?: string }[]): Set<number> {
  const seen = new Map<string, number>();
  const duplicates = new Set<number>();
  lines.forEach((line, index) => {
    const lot = normalizeLotNumber(line.lotNumber ?? "");
    if (!lot || !line.code) return;
    const key = `${line.code}\u0000${lot}`;
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, index);
    } else {
      duplicates.add(first);
      duplicates.add(index);
    }
  });
  return duplicates;
}
