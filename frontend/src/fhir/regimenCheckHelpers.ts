import type { RegimenLabCriterion } from "../api/masterClient";
import { diffDays } from "../lib/dates";

/**
 * 投与前チェック(レジメンの適応基準と直近の検査結果の突き合わせ)。
 *
 * レジメンマスタは適応基準を「検査項目(JLAC11 の分析物 5 桁)+ 下限 / 上限」で持つ
 * (`docs/chemo-regimen-design.md` §5)。ここではそれを患者の直近の検査結果に当てて、
 * 適用フォーム・次クール登録フォームの上に出す表を組む。
 *
 * ［決定］基準外でも**登録は止めない**。減量して続ける、当日の再検を待つ、といった
 * 判断は医師のもので、システムが塞ぐものではない。読める形にすることだけを担う。
 */

const JLAC11_SYSTEM = "http://fhir-client.local/CodeSystem/jlac11";
const ANALYTE_LENGTH = 5;

/** 開始日から見て何日前までの結果を「直近」とみなすか。これより古ければ印を出す。 */
export const LAB_RESULT_STALE_DAYS = 7;

function analyteOf(observation: fhir4.Observation): string {
  const jlac = observation.code?.coding?.find((c) => c.system === JLAC11_SYSTEM)?.code ?? "";
  return jlac.length >= ANALYTE_LENGTH ? jlac.slice(0, ANALYTE_LENGTH) : "";
}

/**
 * 単位を「倍率 × 基本単位」に分ける。血算は「X10*3/μL」「10*9/L」のように倍率つきで
 * 報告されるので、そのままでは「/μL」で書かれた基準と比べられない(血小板 15.0 と
 * 100000 を直接比べてしまう)。倍率の表記は `10*n` と `10^n` だけを解釈する
 * (「1000/μL」のような書き方を取り違えないため)。
 */
interface ParsedUnit {
  factor: number;
  base: string;
}

export function parseUnit(unit: string): ParsedUnit {
  // 全角を半角にし、μ の異体字を u に寄せ、空白を落とす。単位は大文字小文字が
  // 意味を持つ場面があるが、比較はゆれの方が多いので小文字で行う。
  const normalized = unit
    .normalize("NFKC")
    .replace(/[μµ]/g, "u")
    .replace(/\s/g, "")
    .toLowerCase();
  const matched = normalized.match(/^x?10[*^](-?\d+)(.*)$/);
  if (!matched) return { factor: 1, base: normalized };
  return { factor: 10 ** Number(matched[1]), base: matched[2] };
}

/** 結果の値を基準の単位に換算する。基本単位が違えば換算しない(null)。 */
export function convertToUnit(value: number, from: string, to: string): number | null {
  if (!to || !from) return value;
  const a = parseUnit(from);
  const b = parseUnit(to);
  if (a.base !== b.base) return null;
  return (value * a.factor) / b.factor;
}

/**
 * 分析物コードを持たない基準行(CCr・eGFR など計算値)の名寄せ。
 * 検査項目マスタに無い項目は名称だけで登録できる(§5)ので、名称から拾う。
 */
export type DerivedKey = "ccr" | "egfr";

const DERIVED_PATTERNS: { key: DerivedKey; pattern: RegExp }[] = [
  { key: "ccr", pattern: /ccr|クレアチニンクリアランス|クレアチニン・クリアランス/i },
  { key: "egfr", pattern: /egfr|推算糸球体|糸球体濾過|糸球体ろ過/i },
];

export function derivedKeyOf(itemName: string): DerivedKey | null {
  const name = itemName.normalize("NFKC");
  return DERIVED_PATTERNS.find((d) => d.pattern.test(name))?.key ?? null;
}

/** 計算値の既定の単位。基準の単位が空でも表示できるようにする。 */
const DERIVED_UNITS: Record<DerivedKey, string> = {
  ccr: "mL/分",
  egfr: "mL/分/1.73m²",
};

export type LabCheckStatus = "ok" | "out" | "unknown";

export interface LabCriterionCheck {
  criterion: RegimenLabCriterion;
  /** 基準の表示(「≦ 1.5」「≧ 1500」「1000〜3000」)。 */
  range: string;
  /** 直近の値。取れなければ null。 */
  value: number | null;
  unit: string;
  /** 採取日(計算値は元にしたクレアチニンの採取日)。 */
  date: string;
  /** 検査結果ではなく計算値(CCr・eGFR)か。 */
  derived: boolean;
  status: LabCheckStatus;
  /** 判定できなかった理由や注記。空なら注記なし。 */
  note: string;
  /** 開始日から見て古い結果か。 */
  stale: boolean;
}

export interface LabCheckSummary {
  /** 基準を外れている件数。 */
  out: number;
  /** 値が取れない件数(未検・計算不能)。 */
  missing: number;
  /** 古い結果の件数。 */
  stale: number;
}

