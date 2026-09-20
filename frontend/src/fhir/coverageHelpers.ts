// 保険・公費(Coverage)の読み取り。
//
// 保険はレセコンが正本で、カルテからは登録しない。読む側だけを用意する。
// JP Core は 1 リソース 1 保険なので、「同時に使う保険の組」は class に入っている。

/** カルテがレセコン連携で発行する識別子の名前空間。レセコンの製品名は入れない。 */
const NAMESPACE = "http://fhir-client.local/integrations/receipt-computer";
export const COVERAGE_IDENTIFIER_SYSTEM = `${NAMESPACE}/coverage`;
export const COVERAGE_CLASS_SYSTEM = `${NAMESPACE}/coverage-class`;
export const RECEPTION_COVERAGE_SET_URL = `${NAMESPACE}/StructureDefinition/reception-coverage-set`;
/** 請求セット(同時に適用する保険の組)を表す class のコード。 */
const BILLING_SET_CODE = "billing-set";

const INSURED_SYMBOL_EXT =
  "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_Coverage_InsuredPersonSymbol";
const INSURED_NUMBER_EXT =
  "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_Coverage_InsuredPersonNumber";
const INSURED_SUBNUMBER_EXT =
  "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_Coverage_InsuredPersonSubNumber";

/** 画面に出す保険 1 件。 */
export interface CoverageRow {
  id: string;
  name: string;
  insurerNumber: string | null;
  /** 記号・番号・枝番。公費では受給者番号を number に入れる。 */
  symbol: string | null;
  number: string | null;
  branch: string | null;
  copayPercent: number | null;
  start: string | null;
  end: string | null;
  active: boolean;
}

/** 会計で選ぶ「請求セット」。キーはレセコンが採番した不透明な値。 */
export interface CoverageSet {
  key: string;
  label: string;
  memberIds: string[];
}

function extensionValue(coverage: fhir4.Coverage, url: string): string | null {
  const found = coverage.extension?.find((e) => e.url === url);
  return found?.valueString ?? null;
}

function billingSetEntries(coverage: fhir4.Coverage) {
  return (coverage.class ?? []).filter((c) =>
    c.type?.coding?.some((k) => k.system === COVERAGE_CLASS_SYSTEM && k.code === BILLING_SET_CODE),
  );
}

export function coverageDisplayName(coverage: fhir4.Coverage): string {
  return (
    coverage.type?.text ||
    coverage.type?.coding?.[0]?.display ||
    coverage.payor?.[0]?.display ||
    "保険"
  );
}

export function coverageCopayPercent(coverage: fhir4.Coverage): number | null {
  const quantity = coverage.costToBeneficiary?.find((c) => c.valueQuantity)?.valueQuantity;
  return typeof quantity?.value === "number" ? quantity.value : null;
}

export function coverageRow(coverage: fhir4.Coverage): CoverageRow {
  return {
    id: coverage.id ?? "",
    name: coverageDisplayName(coverage),
    insurerNumber: coverage.payor?.[0]?.identifier?.value ?? null,
    symbol: extensionValue(coverage, INSURED_SYMBOL_EXT),
    // 公費は記号・番号を持たず受給者番号(subscriberId)で表す。
    number: extensionValue(coverage, INSURED_NUMBER_EXT) ?? coverage.subscriberId ?? null,
    branch: extensionValue(coverage, INSURED_SUBNUMBER_EXT),
    copayPercent: coverageCopayPercent(coverage),
    start: coverage.period?.start ?? null,
    end: coverage.period?.end ?? null,
    active: coverage.status === "active",
  };
}

/**
 * 会計で選べる請求セット。同じ保険が複数のセットに属することがあるので、
 * セット側から引き直して作る。
 */
export function coverageSetsOf(coverages: fhir4.Coverage[]): CoverageSet[] {
  const sets = new Map<string, CoverageSet>();

  for (const coverage of coverages) {
    if (coverage.status !== "active") continue;
    for (const entry of billingSetEntries(coverage)) {
      const key = entry.value;
      if (!key) continue;
      const existing = sets.get(key);
      if (existing) {
        existing.memberIds.push(coverage.id ?? "");
        // 主保険(order=1)のラベルを優先する。公費だけのラベルにならないように。
        if (coverage.order === 1 && entry.name) existing.label = entry.name;
      } else {
        sets.set(key, {
          key,
          label: entry.name || coverageDisplayName(coverage),
          memberIds: [coverage.id ?? ""],
        });
      }
    }
  }

  return [...sets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** 受付に記録された請求セット。会計送信の初期値に使う。 */
export function receptionCoverageSetKey(appointment: fhir4.Appointment | undefined): string {
  return (
    appointment?.extension?.find((e) => e.url === RECEPTION_COVERAGE_SET_URL)?.valueString ?? ""
  );
}
