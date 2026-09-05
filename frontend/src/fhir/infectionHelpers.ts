import { today } from "../lib/dates";

/**
 * 感染症(HBs 抗原・HCV 抗体・HIV など)。
 *
 * 電子カルテ情報共有サービス(eCS)の共有 6 情報のひとつ。標準では検査結果として
 * 表すので、置き場所は `Observation`(病名 `Condition` ではない)。
 *
 * 情報は 2 つの経路から来る:
 *  - 検体検査の結果(`category=laboratory`)。JLAC11 の分析物コード(先頭 5 桁)で
 *    「この結果は HBs 抗原」と判定し、結果が入れば自動で拾う。
 *  - 手入力(`category=exam`)。検査していないが他院情報・本人申告で分かっている分。
 *
 * 両方あるときは**検査結果を優先**する(検査で出た値が正)。同じ経路で複数あれば
 * 確認日の新しいものを採る。
 */

const LOINC = "http://loinc.org";
const OBSERVATION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";

/** 手入力分の区分。検体検査の結果(laboratory)と混ざらないようにする。 */
export const MANUAL_CATEGORY = "exam";

/**
 * 感染症の種類と、検査結果を引き当てる JLAC11 の分析物コード(先頭 5 桁)。
 *
 * 分析物コードは配布マスタが決める全国共通のコードで、施設ごとに変わらない。
 * このため施設マスタにはせず、ここに定数として持つ(種類の一覧自体もここで
 * 決めており、種類を増やすにはどのみちコードを直す必要があるため)。
 *
 * 材料(血清 / 血漿)と測定法の違いは分析物コードでは分かれないので、1 つの
 * コードでその種類の検査を全部拾える。逆に大項目(例:「HBs」)まで粗くすると
 * HBs 抗原と HBs 抗体が同じになってしまう。抗原陽性は感染、抗体陽性はワクチンか
 * 既感染で意味が逆なので、分析物コードがちょうどよい単位になる。
 *
 * `analytes` が空の種類は検査結果から拾わない(手入力のみ)。
 */
export const INFECTION_TYPES = [
  // V2010 = HBs 抗原、V2011 = HBs 抗体。感染を表すのは抗原の方なので抗原だけ拾う。
  { code: "hbs", display: "HBs 抗原", loinc: "5195-3", analytes: ["V2010"] },
  {
    code: "hcv",
    display: "HCV 抗体",
    loinc: "16128-1",
    analytes: ["V2026", "V2168", "V2171", "V2184"],
  },
  {
    code: "hiv",
    display: "HIV",
    loinc: "31201-7",
    analytes: ["V2252", "V2256", "V2259", "V2263"],
  },
  // V1055 / V1061 は梅毒の 2 系統(脂質抗原法と TP 抗原法)。
  { code: "syphilis", display: "梅毒", loinc: "20507-0", analytes: ["V1055", "V1061"] },
  // HTLV-1・MRSA・結核は配布マスタの項目名から分析物を特定できなかったので、
  // 検査結果からは拾わず手入力のみ(分かった時点で分析物コードを足す)。
  { code: "htlv1", display: "HTLV-1", loinc: "31418-7", analytes: [] },
  { code: "mrsa", display: "MRSA", loinc: "43409-2", analytes: [] },
  { code: "tb", display: "結核", loinc: "11476-9", analytes: [] },
] as const;

/** JLAC11 の分析物コードの桁数(先頭 5 桁)。 */
const ANALYTE_LENGTH = 5;

/** 分析物コード → 感染症の種類。検査結果の引き当てに使う。 */
const ANALYTE_TO_TYPE = new Map<string, string>(
  INFECTION_TYPES.flatMap((type) => type.analytes.map((analyte) => [analyte, type.code] as const)),
);

/** 検査結果から拾える種類があるか(1 つでもあれば検査結果を引く)。 */
export const HAS_LAB_MAPPED_TYPES = ANALYTE_TO_TYPE.size > 0;

export type InfectionType = (typeof INFECTION_TYPES)[number]["code"];

export function infectionTypeLabel(code: string | undefined): string {
  return INFECTION_TYPES.find((t) => t.code === code)?.display ?? "";
}

export function infectionLoinc(code: string): string {
  return INFECTION_TYPES.find((t) => t.code === code)?.loinc ?? "";
}

/** 手入力分の種類を保持するローカル拡張。LOINC だけでは種類を引き直せないため。 */
export const INFECTION_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/infection-type";

/** 結果。「未検」は Observation を作らないので、選べるのは陽性・陰性だけ。 */
export const INFECTION_RESULT_OPTIONS = [
  { code: "positive", display: "陽性" },
  { code: "negative", display: "陰性" },
] as const;

