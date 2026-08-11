import {
  SETTING_SYSTEM,
  SETTING_OPTIONS,
  type LabResultSetting,
  observationIdsFromReport,
} from "./labResultHelpers";
import { SPECIMEN_TYPE_SYSTEM, ORGANISM_SYSTEM } from "./microOrderHelpers";

// 細菌検査結果。検体検査結果(labResultHelpers)と同型の
//
//   DiagnosticReport (category=MB) ─ basedOn → 細菌検査オーダー(ヘッダ ServiceRequest)
//     ├ specimen → Specimen ×1 (JANIS 材料コード)
//     └ result  → Observation 群
//
// を 1 本の transaction Bundle で保存する。Observation は
// ・検体所見: 培養結果 / 塗抹・鏡検所見 / 喀痰品質(M&J・Geckler) / 膿尿評価
// ・分離菌(A〜E 最大5): valueCC=JANIS 病原体コード + component(菌量/菌数/起炎性)
// ・薬剤感受性(菌ごと最大30): code=JANIS 抗菌薬コード、derivedFrom で分離菌を指す
// の 3 種類。項目は JANIS 検査部門フォーマット準拠で、菌量・菌数は JANIS の
// 生コードを保存する(将来の JANIS 提出データ生成への布石)。
//
// 感受性 → 分離菌の紐付けに derivedFrom(分離株から導出した測定)を使うのは、
// hasMember(逆向き)だと感受性行の増減のたびに分離菌 Observation の更新が
// 要るため。新規作成時は urn:uuid を指し、サーバー側で採番後の id に解決される
// (細菌検査オーダーの basedOn 連鎖と同じ仕組み)。
//
// 名称(菌名・薬剤名・略号・測定法名)はすべて coding.display にマスタの写しとして
// 保存するので、編集フォームへの復元は FHIR リソースだけで完結する
// (検体検査の hydrate に相当する引き直しは不要)。

// ---- コードシステム ----

// Observation.code / component.code の種別(この機能専用のローカル URI)。
const RESULT_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/micro-result-item";
// 各選択値のコードシステム。
const CULTURE_RESULT_SYSTEM = "http://fhir-client.local/CodeSystem/micro-culture-result";
const MILLER_JONES_SYSTEM = "http://fhir-client.local/CodeSystem/micro-miller-jones";
const GECKLER_SYSTEM = "http://fhir-client.local/CodeSystem/micro-geckler";
const PYURIA_METHOD_SYSTEM = "http://fhir-client.local/CodeSystem/micro-pyuria-method";
const PYURIA_RESULT_SYSTEM = "http://fhir-client.local/CodeSystem/micro-pyuria-result";
const COLONY_QUANTITY_TYPE_SYSTEM =
  "http://fhir-client.local/CodeSystem/micro-colony-quantity-type";
const COLONY_COUNT_SYSTEM = "http://fhir-client.local/CodeSystem/micro-colony-count";
const CAUSATIVE_SYSTEM = "http://fhir-client.local/CodeSystem/micro-causative";
const GRADE_SYSTEM = "http://fhir-client.local/CodeSystem/micro-susceptibility-grade";
// JANIS 抗菌薬コード(master_micro_antimicrobials)と略号・測定法コード。
export const ANTIMICROBIAL_SYSTEM = "http://fhir-client.local/CodeSystem/janis-antimicrobial";
const ANTIMICROBIAL_ABBREVIATION_SYSTEM =
  "http://fhir-client.local/CodeSystem/micro-antimicrobial-abbreviation";
const SUSCEPTIBILITY_METHOD_SYSTEM =
  "http://fhir-client.local/CodeSystem/janis-susceptibility-method";

// 感受性判定(S/I/R)は v3 ObservationInterpretation に正式なコードがある。
const INTERPRETATION_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation";

const OBSERVATION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";
const REPORT_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0074";
const LOINC_SYSTEM = "http://loinc.org";
const LOINC_MICRO_REPORT_CODE = "18725-2"; // Microbiology studies (set)
const UNITS_OF_MEASURE_SYSTEM = "http://unitsofmeasure.org";

// Specimen は検体検査結果と同じ JP Core 共通プロファイル。DiagnosticReport /
// Observation の JP_*_LabResult は検体検査用プロファイルなので付けない。
const SPECIMEN_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Specimen_Common";

// Observation.code の種別コード。
const CODE_CULTURE = "culture";
const CODE_SMEAR = "smear";
const CODE_MILLER_JONES = "sputum-miller-jones";
const CODE_GECKLER = "sputum-geckler";
const CODE_PYURIA = "pyuria";
const CODE_ISOLATE = "isolate";
// component.code の種別コード。
const CODE_QUANTITY_TYPE = "colony-quantity-type";
const CODE_COLONY_COUNT = "colony-count";
const CODE_CAUSATIVE = "causative";
const CODE_DISK_DIAMETER = "disk-diameter";
const CODE_GRADE = "susceptibility-grade";

