// 定期検査・検診(docs/advisory-design.md §2.10)。
//
// 施設の規則に「定期項目」(何を・どの間隔で)を持たせたものが定期検査・検診の規則。条件式は対象の患者を選び
// (「ワルファリン内服中」「2 型糖尿病」など)、項目の最終実施日と間隔から期限を出す。期限を過ぎた、または記録が無い
// 項目は施設の規則の警告として出す。延期・対象外は患者の Flag(category health-maintenance)に理由つきで残す。
import { addDays, today as todayString } from "../lib/dates";
import { FLAG_CATEGORY_SYSTEM } from "./flagHelpers";

/** 最終実施日を引くリソース。backend の Master::AdvisoryRule::MAINTENANCE_KINDS はこの写し。 */
export const MAINTENANCE_KINDS = ["lab", "procedure", "immunization"] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

export const MAINTENANCE_KIND_LABELS: Record<MaintenanceKind, string> = {
  lab: "検査項目",
  procedure: "実施記録",
  immunization: "予防接種",
};

/** マスタ `master_advisory_rules.maintenance`。 */
export interface AdvisoryRuleMaintenance {
  kind: MaintenanceKind;
  /** 検査項目は結果項目マスタの施設コード。実施記録・予防接種はコード(「体系|コード」でも可)。 */
  code: string;
  name: string | null;
  interval_days: number;
}

/** 延期・対象外の Flag の区分。診療上の注意の一覧・患者帯からは除く。 */
export const HEALTH_MAINTENANCE_FLAG_CATEGORY = "health-maintenance";
/** Flag.code に載せる規則のコードの体系。 */
export const ADVISORY_RULE_SYSTEM = "http://fhir-client.local/CodeSystem/advisory-rule";

/** 診療上の注意の検索から、定期検査・検診の Flag を除く。 */
export function excludeHealthMaintenanceFlags(params: URLSearchParams): void {
  params.set("category:not", HEALTH_MAINTENANCE_FLAG_CATEGORY);
}

/** 患者の記録から集めた、規則 1 件ぶんの材料。 */
export interface MaintenanceRecord {
  /** 項目の最終実施日(YYYY-MM-DD)。記録が無ければ null。 */
  lastDate: string | null;
  /** 有効な延期・対象外の Flag。 */
  flag: fhir4.Flag | null;
}

/** 規則のコード → 材料。 */
export type MaintenanceRecords = ReadonlyMap<string, MaintenanceRecord>;

export type MaintenanceState = "never" | "overdue" | "ok" | "deferred" | "exempt";

export const MAINTENANCE_STATE_LABELS: Record<MaintenanceState, string> = {
  never: "記録なし",
  overdue: "期限超過",
  ok: "期限内",
  deferred: "延期中",
  exempt: "対象外",
};

export interface MaintenanceStatus {
  state: MaintenanceState;
  lastDate: string | null;
  /** 最終実施日 + 間隔。記録が無ければ null。 */
  dueDate: string | null;
  /** 延期中のとき、その期限。 */
  deferredUntil: string | null;
  /** 延期・対象外の理由(Flag.code.text)。 */
  reason: string;
}

/**
 * 期限の状態。有効な Flag があれば、終了日の無いものは対象外、終了日が今日以降なら延期中。
 * 終了日を過ぎた延期は無いものとして扱う(記録から状態を出す)。
 */
export function maintenanceStatusOf(
  maintenance: AdvisoryRuleMaintenance,
  record: MaintenanceRecord,
  today: string = todayString(),
): MaintenanceStatus {
  const { lastDate, flag } = record;
  const dueDate = lastDate ? addDays(lastDate, maintenance.interval_days) : null;
  const reason = flag?.code?.text ?? "";
  const base = { lastDate, dueDate, deferredUntil: null, reason };
  if (flag) {
    const until = flag.period?.end?.slice(0, 10) ?? null;
    if (!until) return { ...base, state: "exempt" };
    if (until >= today) return { ...base, state: "deferred", deferredUntil: until };
  }
  if (!lastDate || !dueDate) return { ...base, state: "never" };
  return { ...base, state: dueDate < today ? "overdue" : "ok" };
}

/** 警告を出す状態(記録なし・期限超過)。 */
export function maintenanceIsDue(status: MaintenanceStatus): boolean {
  return status.state === "never" || status.state === "overdue";
}

/** 警告の補足と区画の一覧に添える文。 */
export function maintenanceStatusText(maintenance: AdvisoryRuleMaintenance, status: MaintenanceStatus): string {
  const item = maintenance.name ?? maintenance.code;
  if (!status.lastDate) return `${item} の記録がありません`;
  return `${item} の最終実施 ${status.lastDate}(期限 ${status.dueDate})`;
}

/** Flag が指す規則のコード。定期検査・検診の Flag でなければ空。 */
export function maintenanceFlagRuleCode(flag: fhir4.Flag): string {
  return flag.code?.coding?.find((coding) => coding.system === ADVISORY_RULE_SYSTEM)?.code ?? "";
}

export interface MaintenanceFlagInput {
  /** 延期の期限。対象外は null。 */
  until: string | null;
  reason: string;
}

/** 延期(期限つき)・対象外(期限なし)の Flag。理由は code.text。 */
export function buildMaintenanceFlag(
  rule: { code: string; name: string },
  patientId: string,
  authorId: string | null,
  input: MaintenanceFlagInput,
): fhir4.Flag {
  const flag: fhir4.Flag = {
    resourceType: "Flag",
    status: "active",
    category: [
      {
        coding: [
          { system: FLAG_CATEGORY_SYSTEM, code: HEALTH_MAINTENANCE_FLAG_CATEGORY, display: "定期検査・検診" },
        ],
      },
    ],
    code: {
      coding: [{ system: ADVISORY_RULE_SYSTEM, code: rule.code, display: rule.name }],
    },
    subject: { reference: `Patient/${patientId}` },
    period: { start: todayString() },
  };
  if (input.reason.trim()) flag.code!.text = input.reason.trim();
  if (input.until) flag.period!.end = input.until;
  if (authorId) flag.author = { reference: `Practitioner/${authorId}` };
  return flag;
}