function limitOf(value: string | null): number | null {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function criterionRangeLabel(criterion: RegimenLabCriterion): string {
  const lower = limitOf(criterion.lower_limit);
  const upper = limitOf(criterion.upper_limit);
  const unit = criterion.unit ?? "";
  const suffix = unit ? ` ${unit}` : "";
  if (lower !== null && upper !== null) return `${fmt(lower)}〜${fmt(upper)}${suffix}`;
  if (lower !== null) return `≧ ${fmt(lower)}${suffix}`;
  if (upper !== null) return `≦ ${fmt(upper)}${suffix}`;
  return "—";
}

/** 直近の結果(同じ分析物が複数あれば採取日の新しいもの)。 */
function latestOf(
  observations: fhir4.Observation[],
  analyte: string,
): { value: number; unit: string; date: string } | null {
  const sorted = [...observations].sort((a, b) =>
    (b.effectiveDateTime ?? "").localeCompare(a.effectiveDateTime ?? ""),
  );
  for (const observation of sorted) {
    if (analyteOf(observation) !== analyte) continue;
    const quantity = observation.valueQuantity;
    if (quantity?.value === undefined) continue;
    return {
      value: quantity.value,
      unit: quantity.unit ?? "",
      date: observation.effectiveDateTime?.slice(0, 10) ?? "",
    };
  }
  return null;
}

export interface DerivedValues {
  ccr: number | null;
  egfr: number | null;
  /** 計算の元にしたクレアチニンの採取日。 */
  date: string;
  /** 算出できなかった理由(CCr / eGFR で共通に使える文言)。 */
  unavailable: string;
}

/**
 * 適応基準 1 行ぶんの判定。
 *
 * 単位が食い違うとき(基準「/μL」に対し結果「X10*3/μL」など)は換算する。基本単位まで
 * 違うときは**判定しない** — 桁を取り違えた判定は基準外を見落とすより危ない。
 */
function checkOne(
  criterion: RegimenLabCriterion,
  observations: fhir4.Observation[],
  derived: DerivedValues,
  startDate: string,
): LabCriterionCheck {
  const range = criterionRangeLabel(criterion);
  const base: LabCriterionCheck = {
    criterion,
    range,
    value: null,
    unit: criterion.unit ?? "",
    date: "",
    derived: false,
    status: "unknown",
    note: "",
    stale: false,
  };

  const derivedKey = criterion.analyte_code ? null : derivedKeyOf(criterion.item_name);
  let value: number | null = null;
  let unit = criterion.unit ?? "";
  let date = "";

  if (derivedKey) {
    value = derived[derivedKey];
    unit = criterion.unit || DERIVED_UNITS[derivedKey];
    date = derived.date;
    if (value === null) {
      return { ...base, derived: true, unit, note: derived.unavailable || "算出できません" };
    }
  } else if (criterion.analyte_code) {
    const found = latestOf(observations, criterion.analyte_code);
    if (!found) return { ...base, note: "未検" };
    date = found.date;
    unit = found.unit || criterion.unit || "";
    // 基準の単位に換算してから比べる。換算できなければ結果の単位のまま表示する。
    const converted = criterion.unit ? convertToUnit(found.value, found.unit, criterion.unit) : found.value;
    if (converted === null) {
      return {
        ...base,
        value: found.value,
        unit,
        date,
        note: `単位が異なるため判定していません(基準 ${criterion.unit})`,
        stale: isStale(date, startDate),
      };
    }
    value = converted;
    unit = criterion.unit || found.unit || "";
  } else {
    return { ...base, note: "検査項目が特定できません" };
  }

  const lower = limitOf(criterion.lower_limit);
  const upper = limitOf(criterion.upper_limit);
  const stale = isStale(date, startDate);
  if (lower === null && upper === null) {
    return { ...base, value, unit, date, derived: Boolean(derivedKey), note: "基準の設定なし", stale };
  }

  const out = (lower !== null && value < lower) || (upper !== null && value > upper);
  return {
    ...base,
    value,
    unit,
    date,
    derived: Boolean(derivedKey),
    status: out ? "out" : "ok",
    stale,
  };
}

function isStale(date: string, startDate: string): boolean {
  if (!date || !startDate) return false;
  return diffDays(date, startDate) > LAB_RESULT_STALE_DAYS;
}

export function checkLabCriteria(
  criteria: RegimenLabCriterion[],
  observations: fhir4.Observation[],
  derived: DerivedValues,
  startDate: string,
): LabCriterionCheck[] {
  return criteria.map((criterion) => checkOne(criterion, observations, derived, startDate));
}

export function summarizeLabChecks(checks: LabCriterionCheck[]): LabCheckSummary {
  return {
    out: checks.filter((c) => c.status === "out").length,
    missing: checks.filter((c) => c.value === null).length,
    stale: checks.filter((c) => c.stale).length,
  };
}

/**
 * 体格の変化(次クール登録で前回と比べる)。体重が大きく動いていれば投与量を
 * 出し直す必要があるので、注意を出して医師に確かめさせる。
 */
export const WEIGHT_CHANGE_WARN_RATIO = 0.1;

export interface BodyChange {
  /** 前回からの体重の変化(kg)。 */
  deltaKg: number;
  /** 変化の割合(0.1 = 10%)。 */
  ratio: number;
  /** 注意を出す水準を超えたか。 */
  warn: boolean;
}

export function compareWeight(previous: number | null, current: number | null): BodyChange | null {
  if (!previous || !current || previous <= 0) return null;
  const deltaKg = Math.round((current - previous) * 10) / 10;
  const ratio = Math.abs(current - previous) / previous;
  return { deltaKg, ratio, warn: ratio >= WEIGHT_CHANGE_WARN_RATIO };
}