// ---- 選択肢 ----

export interface CodeOption {
  code: string;
  display: string;
}

export type MicroReportStatus = "preliminary" | "final";

export const REPORT_STATUS_OPTIONS: { code: MicroReportStatus; display: string }[] = [
  { code: "preliminary", display: "中間報告" },
  { code: "final", display: "最終報告" },
];

export function reportStatusDisplay(status: string | undefined): string {
  return REPORT_STATUS_OPTIONS.find((o) => o.code === status)?.display ?? "";
}

export const CULTURE_OPTIONS: CodeOption[] = [
  { code: "negative", display: "陰性" },
  { code: "positive", display: "陽性" },
];

export const MILLER_JONES_OPTIONS: CodeOption[] = ["P1", "P2", "P3", "M1", "M2"].map((c) => ({
  code: c,
  display: c,
}));

export const GECKLER_OPTIONS: CodeOption[] = ["1", "2", "3", "4", "5", "6"].map((c) => ({
  code: c,
  display: `グループ${c}`,
}));

export const PYURIA_METHOD_OPTIONS: CodeOption[] = [
  { code: "sediment-wbc", display: "沈渣白血球数" },
  { code: "wbc-count", display: "白血球数" },
  { code: "esterase", display: "白血球エステラーゼ活性" },
  { code: "other", display: "その他" },
];

export const PYURIA_RESULT_OPTIONS: CodeOption[] = [
  { code: "none", display: "なし" },
  { code: "intermediate", display: "中間" },
  { code: "present", display: "あり" },
  { code: "unknown", display: "不明" },
];

// 菌量・菌数は JANIS の生コードで保存する。
export const QUANTITY_TYPE_OPTIONS: CodeOption[] = [
  { code: "1", display: "半定量" },
  { code: "2", display: "定量" },
  { code: "9", display: "その他" },
];

export const COLONY_COUNT_OPTIONS: CodeOption[] = [
  { code: "1", display: "10^2/ml以下" },
  { code: "2", display: "10^3/ml" },
  { code: "3", display: "10^4/ml" },
  { code: "4", display: "10^5/ml" },
  { code: "5", display: "10^6/ml" },
  { code: "6", display: "10^7/ml以上" },
  { code: "7", display: "10^3〜10^4/ml" },
  { code: "8", display: "10^5〜10^6/ml" },
];

export const CAUSATIVE_OPTIONS: CodeOption[] = [
  { code: "none", display: "なし" },
  { code: "present", display: "あり" },
  { code: "unknown", display: "不明" },
];

// MIC の仕切法。"=" は FHIR Quantity.comparator に存在しないため空(省略)で表す。
export type MicComparator = "" | "<" | "<=" | ">=" | ">";

export const COMPARATOR_OPTIONS: { code: MicComparator; display: string }[] = [
  { code: "", display: "=" },
  { code: "<=", display: "≦" },
  { code: ">=", display: "≧" },
  { code: "<", display: "<" },
  { code: ">", display: ">" },
];

export type SirCode = "" | "S" | "I" | "R";

export const SIR_OPTIONS: Exclude<SirCode, "">[] = ["S", "I", "R"];

export const GRADE_OPTIONS: CodeOption[] = [
  { code: "-", display: "−" },
  { code: "+", display: "＋" },
  { code: "++", display: "＋＋" },
  { code: "+++", display: "＋＋＋" },
];

export function optionDisplay(options: CodeOption[], code: string): string {
  return options.find((o) => o.code === code)?.display ?? code;
}

// JANIS フォーマットの上限(分離菌 A〜E、菌ごとの感受性 30 薬剤)。
export const MAX_ISOLATES = 5;
export const MAX_SUSCEPTIBILITIES = 30;

