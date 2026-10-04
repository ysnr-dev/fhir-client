// オーダー・結果ヘルパー(処方・注射・検体検査・細菌検査・放射線)で共通の部品。
// ドメイン固有の CodeSystem/IdSystem はここに置かず、必要なら引数で受け取る。

import { dateTimeLabel, nowFhirDateTime } from "../lib/dates";

// ---- オーダーの日付(全種別で共通の意味) ----
//
//   ServiceRequest.authoredOn         = オーダー登録日時(システム時刻。編集で動かさない)
//   ServiceRequest.occurrenceDateTime = オーダー開始日(実施予定日。種別ごとの「検査日」「注射日」
//                                       「投与開始日」「開始日」などがここに入る)
//
// 日付未定を許すのは手術だけ(occurrence を出さない = 日付未定)。カルテのカードの位置・部門一覧の
// 日付軸はすべて occurrence。登録日時はフォームで入力するものではなく、初回保存時に採る。

/**
 * オーダーの登録日時(authoredOn)。新規登録はいま、更新は元のリソースの値をそのまま引き継ぐ
 * (編集で登録日時が動くと「いつ出したオーダーか」が消える)。DO(流用)は新規なので引数なし。
 */
export function registrationAuthoredOn(
  original?: Pick<fhir4.ServiceRequest, "authoredOn"> | null,
): string {
  return original?.authoredOn || nowFhirDateTime();
}

/**
 * オーダーの開始日(YYYY-MM-DD)。occurrence 優先、無ければ登録日時の日付
 * (occurrence を持たないオーダーのフォールバック。手術の日付未定以外では起きない)。
 */
export function orderDay(
  sr: Pick<fhir4.ServiceRequest, "occurrenceDateTime" | "authoredOn">,
): string {
  return (sr.occurrenceDateTime ?? sr.authoredOn ?? "").slice(0, 10);
}

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

/** コードと表示名の組(選択肢)。 */
export interface CodeOption {
  code: string;
  display: string;
}

/** 選択肢から code の表示名を引く(見つからなければ code のまま、code が空なら空文字)。 */
export function displayOf(options: readonly CodeOption[], code: string | null | undefined): string {
  if (!code) return "";
  return options.find((o) => o.code === code)?.display ?? code;
}

/** オーダーの通常/至急。各オーダーで共通の選択肢。 */
export const PRIORITY_OPTIONS: { code: "routine" | "urgent"; display: string }[] = [
  { code: "routine", display: "通常" },
  { code: "urgent", display: "至急" },
];

/**
 * 事後(実施済みの検査を後から入力する)の至急区分。FHIR の priority に事後を表す
 * 値は無いので asap を充てる(手術の予定区分が stat を「緊急」に充てるのと同じ)。
 */
export const RETRO_PRIORITY = "asap" as const;

/** 事後を足した至急区分。実施をその場で入れられる部門(放射線・生理・内視鏡)で使う。 */
export const EXAM_PRIORITY_OPTIONS: {
  code: "routine" | "urgent" | typeof RETRO_PRIORITY;
  display: string;
}[] = [...PRIORITY_OPTIONS, { code: RETRO_PRIORITY, display: "事後" }];

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

/** 明細の並び順。identifier に採番した番号を持たない明細は 0。 */
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

export const LOINC_SYSTEM = "http://loinc.org";

/** Observation の LOINC コード(無ければ空)。 */
export function loincOf(observation: fhir4.Observation): string {
  return observation.code?.coding?.find((c) => c.system === LOINC_SYSTEM)?.code ?? "";
}

/** "ResourceType/id" の参照が指定した型のときだけ id を返す(違う型・未設定は空文字)。 */
export function referenceIdOfType(reference: string | undefined, resourceType: string): string {
  return reference?.match(new RegExp(`^${resourceType}/(.+)$`))?.[1] ?? "";
}