export type InfectionResult = (typeof INFECTION_RESULT_OPTIONS)[number]["code"];

/**
 * 検査結果から陽性・陰性を読み取れなかったときの表示。数値で返る検査
 * (抗体価など)や、施設独自の表記で「陽性」と書かれていない結果が該当する。
 * 陰性と決めつけず、結果を見に行かせる。
 */
const UNDETERMINED = "undetermined";

export function infectionResultLabel(code: string | undefined): string {
  if (code === UNDETERMINED) return "判定不明";
  return INFECTION_RESULT_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

const RESULT_SYSTEM = "http://fhir-client.local/CodeSystem/infection-result";

/** 手入力分の情報源。血液型と同じ考え方で、どこから来た情報かを必ず持つ。 */
export const INFECTION_SOURCE_OPTIONS = [
  { code: "reported", display: "本人・家族の申告" },
  { code: "referred", display: "他院からの情報" },
] as const;

export type InfectionSource = (typeof INFECTION_SOURCE_OPTIONS)[number]["code"];

export function infectionSourceLabel(code: string | undefined): string {
  return INFECTION_SOURCE_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

const SOURCE_SYSTEM = "http://fhir-client.local/CodeSystem/infection-source";

export interface InfectionFormValues {
  type: InfectionType | "";
  result: InfectionResult | "";
  source: InfectionSource;
  /** 確認日(申告を受けた日・他院情報の日付)。 */
  effectiveDate: string;
  note: string;
}

export function emptyInfectionForm(): InfectionFormValues {
  return { type: "", result: "", source: "reported", effectiveDate: today(), note: "" };
}

/** 手入力の感染症 Observation を組み立てる。 */
export function buildInfectionObservation(
  values: InfectionFormValues,
  patientId: string,
  observationId?: string,
): fhir4.Observation {
  const loinc = infectionLoinc(values.type);

  const observation: fhir4.Observation = {
    resourceType: "Observation",
    status: "final",
    category: [{ coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: MANUAL_CATEGORY }] }],
    code: {
      coding: [
        // 種類を引き直すためのローカルコードを先に置く。LOINC は標準の相手に
        // 読ませるために添える(どちらか片方では足りない)。
        {
          system: INFECTION_TYPE_SYSTEM,
          code: values.type,
          display: infectionTypeLabel(values.type),
        },
        ...(loinc ? [{ system: LOINC, code: loinc, display: infectionTypeLabel(values.type) }] : []),
      ],
    },
    subject: { reference: `Patient/${patientId}` },
    valueCodeableConcept: {
      coding: [
        {
          system: RESULT_SYSTEM,
          code: values.result,
          display: infectionResultLabel(values.result),
        },
      ],
    },
    method: {
      coding: [
        { system: SOURCE_SYSTEM, code: values.source, display: infectionSourceLabel(values.source) },
      ],
    },
    effectiveDateTime: values.effectiveDate,
  };

  if (observationId) observation.id = observationId;
  if (values.note.trim()) observation.note = [{ text: values.note.trim() }];

  return observation;
}

/** 手入力分の種類。ローカルコードから引く。 */
function manualType(observation: fhir4.Observation): string {
  return observation.code?.coding?.find((c) => c.system === INFECTION_TYPE_SYSTEM)?.code ?? "";
}

function isManual(observation: fhir4.Observation): boolean {
  return Boolean(
    observation.category?.some((c) => c.coding?.some((coding) => coding.code === MANUAL_CATEGORY)),
  );
}

export interface InfectionRow {
  type: string;
  typeLabel: string;
  /**
   * positive / negative / undetermined。検査結果から拾ったときは値の文字列を
   * 先に見て決め、読めなければ異常フラグで補う(labResultOutcome)。
   */
  result: string;
  resultLabel: string;
  effectiveDate: string;
  /** 検査結果から拾ったか。手入力の場合は情報源を出す。 */
  fromLab: boolean;
  sourceLabel: string;
  note: string;
  /** 手入力分の Observation id。編集・削除に使う(検査結果由来は空)。 */
  observationId: string;
}

const JLAC11_SYSTEM = "http://fhir-client.local/CodeSystem/jlac11";

const POSITIVE_PATTERN = /陽性|\(\+\)|positive|reactive/i;
const NEGATIVE_PATTERN = /陰性|\(-\)|negative|non-?reactive/i;

/**
 * 検査結果の陽性・陰性。判定できなければ undetermined を返す。
 *
 * **値を先に読む**。検査結果の登録画面は異常フラグ(interpretation)を選ばなければ
 * "N"(正常)で保存するので、判定を先に見ると「陽性」と入れた結果まで陰性になる。
 * 異常フラグは値から読めないときの補助に留める。
 *
 * 数値で返る検査(抗体価など)は基準値の持ち方が項目ごとに違い、ここでは
 * 陽性・陰性を決められないので undetermined にする(陰性と決めつけない)。
 */
