// オーダー・結果ヘルパー(処方・注射・検体検査・細菌検査・放射線)で共通の部品。
// ドメイン固有の CodeSystem/IdSystem はここに置かず、必要なら引数で受け取る。

/** codings から指定 system の Coding を探す。 */
export function codingBySystem(
  codings: fhir4.Coding[] | undefined,
  system: string,
): fhir4.Coding | undefined {
  return codings?.find((c) => c.system === system);
}

/** category を持つリソース(ServiceRequest / DiagnosticReport)から指定 system の Coding を探す。 */
export function categoryCoding(
  resource: { category?: fhir4.CodeableConcept[] },
  system: string,
): fhir4.Coding | undefined {
  for (const category of resource.category ?? []) {
    const coding = codingBySystem(category.coding, system);
    if (coding) return coding;
  }
  return undefined;
}

/** {code, display} の選択肢から code の表示名を引く(見つからなければ code のまま)。 */
export function displayOf<T extends { code: string; display: string }>(
  options: T[],
  code: string,
): string {
  return options.find((o) => o.code === code)?.display ?? code;
}

/** オーダーの通常/至急。各オーダーで共通の選択肢。 */
export const PRIORITY_OPTIONS: { code: "routine" | "urgent"; display: string }[] = [
  { code: "routine", display: "通常" },
  { code: "urgent", display: "至急" },
];

/** 入院/外来。system はオーダー系・結果系で別なので、選択肢と表示名だけを共有する。 */
export const SETTING_OPTIONS: { code: "inpatient" | "outpatient"; display: string }[] = [
  { code: "inpatient", display: "入院" },
  { code: "outpatient", display: "外来" },
];

export function findSettingDisplay(code: string): string {
  return SETTING_OPTIONS.find((s) => s.code === code)?.display ?? code;
}

/** オーダーのコメント(note の先頭)。 */
export function orderComment(sr: fhir4.ServiceRequest): string {
  return sr.note?.[0]?.text ?? "";
}

/** 明細の並び順。identifier に採番した番号を持たない明細(contained だった頃)は 0。 */
export function itemNumber(request: fhir4.ServiceRequest, system: string): number {
  const value = request.identifier?.find((i) => i.system === system)?.value;
  return value ? Number(value) : 0;
}

/** 明細が親オーダーを指す basedOn から親の ServiceRequest id を取り出す。 */
export function parentRequestId(sr: fhir4.ServiceRequest): string | undefined {
  const reference = sr.basedOn?.[0]?.reference;
  return reference?.startsWith("ServiceRequest/") ? reference.split("/")[1] : undefined;
}

/** "ResourceType/id" 形式(サーバーによっては絶対 URL)の参照から id を取り出す。 */
export function referenceId(reference: string | undefined): string | undefined {
  return reference?.split("/").pop() || undefined;
}