/** 分離菌の見出し(A〜E)。 */
export function isolateLabel(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

// ---- フォーム値 ----

/** 薬剤感受性 1 行(1 薬剤)。名称はマスタの写し。 */
export interface MicroSusceptibilityValues {
  /** 保存済み Observation の id。新規行は undefined。 */
  id?: string;
  drugCode: string;
  drugName: string;
  drugAbbreviation: string;
  methodCode: string;
  methodName: string;
  comparator: MicComparator;
  /** MIC 値(µg/mL)。数値文字列。 */
  mic: string;
  /** 阻止円径(mm)。数値文字列。 */
  zone: string;
  sir: SirCode;
  /** 判定(+)。JANIS の -/+/++/+++。 */
  grade: string;
}

/** 分離菌 1 株。名称はマスタの写し。 */
export interface MicroIsolateValues {
  /** 保存済み Observation の id。新規は undefined。 */
  id?: string;
  organismCode: string;
  organismName: string;
  /** 菌量(JANIS 生コード 1:半定量, 2:定量, 9:その他)。空は未入力。 */
  quantityType: string;
  /** 菌数(JANIS 生コード 1〜8)。空は未入力。 */
  colonyCount: string;
  causative: "" | "none" | "present" | "unknown";
  susceptibilities: MicroSusceptibilityValues[];
}

export interface MicroResultFormValues {
  setting: LabResultSetting;
  /** 検体採取日。 */
  specimenDate: string;
  /**
   * 元になった細菌検査オーダー(ヘッダの ServiceRequest)の id。空なら紐付けなし。
   * 検体検査結果と同じく「オーダー 1 件 ↔ 結果レポート 1 件」で持つ。
   */
  orderId: string;
  /** 報告区分。中間のまま保存して、後の編集で最終化できる。 */
  reportStatus: MicroReportStatus;
  /** 材料(JANIS 材料コード)。オーダー選択時に転記するか、マスタから選ぶ。 */
  specimenTypeCode: string;
  specimenTypeName: string;
  /** 培養結果。空は未入力(Observation を作らない)。 */
  culture: "" | "negative" | "positive";
  /** 塗抹・鏡検所見(自由記載)。空は未入力。 */
  smear: string;
  /** 喀痰品質評価。空は未実施(Observation を作らない)。 */
  millerJones: string;
  geckler: string;
  /** 膿尿評価。評価法・評価結果とも空は未実施。 */
  pyuriaMethod: string;
  pyuriaResult: string;
  isolates: MicroIsolateValues[];
  // 以下は編集時の id 温存用。画面からは触らない。
  cultureId?: string;
  smearId?: string;
  millerJonesId?: string;
  gecklerId?: string;
  pyuriaId?: string;
}

export function emptySusceptibility(): MicroSusceptibilityValues {
  return {
    drugCode: "",
    drugName: "",
    drugAbbreviation: "",
    methodCode: "",
    methodName: "",
    comparator: "",
    mic: "",
    zone: "",
    sir: "",
    grade: "",
  };
}

export function emptyIsolate(): MicroIsolateValues {
  return {
    organismCode: "",
    organismName: "",
    quantityType: "",
    colonyCount: "",
    causative: "",
    susceptibilities: [],
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyMicroResultForm(): MicroResultFormValues {
  return {
    setting: "outpatient",
    specimenDate: today(),
    orderId: "",
    reportStatus: "final",
    specimenTypeCode: "",
    specimenTypeName: "",
    culture: "",
    smear: "",
    millerJones: "",
    geckler: "",
    pyuriaMethod: "",
    pyuriaResult: "",
    isolates: [],
  };
}

function findSettingDisplay(code: string): string {
  return SETTING_OPTIONS.find((s) => s.code === code)?.display ?? code;
}

// ---- FHIR リソースの組み立て ----

function codingBySystem(
  codings: fhir4.Coding[] | undefined,
  system: string,
): fhir4.Coding | undefined {
  return codings?.find((c) => c.system === system);
}

interface ObservationContext {
  patientId: string;
  effective: string;
  status: MicroReportStatus;
  specimenReference: string;
}

// 検体所見・分離菌・感受性に共通する Observation の骨格。
function baseObservation(
  ctx: ObservationContext,
  code: fhir4.CodeableConcept,
  id?: string,
): fhir4.Observation {
  const resource: fhir4.Observation = {
    resourceType: "Observation",
    status: ctx.status,
    category: [
      {
        coding: [
          { system: OBSERVATION_CATEGORY_SYSTEM, code: "laboratory", display: "Laboratory" },
        ],
      },
    ],
    code,
    subject: { reference: `Patient/${ctx.patientId}` },
    effectiveDateTime: ctx.effective,
    specimen: { reference: ctx.specimenReference },
  };
  if (id) resource.id = id;
  return resource;
}

function resultItemCode(code: string, display: string): fhir4.CodeableConcept {
  return {
    coding: [{ system: RESULT_ITEM_SYSTEM, code, display }],
    text: display,
  };
}

function conceptOf(system: string, code: string, display: string): fhir4.CodeableConcept {
  return { coding: [{ system, code, display }], text: display };
}

// 検体所見(培養結果・塗抹・喀痰品質・膿尿評価)の Observation 群。
// 未入力の所見は Observation を作らない(JANIS の「未実施」に相当)。
function buildFindingObservations(
  values: MicroResultFormValues,
  ctx: ObservationContext,
): { resource: fhir4.Observation; id?: string }[] {
  const findings: { resource: fhir4.Observation; id?: string }[] = [];

  if (values.culture) {
    const resource = baseObservation(ctx, resultItemCode(CODE_CULTURE, "培養結果"), values.cultureId);
    resource.valueCodeableConcept = conceptOf(
      CULTURE_RESULT_SYSTEM,
      values.culture,
      optionDisplay(CULTURE_OPTIONS, values.culture),
    );
    findings.push({ resource, id: values.cultureId });
  }
  if (values.smear.trim()) {
    const resource = baseObservation(ctx, resultItemCode(CODE_SMEAR, "塗抹・鏡検所見"), values.smearId);
    resource.valueString = values.smear.trim();
    findings.push({ resource, id: values.smearId });
  }
  if (values.millerJones) {
    const resource = baseObservation(
      ctx,
      resultItemCode(CODE_MILLER_JONES, "喀痰品質評価(Miller&Jones分類)"),
      values.millerJonesId,
    );
    resource.valueCodeableConcept = conceptOf(
      MILLER_JONES_SYSTEM,
      values.millerJones,
      optionDisplay(MILLER_JONES_OPTIONS, values.millerJones),
    );
    findings.push({ resource, id: values.millerJonesId });
  }
  if (values.geckler) {
    const resource = baseObservation(
      ctx,
      resultItemCode(CODE_GECKLER, "喀痰品質評価(Geckler分類)"),
      values.gecklerId,
    );
    resource.valueCodeableConcept = conceptOf(
      GECKLER_SYSTEM,
      values.geckler,
      optionDisplay(GECKLER_OPTIONS, values.geckler),
    );
    findings.push({ resource, id: values.gecklerId });
  }
  if (values.pyuriaMethod || values.pyuriaResult) {
    const resource = baseObservation(ctx, resultItemCode(CODE_PYURIA, "膿尿評価"), values.pyuriaId);
    if (values.pyuriaMethod) {
      resource.method = conceptOf(
        PYURIA_METHOD_SYSTEM,
        values.pyuriaMethod,
        optionDisplay(PYURIA_METHOD_OPTIONS, values.pyuriaMethod),
      );
    }
    if (values.pyuriaResult) {
      resource.valueCodeableConcept = conceptOf(
        PYURIA_RESULT_SYSTEM,
        values.pyuriaResult,
        optionDisplay(PYURIA_RESULT_OPTIONS, values.pyuriaResult),
      );
    }
    findings.push({ resource, id: values.pyuriaId });
  }
  return findings;
}

function buildIsolateObservation(
  isolate: MicroIsolateValues,
  ctx: ObservationContext,
): fhir4.Observation {
  const resource = baseObservation(ctx, resultItemCode(CODE_ISOLATE, "分離菌"), isolate.id);
  resource.valueCodeableConcept = {
    coding: [
      { system: ORGANISM_SYSTEM, code: isolate.organismCode, display: isolate.organismName },
    ],
    text: isolate.organismName,
  };

  const components: fhir4.ObservationComponent[] = [];
  if (isolate.quantityType) {
    components.push({
      code: resultItemCode(CODE_QUANTITY_TYPE, "菌量"),
      valueCodeableConcept: conceptOf(
        COLONY_QUANTITY_TYPE_SYSTEM,
        isolate.quantityType,
        optionDisplay(QUANTITY_TYPE_OPTIONS, isolate.quantityType),
      ),
    });
  }
  if (isolate.colonyCount) {
    components.push({
      code: resultItemCode(CODE_COLONY_COUNT, "菌数"),
      valueCodeableConcept: conceptOf(
        COLONY_COUNT_SYSTEM,
        isolate.colonyCount,
        optionDisplay(COLONY_COUNT_OPTIONS, isolate.colonyCount),
      ),
    });
  }
  if (isolate.causative) {
    components.push({
      code: resultItemCode(CODE_CAUSATIVE, "起炎性"),
      valueCodeableConcept: conceptOf(
        CAUSATIVE_SYSTEM,
        isolate.causative,
        optionDisplay(CAUSATIVE_OPTIONS, isolate.causative),
      ),
    });
  }
  if (components.length) resource.component = components;
  return resource;
}

function buildSusceptibilityObservation(
  susceptibility: MicroSusceptibilityValues,
  isolateFullUrl: string,
  ctx: ObservationContext,
): fhir4.Observation {
  const resource = baseObservation(
    ctx,
    {
      coding: [
        {
          system: ANTIMICROBIAL_SYSTEM,
          code: susceptibility.drugCode,
          display: susceptibility.drugName,
        },
        ...(susceptibility.drugAbbreviation
          ? [
              {
                system: ANTIMICROBIAL_ABBREVIATION_SYSTEM,
                code: susceptibility.drugCode,
                display: susceptibility.drugAbbreviation,
              },
            ]
          : []),
      ],
      text: susceptibility.drugName,
    },
    susceptibility.id,
  );
  // どの分離菌に対する感受性か。新規の分離菌は urn:uuid のままで、サーバー側で
  // 採番後の Observation id に解決される。
  resource.derivedFrom = [{ reference: isolateFullUrl }];

  if (susceptibility.methodCode) {
    resource.method = conceptOf(
      SUSCEPTIBILITY_METHOD_SYSTEM,
      susceptibility.methodCode,
      susceptibility.methodName || susceptibility.methodCode,
    );
  }
  if (susceptibility.mic) {
    resource.valueQuantity = {
      value: Number(susceptibility.mic),
      unit: "µg/mL",
      system: UNITS_OF_MEASURE_SYSTEM,
      code: "ug/mL",
      // "=" は comparator 無しで表す(FHIR Quantity.comparator に "=" は無い)。
      ...(susceptibility.comparator ? { comparator: susceptibility.comparator } : {}),
    };
  }

  const components: fhir4.ObservationComponent[] = [];
  if (susceptibility.zone) {
    components.push({
      code: resultItemCode(CODE_DISK_DIAMETER, "阻止円径"),
      valueQuantity: {
        value: Number(susceptibility.zone),
        unit: "mm",
        system: UNITS_OF_MEASURE_SYSTEM,
        code: "mm",
      },
    });
  }
  if (susceptibility.grade) {
    components.push({
      code: resultItemCode(CODE_GRADE, "判定(+)"),
      valueCodeableConcept: conceptOf(
        GRADE_SYSTEM,
        susceptibility.grade,
        optionDisplay(GRADE_OPTIONS, susceptibility.grade),
      ),
    });
  }
  if (components.length) resource.component = components;

  if (susceptibility.sir) {
    resource.interpretation = [
      {
        coding: [
          {
            system: INTERPRETATION_SYSTEM,
            code: susceptibility.sir,
            display:
              susceptibility.sir === "S"
                ? "Susceptible"
                : susceptibility.sir === "I"
                  ? "Intermediate"
                  : "Resistant",
          },
        ],
      },
    ];
  }
  return resource;
}

function buildSpecimen(
  values: MicroResultFormValues,
  patientId: string,
  id?: string,
): fhir4.Specimen {
  const resource: fhir4.Specimen = {
    resourceType: "Specimen",
    meta: { profile: [SPECIMEN_PROFILE] },
    status: "available",
    type: {
      coding: [
        {
          system: SPECIMEN_TYPE_SYSTEM,
          code: values.specimenTypeCode,
          display: values.specimenTypeName || undefined,
        },
      ],
      text: values.specimenTypeName || undefined,
    },
    subject: { reference: `Patient/${patientId}` },
    collection: { collectedDateTime: values.specimenDate },
  };
  if (id) resource.id = id;
  return resource;
}

function buildMicroResultTransactionBundle(
  values: MicroResultFormValues,
  patientId: string,
  reportId?: string,
  originalObservationIds?: string[],
  originalSpecimenId?: string,
): fhir4.Bundle {
  // FHIR の dateTime は日付のみ(YYYY-MM-DD)を許容する(検体検査結果と同じ)。
  const effective = values.specimenDate;
  const reportReference = reportId
    ? `DiagnosticReport/${reportId}`
    : `urn:uuid:${crypto.randomUUID()}`;
  const specimenFullUrl = originalSpecimenId
    ? `Specimen/${originalSpecimenId}`
    : `urn:uuid:${crypto.randomUUID()}`;

  const ctx: ObservationContext = {
    patientId,
    effective,
    status: values.reportStatus,
    specimenReference: specimenFullUrl,
  };

  const observationEntries: fhir4.BundleEntry[] = [];
  const resultReferences: fhir4.Reference[] = [];
  const keptObservationIds = new Set<string>();

  const pushObservation = (resource: fhir4.Observation, display?: string): string => {
    const fullUrl = resource.id
      ? `Observation/${resource.id}`
      : `urn:uuid:${crypto.randomUUID()}`;
    if (resource.id) keptObservationIds.add(resource.id);
    observationEntries.push({
      fullUrl,
      resource,
      request: resource.id
        ? { method: "PUT", url: `Observation/${resource.id}` }
        : { method: "POST", url: "Observation" },
    });
    resultReferences.push({ reference: fullUrl, display });
    return fullUrl;
  };

  for (const finding of buildFindingObservations(values, ctx)) {
    pushObservation(finding.resource, finding.resource.code.text);
  }
  for (const isolate of values.isolates) {
    const isolateFullUrl = pushObservation(
      buildIsolateObservation(isolate, ctx),
      isolate.organismName,
    );
    for (const susceptibility of isolate.susceptibilities) {
      pushObservation(
        buildSusceptibilityObservation(susceptibility, isolateFullUrl, ctx),
        susceptibility.drugAbbreviation || susceptibility.drugName,
      );
    }
  }

  const report: fhir4.DiagnosticReport = {
    resourceType: "DiagnosticReport",
    status: values.reportStatus,
    category: [
      { coding: [{ system: REPORT_CATEGORY_SYSTEM, code: "MB", display: "Microbiology" }] },
      {
        coding: [
          {
            system: SETTING_SYSTEM,
            code: values.setting,
            display: findSettingDisplay(values.setting),
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: LOINC_SYSTEM,
          code: LOINC_MICRO_REPORT_CODE,
          display: "Microbiology studies (set)",
        },
      ],
      text: "細菌検査結果",
    },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: effective,
    // 元になった細菌検査オーダー。オーダーの明細ではなくヘッダを指す。
    basedOn: values.orderId ? [{ reference: `ServiceRequest/${values.orderId}` }] : undefined,
    specimen: [{ reference: specimenFullUrl, display: values.specimenTypeName || undefined }],
    result: resultReferences,
  };
  if (reportId) report.id = reportId;

  const removedObservationEntries: fhir4.BundleEntry[] = (originalObservationIds ?? [])
    .filter((id) => !keptObservationIds.has(id))
    .map((id) => ({ request: { method: "DELETE", url: `Observation/${id}` } }));

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        fullUrl: reportReference,
        resource: report,
        request: reportId
          ? { method: "PUT", url: `DiagnosticReport/${reportId}` }
          : { method: "POST", url: "DiagnosticReport" },
      },
      {
        fullUrl: specimenFullUrl,
        resource: buildSpecimen(values, patientId, originalSpecimenId),
        request: originalSpecimenId
          ? { method: "PUT", url: `Specimen/${originalSpecimenId}` }
          : { method: "POST", url: "Specimen" },
      },
      ...observationEntries,
      ...removedObservationEntries,
    ],
  };
}

export function buildMicroResultBundle(
  values: MicroResultFormValues,
  patientId: string,
): fhir4.Bundle {
  return buildMicroResultTransactionBundle(values, patientId);
}

export function buildMicroResultUpdateBundle(
  values: MicroResultFormValues,
  patientId: string,
  reportId: string,
  originalObservationIds: string[],
  originalSpecimenId: string | undefined,
): fhir4.Bundle {
  return buildMicroResultTransactionBundle(
    values,
    patientId,
    reportId,
    originalObservationIds,
    originalSpecimenId,
  );
}

export function buildMicroResultDeleteBundle(
  reportId: string,
  observationIds: string[],
  specimenIds: string[],
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      { request: { method: "DELETE", url: `DiagnosticReport/${reportId}` } },
      ...observationIds.map((id) => ({
        request: { method: "DELETE" as const, url: `Observation/${id}` },
      })),
      // 参照元の Observation を消してから検体を消す。
      ...specimenIds.map((id) => ({
        request: { method: "DELETE" as const, url: `Specimen/${id}` },
      })),
    ],
  };
}

