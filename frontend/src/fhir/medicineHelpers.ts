// 医薬品マスタの剤形区分コード（薬価基準収載データの区分）を表示名に変換する。
const DOSAGE_FORM_LABELS: Record<string, string> = {
  "1": "内用薬",
  "3": "その他",
  "4": "注射薬",
  "6": "外用薬",
  "8": "歯科用薬剤",
};

export function dosageFormLabel(dosageForm: string | null | undefined): string {
  if (!dosageForm) return "-";
  return DOSAGE_FORM_LABELS[dosageForm] ?? dosageForm;
}
