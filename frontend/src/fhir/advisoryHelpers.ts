// 警告(判断支援)の共通の器(docs/advisory-design.md)。
//
// フォームの中で出す警告は、薬剤・放射線・レジメン・外部の判断支援(CDS Hooks)のどれも
// この `Advisory` に寄せる。各ドメインのヘルパーはそれぞれ判定し、結果をここで定める
// 形に写す(アダプタ)だけで、画面は `AdvisoryNotice` と登録前の `AdvisoryConfirmModal` が
// 種別を知らずに描く。種別を足すときは `ADVISORY_KINDS` に 1 行足し、`ADVISORY_KIND_DEFS` を埋める。

/** 重さ。info = 表示のみ、warning = 確認を要する(登録時に理由が必須)、block = 止める。 */
/**
 * 警告を出す場面。台帳(advisory_events)の context で、施設の規則の「出す場所」の選択肢にもなる。
 * patient-view はカルテを開いたとき(患者帯のピクトグラム)で、確認は求めない。
 */
export const ADVISORY_CONTEXTS = [
  "patient-view",
  "prescription",
  "injection",
  "rad-order",
  "radiotherapy",
  "physio",
  "endoscopy",
  "meal-order",
  "transfusion-order",
  "transfusion-dispense",
  "transfusion-perform",
  "autologous-collection",
  "medical-management",
  "regimen-apply",
  "regimen-cycle",
] as const;
export type AdvisoryContext = (typeof ADVISORY_CONTEXTS)[number];

export const ADVISORY_CONTEXT_LABELS: Record<AdvisoryContext, string> = {
  "patient-view": "カルテを開いたとき",
  prescription: "処方",
  injection: "注射",
  "rad-order": "放射線",
  radiotherapy: "放射線治療",
  physio: "生理検査",
  endoscopy: "内視鏡",
  "meal-order": "食事",
  "transfusion-order": "輸血の依頼",
  "transfusion-dispense": "輸血の出庫",
  "transfusion-perform": "輸血の実施",
  "autologous-collection": "自己血の採血",
  "medical-management": "指導・管理料",
  "regimen-apply": "レジメンの適用",
  "regimen-cycle": "レジメンのクール登録",
};

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
  "days-limit",
  "crush-split",
  "usage-form",
  "disease",
  "adoption",
  "restricted-department",
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
  "regimen-cumulative",
  "regimen-conflict",
  "regimen-date",
  "regimen-availability",
  "management-fee-limit",
  "transfusion-refusal",
  "blood-type-unconfirmed",
  "antibody-screen",
  "blood-type-different",
  "transfusion-reaction-history",
  "dispense-blood-type",
  "dispense-requested-type",
  "dispense-product",
  "dispense-expiry",
  "dispense-irradiation",
  "dispense-crossmatch",
  "antibody-positive",
  "perform-not-dispensed",
  "perform-missing-bag",
  "transplant-blood-type",
  "autologous-mismatch",
  "autologous-expiry",
  "autologous-hb",
  "cds-critical",
  "cds-warning",
  "cds-info",
  "facility-rule",
] as const;
export type AdvisoryKind = (typeof ADVISORY_KINDS)[number];

export const ADVISORY_GROUPS = ["薬剤", "放射線", "患者状態", "食事", "レジメン", "医学管理", "輸血", "外部", "施設"] as const;
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
  "days-limit": { label: "投与日数の上限", group: "薬剤", defaultSeverity: "warning" },
  "crush-split": { label: "粉砕・分割", group: "薬剤", defaultSeverity: "warning" },
  "usage-form": { label: "剤形と用法", group: "薬剤", defaultSeverity: "info" },
  disease: { label: "病名禁忌", group: "薬剤", defaultSeverity: "warning" },
  adoption: { label: "採用区分", group: "薬剤", defaultSeverity: "warning" },
  "restricted-department": { label: "処方できる診療科", group: "薬剤", defaultSeverity: "warning" },
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
  "regimen-cumulative": { label: "累積投与量", group: "レジメン", defaultSeverity: "warning" },
  "regimen-conflict": { label: "レジメンの重なり", group: "レジメン", defaultSeverity: "warning" },
  "regimen-date": { label: "開始日", group: "レジメン", defaultSeverity: "info" },
  "regimen-availability": { label: "候補外のレジメン", group: "レジメン", defaultSeverity: "info" },
  "management-fee-limit": { label: "算定回数の上限", group: "医学管理", defaultSeverity: "info" },
  "transfusion-refusal": { label: "輸血拒否", group: "輸血", defaultSeverity: "warning" },
  "blood-type-unconfirmed": { label: "血液型の未確定", group: "輸血", defaultSeverity: "warning" },
  "antibody-screen": { label: "不規則抗体の検査", group: "輸血", defaultSeverity: "warning" },
  "blood-type-different": { label: "異型適合血", group: "輸血", defaultSeverity: "info" },
  "transfusion-reaction-history": { label: "輸血副作用歴", group: "輸血", defaultSeverity: "info" },
  "dispense-blood-type": { label: "出庫: 患者の型との適合", group: "輸血", defaultSeverity: "warning" },
  "dispense-requested-type": { label: "出庫: 依頼の型との一致", group: "輸血", defaultSeverity: "warning" },
  "dispense-product": { label: "出庫: 依頼の製剤との一致", group: "輸血", defaultSeverity: "warning" },
  "dispense-expiry": { label: "出庫: 有効期限", group: "輸血", defaultSeverity: "warning" },
  "dispense-irradiation": { label: "出庫: 照射", group: "輸血", defaultSeverity: "warning" },
  "dispense-crossmatch": { label: "出庫: 交差適合試験", group: "輸血", defaultSeverity: "warning" },
  "antibody-positive": { label: "不規則抗体陽性", group: "輸血", defaultSeverity: "warning" },
  "perform-not-dispensed": { label: "実施: 出庫記録に無いバッグ", group: "輸血", defaultSeverity: "warning" },
  "perform-missing-bag": { label: "実施: 入力に無い出庫バッグ", group: "輸血", defaultSeverity: "warning" },
  "transplant-blood-type": { label: "移植後の血液型", group: "輸血", defaultSeverity: "info" },
  "autologous-mismatch": { label: "自己血: 本人の血かの確認", group: "輸血", defaultSeverity: "warning" },
  "autologous-expiry": { label: "自己血: 有効期限", group: "輸血", defaultSeverity: "warning" },
  "autologous-hb": { label: "自己血: 採血前の Hb", group: "輸血", defaultSeverity: "warning" },
  "cds-critical": { label: "判断支援(重要)", group: "外部", defaultSeverity: "warning" },
  "cds-warning": { label: "判断支援(注意)", group: "外部", defaultSeverity: "info" },
  "cds-info": { label: "判断支援(情報)", group: "外部", defaultSeverity: "info" },
  // 施設が条件式で定義する規則(fhir/advisoryRuleHelpers.ts)。規則ごとの重さはマスタが決める。
  "facility-rule": { label: "施設の規則", group: "施設", defaultSeverity: "warning" },
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