// ---- 一覧・詳細表示のための parse ----

export interface MicroResultSummary {
  id: string;
  date: string;
  settingDisplay: string;
  status: string;
  /** 中間報告のバッジ表示に使う。 */
  preliminary: boolean;
  specimenName: string;
  cultureDisplay: string;
  isolateNames: string[];
  /** 元になった細菌検査オーダーの id。空なら紐付けなし。 */
  orderId: string;
}

/** DiagnosticReport.basedOn が指す細菌検査オーダー(ヘッダ)の id。無ければ空。 */
export function microOrderIdFromReport(report: fhir4.DiagnosticReport | undefined): string {
  const reference = report?.basedOn?.find((r) =>
    r.reference?.startsWith("ServiceRequest/"),
  )?.reference;
  return reference?.split("/")[1] ?? "";
}

function settingCoding(report: fhir4.DiagnosticReport): fhir4.Coding | undefined {
  for (const category of report.category ?? []) {
    const coding = codingBySystem(category.coding, SETTING_SYSTEM);
    if (coding) return coding;
  }
  return undefined;
}

/** DiagnosticReport が細菌検査結果(category=MB)かどうか。 */
export function isMicroDiagnosticReport(report: fhir4.DiagnosticReport): boolean {
  return (report.category ?? []).some((category) =>
    (category.coding ?? []).some(
      (coding) => coding.system === REPORT_CATEGORY_SYSTEM && coding.code === "MB",
    ),
  );
}

