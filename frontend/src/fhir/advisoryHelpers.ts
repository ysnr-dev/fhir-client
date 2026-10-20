// 警告(判断支援)の共通の器(docs/advisory-design.md)。
//
// フォームの中で出す警告は、薬剤・放射線・レジメン・外部の判断支援(CDS Hooks)のどれも
// この `Advisory` に寄せる。各ドメインのヘルパーはそれぞれ判定し、結果をここで定める
// 形に写す(アダプタ)だけで、画面は `AdvisoryNotice` と登録前の `AdvisoryConfirmModal` が
// 種別を知らずに描く。種別を足すときは `ADVISORY_KINDS` に 1 行足し、`ADVISORY_KIND_DEFS` を埋める。

/** 重さ。info = 表示のみ、warning = 確認を要する(登録時に理由が必須)、block = 止める。 */
export const ADVISORY_SEVERITIES = ["info", "warning", "block"] as const;
export type AdvisorySeverity = (typeof ADVISORY_SEVERITIES)[number];

export const ADVISORY_SEVERITY_RANK: Record<AdvisorySeverity, number> = { info: 0, warning: 1, block: 2 };

export const ADVISORY_SEVERITY_LABELS: Record<AdvisorySeverity, string> = {
  info: "表示のみ",
  warning: "確認",
  block: "止める",
};

/** 施設設定による重さの調整。default = 実装の既定、info = 表示のみに下げる、off = 出さない。 */
export type AdvisorySeverityOverride = "default" | "info" | "off";
export type AdvisorySeveritySettings = Record<string, AdvisorySeverityOverride>;

export const ADVISORY_SEVERITY_OVERRIDE_LABELS: Record<AdvisorySeverityOverride, string> = {
  default: "既定",
  info: "表示のみ",
  off: "出さない",
};

export const ADVISORY_KINDS = [
  "allergy",
  "duplicate",
  "interaction",
  "dose",
  "antimicrobial",
  "contrast-flag",
  "contrast-allergy",
  "egfr",
  "biguanide",
  "implant",
  "reirradiation",
  "pregnancy",
  "infection",
  "meal-allergy",
  "regimen-lab",
  "regimen-weight",
  "regimen-conflict",
  "regimen-date",
  "regimen-availability",
  "cds-critical",
  "cds-warning",
  "cds-info",
] as const;
export type AdvisoryKind = (typeof ADVISORY_KINDS)[number];

export const ADVISORY_GROUPS = ["薬剤", "放射線", "患者状態", "食事", "レジメン", "外部"] as const;
export type AdvisoryGroup = (typeof ADVISORY_GROUPS)[number];

export interface AdvisoryKindDef {
  label: string;
  group: AdvisoryGroup;
  /** 既定の重さ。アダプタはこれより低く出せる(`severityOf`)が、高くは出せない。 */
  defaultSeverity: AdvisorySeverity;
}

export const ADVISORY_KIND_DEFS: Record<AdvisoryKind, AdvisoryKindDef> = {
  allergy: { label: "薬剤アレルギー", group: "薬剤", defaultSeverity: "warning" },
  duplicate: { label: "重複投与", group: "薬剤", defaultSeverity: "info" },
  interaction: { label: "相互作用", group: "薬剤", defaultSeverity: "warning" },
  dose: { label: "用量・患者条件", group: "薬剤", defaultSeverity: "warning" },
  antimicrobial: { label: "抗菌薬", group: "薬剤", defaultSeverity: "warning" },
  "contrast-flag": { label: "造影の注意区分", group: "放射線", defaultSeverity: "warning" },
  "contrast-allergy": { label: "造影剤アレルギー", group: "放射線", defaultSeverity: "warning" },
  egfr: { label: "腎機能", group: "放射線", defaultSeverity: "warning" },
  biguanide: { label: "ビグアナイド内服", group: "放射線", defaultSeverity: "info" },
  implant: { label: "体内金属", group: "放射線", defaultSeverity: "warning" },
  reirradiation: { label: "同一部位の照射歴", group: "放射線", defaultSeverity: "info" },
  pregnancy: { label: "妊娠・授乳", group: "患者状態", defaultSeverity: "info" },
  infection: { label: "感染症", group: "患者状態", defaultSeverity: "info" },
  "meal-allergy": { label: "食物アレルギーの反映", group: "食事", defaultSeverity: "info" },
  "regimen-lab": { label: "適応基準", group: "レジメン", defaultSeverity: "warning" },
  "regimen-weight": { label: "体重の変化", group: "レジメン", defaultSeverity: "warning" },
  "regimen-conflict": { label: "レジメンの重なり", group: "レジメン", defaultSeverity: "warning" },
  "regimen-date": { label: "開始日", group: "レジメン", defaultSeverity: "info" },
  "regimen-availability": { label: "候補外のレジメン", group: "レジメン", defaultSeverity: "info" },
  "cds-critical": { label: "判断支援(重要)", group: "外部", defaultSeverity: "warning" },
  "cds-warning": { label: "判断支援(注意)", group: "外部", defaultSeverity: "info" },
  "cds-info": { label: "判断支援(情報)", group: "外部", defaultSeverity: "info" },
};