/** CodeableConcept の表示名。text、表示名を持つ coding、先頭の coding のコードの順で採る。 */
export function conceptLabel(concept: fhir4.CodeableConcept | undefined): string {
  if (!concept) return "";
  const coding = concept.coding?.find((c) => c.display) ?? concept.coding?.[0];
  return concept.text || coding?.display || coding?.code || "";
}

/** 数量の表示(「2mL」)。値が無ければ空。 */
export function quantityLabel(quantity: fhir4.Quantity | undefined): string {
  if (!quantity || quantity.value == null) return "";
  return `${quantity.value}${quantity.unit ?? ""}`;
}

/**
 * 実施記録に使った器材の表示(名称と数量)。usedCode は数量を持てないので、登録時に付けた
 * 拡張(部門ごとの quantityExtensionUrl)から数量を読む。
 */
export function materialLabel(usedCode: fhir4.CodeableConcept, quantityExtensionUrl: string): string {
  const extension = usedCode.extension?.find((e) => e.url === quantityExtensionUrl);
  return [conceptLabel(usedCode), quantityLabel(extension?.valueQuantity)].filter(Boolean).join(" ");
}

/** 実施日時の表示。カードの診療日と実施日は別日になりうるので日付ごと出す。 */
export function performedLabel(procedure: fhir4.Procedure): string {
  return dateTimeLabel(procedure.performedDateTime ?? procedure.performedPeriod?.start);
}

/** 書き込みの単位。エントリを 1 つの transaction Bundle にまとめる。 */
export function transactionBundle(entry: fhir4.BundleEntry[]): fhir4.Bundle {
  return { resourceType: "Bundle", type: "transaction", entry };
}

/** 読んだ時点の版を表す ETag(`W/"3"`)。版を持たないリソースは undefined。 */
export function versionEtag(resource: { meta?: fhir4.Meta } | undefined): string | undefined {
  const versionId = resource?.meta?.versionId;
  return versionId ? `W/"${versionId}"` : undefined;
}

/**
 * Bundle の PUT エントリに、読んだ時点の版を ifMatch で添える(楽観ロック。ほかの人が先に
 * 更新していたら transaction ごと 412 になる)。版は loaded(画面が読み込んだ元のリソース)から、
 * 無ければエントリのリソース自身の meta.versionId から取る。フォームの値から組み直した
 * リソースは meta を持たないので、更新用のビルダーが元のリソースを loaded に渡す。
 * ifMatch を指定済みのエントリと、版の分からないエントリはそのまま。同じリソースを 1 つの
 * Bundle で 2 回書くときは最初の 1 回にだけ添える(1 回目で版が進むため)。
 */
export function withVersionLock(bundle: fhir4.Bundle, ...loaded: (fhir4.Resource | undefined)[]): fhir4.Bundle {
  const etagByUrl = new Map<string, string>();
  for (const resource of loaded) {
    const etag = versionEtag(resource);
    if (resource?.id && etag) etagByUrl.set(`${resource.resourceType}/${resource.id}`, etag);
  }
  let changed = false;
  const written = new Set<string>();
  const entry = (bundle.entry ?? []).map((item) => {
    const request = item.request;
    if (request?.method !== "PUT") return item;
    const first = !written.has(request.url);
    written.add(request.url);
    if (request.ifMatch || !first) return item;
    const ifMatch = etagByUrl.get(request.url) ?? versionEtag(item.resource);
    if (!ifMatch) return item;
    changed = true;
    return { ...item, request: { ...request, ifMatch } };
  });
  return changed ? { ...bundle, entry } : bundle;
}

/** オーダーの緊急度の表示(通常・至急・事後)。未設定なら空。 */
export function priorityDisplay(priority: string | undefined): string {
  return priority ? displayOf(EXAM_PRIORITY_OPTIONS, priority) : "";
}

/** 項目マスタの略称を coding に添えるときの system。 */
export const ABBREVIATION_SYSTEM = "http://fhir-client.local/CodeSystem/lab-item-abbreviation";

/** 実施記録に使った器材(医療材料)の coding の system。 */
export const MEDICAL_MATERIAL_SYSTEM = "http://fhir-client.local/CodeSystem/medical-material";