export interface MicroResultDetailBundle {
  report?: fhir4.DiagnosticReport;
  observations: fhir4.Observation[];
  specimens: fhir4.Specimen[];
}

export function splitMicroResultDetailBundle(bundle: fhir4.Bundle): MicroResultDetailBundle {
  const result: MicroResultDetailBundle = { observations: [], specimens: [] };
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType === "DiagnosticReport") {
      result.report = resource as fhir4.DiagnosticReport;
    } else if (resource?.resourceType === "Observation") {
      result.observations.push(resource as fhir4.Observation);
    } else if (resource?.resourceType === "Specimen") {
      result.specimens.push(resource as fhir4.Specimen);
    }
  }

  // include で返る Observation の順序は不定のため、DiagnosticReport.result の
  // 参照順(=登録時の並び: 検体所見 → 分離菌 A とその感受性 → B …)に揃える。
  if (result.report) {
    const order = new Map(
      observationIdsFromReport(result.report).map((id, index) => [id, index]),
    );
    result.observations.sort(
      (a, b) => (order.get(a.id ?? "") ?? Infinity) - (order.get(b.id ?? "") ?? Infinity),
    );
  }
  return result;
}

function resultItemCodeOf(obs: fhir4.Observation): string {
  return codingBySystem(obs.code.coding, RESULT_ITEM_SYSTEM)?.code ?? "";
}

