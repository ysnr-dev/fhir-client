import { today } from "../lib/dates";
import type { PatientCaution } from "../api/masterClient";

/**
 * 患者の診療上の注意(FHIR Flag)。
 *
 * 「転倒リスク」「体内金属」「DNAR」のように、診療のたびに最初に見返す注意を
 * 患者に紐づけて持つ。何を注意として選べるかは注意区分マスタ
 * (backend の /master/patient_cautions)が決め、Flag.code にそのコードを載せる。
 *
 * JP Core に Flag のプロファイルは無いので、meta.profile は上流サーバーが
 * HL7 の基本定義を付ける(こちらからは載せない)。
 */

// 注意区分マスタのコード体系。マスタの code をそのまま Flag.code.coding.code に入れる。
export const CAUTION_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/patient-caution";
// 区分(安全・臨床・意思・事務)。標準の flag-category は業務分類(診療・食事・薬剤…)で
// 「何に気を付けるか」の軸が違うため、ローカルの体系を使う。
export const FLAG_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/flag-category";

export const FLAG_CATEGORY_OPTIONS = [
  { code: "safety", display: "安全" },
  { code: "clinical", display: "臨床" },
  { code: "advance-directive", display: "意思" },
  { code: "administrative", display: "事務" },
] as const;

export type FlagCategory = (typeof FLAG_CATEGORY_OPTIONS)[number]["code"];

export function flagCategoryLabel(code: string | undefined): string {
  return FLAG_CATEGORY_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

// entered-in-error は画面から書かない(誤登録は削除ではなく「終了」で残す運用)。
export const FLAG_STATUS_OPTIONS = [
  { code: "active", display: "有効" },
  { code: "inactive", display: "終了" },
] as const;

export type FlagStatus = (typeof FLAG_STATUS_OPTIONS)[number]["code"];

export function flagStatusLabel(code: string | undefined): string {
  return FLAG_STATUS_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

export interface FlagFormValues {
  category: FlagCategory;
  /** 注意区分マスタの code。 */
  cautionCode: string;
  /** 内容の自由記載。Flag.code.text に入れる。 */
  text: string;
  periodStart: string;
  periodEnd: string;
  status: FlagStatus;
}

export function emptyFlagForm(): FlagFormValues {
  return {
    category: "safety",
    cautionCode: "",
    text: "",
    periodStart: today(),
    periodEnd: "",
    status: "active",
  };
}

export function buildFlag(
  values: FlagFormValues,
  patientId: string,
  cautions: PatientCaution[],
  authorId: string | null,
  flagId?: string,
): fhir4.Flag {
  const caution = cautions.find((c) => c.code === values.cautionCode);

  const flag: fhir4.Flag = {
    resourceType: "Flag",
    status: values.status,
    category: [
      {
        coding: [
          {
            system: FLAG_CATEGORY_SYSTEM,
            code: values.category,
            display: flagCategoryLabel(values.category),
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: CAUTION_CODE_SYSTEM,
          code: values.cautionCode,
          // マスタの表示名を写す。マスタの名称を後から変えても、登録時点の
          // 表記が残る(コードで引き直せば最新の名称も出せる)。
          display: caution?.name ?? values.cautionCode,
        },
      ],
    },
    subject: { reference: `Patient/${patientId}` },
  };

  if (flagId) flag.id = flagId;
  if (values.text.trim()) flag.code!.text = values.text.trim();
  if (authorId) flag.author = { reference: `Practitioner/${authorId}` };

  // 期間はどちらも任意。終了日が無い注意は「継続中」を意味する。
  const period: fhir4.Period = {};
  if (values.periodStart) period.start = values.periodStart;
  if (values.periodEnd) period.end = values.periodEnd;
  if (Object.keys(period).length) flag.period = period;

  return flag;
}

/** 注意区分マスタのコードを持つ coding(体系が合うものを優先し、無ければ先頭)。 */
export function cautionCoding(flag: fhir4.Flag): fhir4.Coding | undefined {
  return (
    flag.code?.coding?.find((c) => c.system === CAUTION_CODE_SYSTEM) ?? flag.code?.coding?.[0]
  );
}

export function flagCategoryCode(flag: fhir4.Flag): string {
  const coding = flag.category?.[0]?.coding;
  return coding?.find((c) => c.system === FLAG_CATEGORY_SYSTEM)?.code ?? coding?.[0]?.code ?? "";
}

export interface FlagSummary {
  id: string;
  /** 表示名。マスタに残っていればマスタの名称、無ければ登録時の display。 */
  name: string;
  category: string;
  categoryLabel: string;
  cautionCode: string;
  text: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  statusLabel: string;
  /** マスタ行のピクトグラム。マスタに無い / 帯に出さない区分は null。 */
  pictogram: string | null;
}

export function summarizeFlag(
  flag: fhir4.Flag,
  cautionsByCode: Map<string, PatientCaution>,
): FlagSummary {
  const coding = cautionCoding(flag);
  const code = coding?.code ?? "";
  const caution = cautionsByCode.get(code);
  const category = flagCategoryCode(flag);

  return {
    id: flag.id ?? "",
    name: caution?.name ?? coding?.display ?? code,
    category,
    categoryLabel: flagCategoryLabel(category),
    cautionCode: code,
    text: flag.code?.text ?? "",
    periodStart: flag.period?.start?.slice(0, 10) ?? "",
    periodEnd: flag.period?.end?.slice(0, 10) ?? "",
    status: flag.status ?? "",
    statusLabel: flagStatusLabel(flag.status),
    pictogram: caution?.pictogram ?? null,
  };
}

function optionCode<T extends string>(
  options: readonly { code: T }[],
  code: string | undefined,
  fallback: T,
): T {
  return options.some((o) => o.code === code) ? (code as T) : fallback;
}

export function parseFlagForm(flag: fhir4.Flag): FlagFormValues {
  return {
    category: optionCode(FLAG_CATEGORY_OPTIONS, flagCategoryCode(flag), "safety"),
    cautionCode: cautionCoding(flag)?.code ?? "",
    text: flag.code?.text ?? "",
    periodStart: flag.period?.start?.slice(0, 10) ?? "",
    periodEnd: flag.period?.end?.slice(0, 10) ?? "",
    status: optionCode(FLAG_STATUS_OPTIONS, flag.status, "active"),
  };
}

/**
 * 注意を「終了」した姿。状態を inactive にし、終了日が空なら今日を入れる
 * (いつまでの注意だったかが後から読めるようにするため)。
 */
export function endFlag(flag: fhir4.Flag): fhir4.Flag {
  return {
    ...flag,
    status: "inactive",
    period: { ...flag.period, end: flag.period?.end ?? today() },
  };
}