export function advisoryKindLabel(kind: AdvisoryKind): string {
  return ADVISORY_KIND_DEFS[kind].label;
}

export interface Advisory {
  /** フォームのセッション内の同一性。添字を入れず、種別と対象(薬剤コードなど)と文言から作る。 */
  key: string;
  kind: AdvisoryKind;
  severity: AdvisorySeverity;
  message: string;
  /** 補足(アレルギーの症状など)。title 属性に出す。 */
  detail?: string;
  /** 出どころ(外部の判断支援)。 */
  source?: { label: string; url?: string };
  /** 薬剤行に出す警告の位置(RP と行)。無いものはフォームの先頭にまとめて出す。 */
  scope?: { rp: number; line: number };
}

/** 無視理由のコード体系(マスタ `advisory_override_reasons`)。 */
export const ADVISORY_OVERRIDE_REASON_SYSTEM = "http://fhir-client.local/CodeSystem/advisory-override-reason";

export interface AdvisoryOverride {
  advisory: Advisory;
  reasonCode: string;
  reasonName: string;
  /** 理由の体系。省略するとマスタ(`ADVISORY_OVERRIDE_REASON_SYSTEM`)。 */
  reasonSystem?: string;
  /** 自由記述の補足。 */
  text: string;
}

/** 種別と対象を `|` でつないだ key。 */
export function advisoryKey(kind: AdvisoryKind, ...parts: (string | number | null | undefined)[]): string {
  return [kind, ...parts.map((part) => (part == null ? "" : String(part)))].join("|");
}

/** 既存の判定の「強く出す(high)」を重さに写す。high なら種別の既定、そうでなければ表示のみ。 */
export function severityOf(kind: AdvisoryKind, high: boolean): AdvisorySeverity {
  return high ? ADVISORY_KIND_DEFS[kind].defaultSeverity : "info";
}

/**
 * 施設設定(種別ごとの調整)を当てる。下げる・消すだけで、上げることはしない。
 * 止める(block)種別は変えられない。
 */
export function applySeverityOverrides(
  advisories: Advisory[],
  settings: AdvisorySeveritySettings | undefined,
): Advisory[] {
  if (!settings) return advisories;
  return advisories.flatMap((advisory) => {
    const override = settings[advisory.kind] ?? "default";
    if (override === "default" || ADVISORY_KIND_DEFS[advisory.kind].defaultSeverity === "block") return [advisory];
    if (override === "off") return [];
    return [advisory.severity === "info" ? advisory : { ...advisory, severity: "info" as const }];
  });
}

/** 重いものから順に。同じ重さの中は元の順。 */
export function sortBySeverity(advisories: Advisory[]): Advisory[] {
  return [...advisories].sort((a, b) => ADVISORY_SEVERITY_RANK[b.severity] - ADVISORY_SEVERITY_RANK[a.severity]);
}

export function advisoriesOfScope(advisories: Advisory[], rp: number, line: number): Advisory[] {
  return advisories.filter((advisory) => advisory.scope?.rp === rp && advisory.scope.line === line);
}

export function unscopedAdvisories(advisories: Advisory[]): Advisory[] {
  return advisories.filter((advisory) => !advisory.scope);
}

/** 来歴(Provenance.reason.text)と台帳に残す文。種別と文言、補足があればそれも。 */
export function overrideReasonText(override: AdvisoryOverride): string {
  const base = `${advisoryKindLabel(override.advisory.kind)}: ${override.advisory.message}`;
  return override.text ? `${base}（${override.text}）` : base;
}