function conceptCode(concept: fhir4.CodeableConcept | undefined, system: string): string {
  return codingBySystem(concept?.coding, system)?.code ?? "";
}

function componentBy(
  obs: fhir4.Observation,
  code: string,
): fhir4.ObservationComponent | undefined {
  return obs.component?.find(
    (c) => codingBySystem(c.code.coding, RESULT_ITEM_SYSTEM)?.code === code,
  );
}

function parseSusceptibility(obs: fhir4.Observation): MicroSusceptibilityValues {
  const drugCoding = codingBySystem(obs.code.coding, ANTIMICROBIAL_SYSTEM);
  const abbrCoding = codingBySystem(obs.code.coding, ANTIMICROBIAL_ABBREVIATION_SYSTEM);
  const methodCoding = codingBySystem(obs.method?.coding, SUSCEPTIBILITY_METHOD_SYSTEM);
  const zone = componentBy(obs, CODE_DISK_DIAMETER)?.valueQuantity?.value;
  const grade = conceptCode(componentBy(obs, CODE_GRADE)?.valueCodeableConcept, GRADE_SYSTEM);
  const sir = obs.interpretation
    ?.flatMap((concept) => codingBySystem(concept.coding, INTERPRETATION_SYSTEM)?.code ?? [])
    .find((code) => code === "S" || code === "I" || code === "R");

  const comparator = obs.valueQuantity?.comparator;
  return {
    id: obs.id,
    drugCode: drugCoding?.code ?? "",
    drugName: drugCoding?.display ?? obs.code.text ?? "",
    drugAbbreviation: abbrCoding?.display ?? "",
    methodCode: methodCoding?.code ?? "",
    methodName: methodCoding?.display ?? "",
    // MIC があって comparator が無いのは "="(入力値の空)として復元する。
    comparator:
      comparator === "<" || comparator === "<=" || comparator === ">=" || comparator === ">"
        ? comparator
        : "",
    mic: obs.valueQuantity?.value != null ? String(obs.valueQuantity.value) : "",
    zone: zone != null ? String(zone) : "",
    sir: (sir ?? "") as SirCode,
    grade,
  };
}