function labResultOutcome(observation: fhir4.Observation): string {
  const text = [
    observation.valueString,
    observation.valueCodeableConcept?.text,
    ...(observation.valueCodeableConcept?.coding ?? []).map((c) => c.display),
  ]
    .filter(Boolean)
    .join(" ");

  if (POSITIVE_PATTERN.test(text)) return "positive";
  if (NEGATIVE_PATTERN.test(text)) return "negative";

  // 値から読めないときだけ異常フラグを見る。異常(A/H/L など)なら陽性寄りとして
  // 拾い、正常("N")や未設定は判定できないものとして扱う。
  const interpretation = observation.interpretation?.[0]?.coding?.[0]?.code ?? "";
  if (interpretation && interpretation !== "N") return "positive";

  return UNDETERMINED;
}

/**
 * 検査結果の JLAC11 コード(17 桁)から感染症の種類を引く。材料・測定法は
 * 下位の桁にあるので、先頭 5 桁(分析物)だけを見れば種類が決まる。
 */
function labType(observation: fhir4.Observation): string {
  const jlac = observation.code?.coding?.find((c) => c.system === JLAC11_SYSTEM)?.code ?? "";
  if (jlac.length < ANALYTE_LENGTH) return "";
  return ANALYTE_TO_TYPE.get(jlac.slice(0, ANALYTE_LENGTH)) ?? "";
}

/**
 * 感染症の一覧。種類ごとに 1 行で、検査結果を手入力より優先し、
 * 同じ経路なら確認日の新しいものを採る。
 */
export function summarizeInfections(
  manualObservations: fhir4.Observation[],
  labObservations: fhir4.Observation[],
): InfectionRow[] {
  const rows = new Map<string, InfectionRow>();

  // 先に手入力を入れ、後から検査結果で上書きする(検査結果が正のため)。
  const manual = [...manualObservations]
    .filter(isManual)
    .sort((a, b) => (a.effectiveDateTime ?? "").localeCompare(b.effectiveDateTime ?? ""));

  for (const observation of manual) {
    const type = manualType(observation);
    if (!type) continue;

    const result = observation.valueCodeableConcept?.coding?.[0]?.code ?? "";
    const source = observation.method?.coding?.[0]?.code ?? "";
    rows.set(type, {
      type,
      typeLabel: infectionTypeLabel(type),
      result,
      resultLabel: infectionResultLabel(result),
      effectiveDate: observation.effectiveDateTime?.slice(0, 10) ?? "",
      fromLab: false,
      sourceLabel: infectionSourceLabel(source),
      note: observation.note?.[0]?.text ?? "",
      observationId: observation.id ?? "",
    });
  }

  const labResults = [...labObservations].sort((a, b) =>
    (a.effectiveDateTime ?? "").localeCompare(b.effectiveDateTime ?? ""),
  );

  for (const observation of labResults) {
    const type = labType(observation);
    if (!type) continue;

    const outcome = labResultOutcome(observation);
    rows.set(type, {
      type,
      typeLabel: infectionTypeLabel(type),
      result: outcome,
      resultLabel: infectionResultLabel(outcome),
      effectiveDate: observation.effectiveDateTime?.slice(0, 10) ?? "",
      fromLab: true,
      sourceLabel: "検査結果",
      note: "",
      observationId: "",
    });
  }

  // 種類の並びは INFECTION_TYPES の順(施設ごとの登録順に左右されない)。
  return INFECTION_TYPES.map((t) => rows.get(t.code)).filter((row): row is InfectionRow =>
    Boolean(row),
  );
}

export function parseInfectionForm(observation: fhir4.Observation): InfectionFormValues {
  const type = manualType(observation);
  const result = observation.valueCodeableConcept?.coding?.[0]?.code ?? "";
  const source = observation.method?.coding?.[0]?.code ?? "";

  return {
    type: (type as InfectionType) || "",
    result: (result as InfectionResult) || "",
    source: INFECTION_SOURCE_OPTIONS.some((o) => o.code === source)
      ? (source as InfectionSource)
      : "reported",
    effectiveDate: observation.effectiveDateTime?.slice(0, 10) ?? today(),
    note: observation.note?.[0]?.text ?? "",
  };
}

/** 陽性の感染症があるか。患者帯・オーダー画面の注意に使う。 */
export function hasPositiveInfection(rows: InfectionRow[]): boolean {
  return rows.some((row) => row.result === "positive");
}