function parseIsolate(obs: fhir4.Observation): MicroIsolateValues {
  const organismCoding = codingBySystem(obs.valueCodeableConcept?.coding, ORGANISM_SYSTEM);
  const causative = conceptCode(
    componentBy(obs, CODE_CAUSATIVE)?.valueCodeableConcept,
    CAUSATIVE_SYSTEM,
  );
  return {
    id: obs.id,
    organismCode: organismCoding?.code ?? "",
    organismName: organismCoding?.display ?? obs.valueCodeableConcept?.text ?? "",
    quantityType: conceptCode(
      componentBy(obs, CODE_QUANTITY_TYPE)?.valueCodeableConcept,
      COLONY_QUANTITY_TYPE_SYSTEM,
    ),
    colonyCount: conceptCode(
      componentBy(obs, CODE_COLONY_COUNT)?.valueCodeableConcept,
      COLONY_COUNT_SYSTEM,
    ),
    causative: (causative === "none" || causative === "present" || causative === "unknown"
      ? causative
      : "") as MicroIsolateValues["causative"],
    susceptibilities: [],
  };
}

export function parseMicroResultForm(
  report: fhir4.DiagnosticReport,
  observations: fhir4.Observation[],
  specimens: fhir4.Specimen[] = [],
): MicroResultFormValues {
  const values = emptyMicroResultForm();
  values.setting = (settingCoding(report)?.code ?? "") as LabResultSetting;
  values.specimenDate = report.effectiveDateTime?.slice(0, 10) ?? today();
  values.orderId = microOrderIdFromReport(report);
  values.reportStatus = report.status === "preliminary" ? "preliminary" : "final";

  const specimen = specimens[0];
  const typeCoding = codingBySystem(specimen?.type?.coding, SPECIMEN_TYPE_SYSTEM);
  values.specimenTypeCode = typeCoding?.code ?? "";
  values.specimenTypeName = typeCoding?.display ?? specimen?.type?.text ?? "";

  // observations は DiagnosticReport.result の参照順(splitMicroResultDetailBundle で
  // 並べ替え済み)を前提に、分離菌 A〜E の並びをそのまま復元する。
  const isolateById = new Map<string, MicroIsolateValues>();
  for (const obs of observations) {
    const kind = resultItemCodeOf(obs);
    if (kind === CODE_CULTURE) {
      values.culture = (conceptCode(obs.valueCodeableConcept, CULTURE_RESULT_SYSTEM) === "positive"
        ? "positive"
        : "negative") as MicroResultFormValues["culture"];
      values.cultureId = obs.id;
    } else if (kind === CODE_SMEAR) {
      values.smear = obs.valueString ?? "";
      values.smearId = obs.id;
    } else if (kind === CODE_MILLER_JONES) {
      values.millerJones = conceptCode(obs.valueCodeableConcept, MILLER_JONES_SYSTEM);
      values.millerJonesId = obs.id;
    } else if (kind === CODE_GECKLER) {
      values.geckler = conceptCode(obs.valueCodeableConcept, GECKLER_SYSTEM);
      values.gecklerId = obs.id;
    } else if (kind === CODE_PYURIA) {
      values.pyuriaMethod = conceptCode(obs.method, PYURIA_METHOD_SYSTEM);
      values.pyuriaResult = conceptCode(obs.valueCodeableConcept, PYURIA_RESULT_SYSTEM);
      values.pyuriaId = obs.id;
    } else if (kind === CODE_ISOLATE) {
      const isolate = parseIsolate(obs);
      values.isolates.push(isolate);
      if (obs.id) isolateById.set(obs.id, isolate);
    } else if (codingBySystem(obs.code.coding, ANTIMICROBIAL_SYSTEM)) {
      const isolateId = obs.derivedFrom?.[0]?.reference?.split("/").pop() ?? "";
      // derivedFrom が引けない(壊れた)行は直前の分離菌に寄せて、表示から落とさない。
      const isolate = isolateById.get(isolateId) ?? values.isolates[values.isolates.length - 1];
      isolate?.susceptibilities.push(parseSusceptibility(obs));
    }
  }
  return values;
}

export function summarizeMicroResult(
  report: fhir4.DiagnosticReport,
  observations: fhir4.Observation[] = [],
): MicroResultSummary {
  const own = new Set(observationIdsFromReport(report));
  const culture = observations.find(
    (obs) => own.has(obs.id ?? "") && resultItemCodeOf(obs) === CODE_CULTURE,
  );
  const isolateNames = observations
    .filter((obs) => own.has(obs.id ?? "") && resultItemCodeOf(obs) === CODE_ISOLATE)
    .map(
      (obs) =>
        codingBySystem(obs.valueCodeableConcept?.coding, ORGANISM_SYSTEM)?.display ??
        obs.valueCodeableConcept?.text ??
        "",
    )
    .filter(Boolean);

  return {
    id: report.id ?? "",
    date: report.effectiveDateTime?.slice(0, 10) ?? "",
    settingDisplay: settingCoding(report)?.display ?? "",
    status: report.status ?? "",
    preliminary: report.status === "preliminary",
    specimenName: report.specimen?.[0]?.display ?? "",
    cultureDisplay: culture
      ? (codingBySystem(culture.valueCodeableConcept?.coding, CULTURE_RESULT_SYSTEM)?.display ??
        "")
      : "",
    isolateNames,
    orderId: microOrderIdFromReport(report),
  };
}

// MIC の表示値。"=" は記号を省き、それ以外は比較記号を前置する(例: "≦0.5")。
export function micDisplay(susceptibility: MicroSusceptibilityValues): string {
  if (!susceptibility.mic) return "";
  const symbol = COMPARATOR_OPTIONS.find((o) => o.code === susceptibility.comparator)?.display;
  return susceptibility.comparator && symbol ? `${symbol}${susceptibility.mic}` : susceptibility.mic;
}
