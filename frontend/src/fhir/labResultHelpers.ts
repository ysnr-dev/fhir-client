import type { LabItem } from "../api/masterClient";

// ローカル拡張・コードシステム。正式な CodeSystem が定義されていない(または
// 不明な)項目を表現するための、この検査結果機能専用の URI。
const SETTING_SYSTEM = "http://fhir-client.local/CodeSystem/lab-result-setting"; // 入外区分
// JLAC11 コード。正式な CodeSystem URL が公開されていないためローカル URI を使用。
// 検体検査オーダー(labOrderHelpers)も同じ体系のコードを持つので共有する。
export const JLAC11_SYSTEM = "http://fhir-client.local/CodeSystem/jlac11";
// JLAC11 の材料(検体)コード。同じく正式な CodeSystem URL がないためローカル URI。
export const JLAC11_SPECIMEN_SYSTEM = "http://fhir-client.local/CodeSystem/jlac11-specimen";
// 検査項目の略称。詳細表示・編集フォームへの復元に使う補助 coding。
// 検体検査オーダー(labOrderHelpers)も同じ用途で使うので共有する。
export const ABBREVIATION_SYSTEM = "http://fhir-client.local/CodeSystem/lab-item-abbreviation";

// Observation.interpretation(H/L/N)。JP-CLINS の JP-Observation-LabResult-eCS が
// 参照する v3 ObservationInterpretation コードシステム。
const INTERPRETATION_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation";

const OBSERVATION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";
const REPORT_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0074";
const LOINC_SYSTEM = "http://loinc.org";
const LOINC_LAB_REPORT_CODE = "11502-2"; // Laboratory report
const UNITS_OF_MEASURE_SYSTEM = "http://unitsofmeasure.org";

// JP Core の検体検査結果プロファイル。
const OBSERVATION_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Observation_LabResult";
const REPORT_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_DiagnosticReport_LabResult";
const SPECIMEN_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Specimen_Common";

// JLAC11 は17桁固定で、10〜12桁目が材料(検体)コード。
// 桁構成: 測定物5桁 + 識別4桁 + 材料3桁 + 測定法3桁 + 結果単位2桁
// https://www.idial.or.jp/jlac_eleven.html
const JLAC11_LENGTH = 17;
const SPECIMEN_CODE_START = 9;
const SPECIMEN_CODE_END = 12;

// 検査項目の JLAC11 コードから材料(検体)コードを取り出す。桁数が想定外のマスタは
// 位置で切り出すと誤ったコードになるため、空文字を返して Specimen を作らない。
export function specimenCodeOf(item: LabItem | null | undefined): string {
  const code = item?.jlac11_code ?? "";
  if (code.length !== JLAC11_LENGTH) return "";
  return code.slice(SPECIMEN_CODE_START, SPECIMEN_CODE_END);
}

// 更新時に既存の Specimen を使い回すための、材料コード → リソース id の対応。
export interface SpecimenRef {
  code: string;
  id: string;
}

export type LabResultSetting = "inpatient" | "outpatient" | "";

export const SETTING_OPTIONS: { code: Exclude<LabResultSetting, "">; display: string }[] = [
  { code: "inpatient", display: "入院" },
  { code: "outpatient", display: "外来" },
];

// 結果値の H/L 判定。フォームでは未選択(空)を許し、FHIR には空を "N" として記録する。
export type LabInterpretation = "H" | "L" | "";

export const INTERPRETATION_OPTIONS: Exclude<LabInterpretation, "">[] = ["H", "L"];

const INTERPRETATION_DISPLAYS: Record<string, string> = {
  H: "High",
  L: "Low",
  N: "Normal",
};

export interface LabResultLineValues {
  id?: string;
  item: LabItem | null;
  // 結果値。PQ/ST は入力文字列、CD/CO は code_value_list 中の値コード。
  value: string;
  // H/L 判定。空値は FHIR 上 "N"(Normal) として記録する。
  interpretation: LabInterpretation;
}

export interface LabResultFormValues {
  setting: LabResultSetting;
  specimenDate: string;
  /**
   * 元になった検体検査オーダー(ヘッダの ServiceRequest)の id。空なら紐付けなし。
   * 紐付けは検査項目単位ではなく「オーダー 1 件 ↔ 結果レポート 1 件」で持つ。
   */
  orderId: string;
  lines: LabResultLineValues[];
}

export const emptyLabResultLine: LabResultLineValues = {
  item: null,
  value: "",
  interpretation: "",
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyLabResultForm(): LabResultFormValues {
  return {
    setting: "outpatient",
    specimenDate: today(),
    orderId: "",
    lines: [{ ...emptyLabResultLine }],
  };
}

function findSettingDisplay(code: string): string {
  return SETTING_OPTIONS.find((s) => s.code === code)?.display ?? code;
}

// コード型(CD/CO)の選択肢。「1：陽性、2：陰性」のような文字列をパースする。
export interface CodeValueOption {
  code: string;
  display: string;
}

export function parseCodeValueList(list: string | null | undefined): CodeValueOption[] {
  if (!list) return [];
  return list
    .split(/[、,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => {
      const [code, ...rest] = s.split(/[：:]/);
      if (!code.trim()) return [];
      return [{ code: code.trim(), display: rest.join("：").trim() || code.trim() }];
    });
}

// データタイプに応じた Observation.value[x]。
// PQ: valueQuantity / CD・CO: valueCodeableConcept / ST(その他): valueString
function buildObservationValue(line: LabResultLineValues): Partial<fhir4.Observation> {
  const item = line.item;
  const dataType = item?.data_type ?? "ST";

  if (dataType === "PQ") {
    return {
      valueQuantity: {
        value: Number(line.value),
        unit: item?.display_unit ?? undefined,
        ...(item?.xml_unit
          ? { system: UNITS_OF_MEASURE_SYSTEM, code: item.xml_unit }
          : {}),
      },
    };
  }

  if (dataType === "CD" || dataType === "CO") {
    const option = parseCodeValueList(item?.code_value_list).find((o) => o.code === line.value);
    if (option) {
      return {
        valueCodeableConcept: {
          coding: [
            {
              system: item?.code_oid || undefined,
              code: option.code,
              display: option.display,
            },
          ],
          text: option.display,
        },
      };
    }
    // 選択肢が復元できない場合(マスタから消えた項目の編集など)は文字列として保持する。
    return { valueCodeableConcept: { text: line.value } };
  }

  return { valueString: line.value };
}

// 1回の検査結果の中で使われる材料(検体)ごとに1つの Specimen を作る計画。
// 血清と血漿が混在する場合は Specimen も2つになり、各 Observation は自分の材料を参照する。
interface SpecimenPlan {
  code: string;
  display: string;
  fullUrl: string;
  id?: string;
}

function planSpecimens(
  values: LabResultFormValues,
  originalSpecimens: SpecimenRef[],
): Map<string, SpecimenPlan> {
  const idByCode = new Map(originalSpecimens.map((s) => [s.code, s.id]));
  const plans = new Map<string, SpecimenPlan>();

  for (const line of values.lines) {
    const code = specimenCodeOf(line.item);
    if (!code || plans.has(code)) continue;

    const id = idByCode.get(code);
    plans.set(code, {
      code,
      display: line.item?.jlac11_specimen ?? "",
      id,
      fullUrl: id ? `Specimen/${id}` : `urn:uuid:${crypto.randomUUID()}`,
    });
  }
  return plans;
}

function buildSpecimen(plan: SpecimenPlan, patientId: string, collected: string): fhir4.Specimen {
  const resource: fhir4.Specimen = {
    resourceType: "Specimen",
    meta: { profile: [SPECIMEN_PROFILE] },
    status: "available",
    type: {
      coding: [
        {
          system: JLAC11_SPECIMEN_SYSTEM,
          code: plan.code,
          display: plan.display || undefined,
        },
      ],
      text: plan.display || undefined,
    },
    subject: { reference: `Patient/${patientId}` },
    collection: { collectedDateTime: collected },
  };

  if (plan.id) resource.id = plan.id;
  return resource;
}

function buildObservation(
  line: LabResultLineValues,
  patientId: string,
  effective: string,
  specimenReference?: string,
): fhir4.Observation {
  const item = line.item;
  // 未選択(空)は "N"(Normal) として記録する。
  const interpretationCode = line.interpretation || "N";

  const resource: fhir4.Observation = {
    resourceType: "Observation",
    meta: { profile: [OBSERVATION_PROFILE] },
    status: "final",
    category: [
      {
        coding: [
          { system: OBSERVATION_CATEGORY_SYSTEM, code: "laboratory", display: "Laboratory" },
        ],
      },
    ],
    code: {
      coding: item
        ? [
            {
              system: JLAC11_SYSTEM,
              code: item.jlac11_code,
              display: item.fhir_item_name ?? undefined,
            },
            ...(item.abbreviation
              ? [
                  {
                    system: ABBREVIATION_SYSTEM,
                    code: item.jlac11_code,
                    display: item.abbreviation,
                  },
                ]
              : []),
          ]
        : undefined,
      text: item?.fhir_item_name ?? undefined,
    },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: effective,
    ...buildObservationValue(line),
    interpretation: [
      {
        coding: [
          {
            system: INTERPRETATION_SYSTEM,
            code: interpretationCode,
            display: INTERPRETATION_DISPLAYS[interpretationCode],
          },
        ],
      },
    ],
  };

  if (specimenReference) resource.specimen = { reference: specimenReference };
  if (line.id) resource.id = line.id;
  return resource;
}

function buildLabResultTransactionBundle(
  values: LabResultFormValues,
  patientId: string,
  reportId?: string,
  originalObservationIds?: string[],
  originalSpecimens?: SpecimenRef[],
): fhir4.Bundle {
  // FHIR の dateTime は日付のみ(YYYY-MM-DD)を許容し、fhir-server もそのまま受理する。
  const effective = values.specimenDate;
  const reportReference = reportId
    ? `DiagnosticReport/${reportId}`
    : `urn:uuid:${crypto.randomUUID()}`;

  const specimenPlans = planSpecimens(values, originalSpecimens ?? []);
  const specimenEntries: fhir4.BundleEntry[] = Array.from(specimenPlans.values()).map((plan) => ({
    fullUrl: plan.fullUrl,
    resource: buildSpecimen(plan, patientId, effective),
    request: plan.id
      ? { method: "PUT" as const, url: `Specimen/${plan.id}` }
      : { method: "POST" as const, url: "Specimen" },
  }));
  const specimenReferences: fhir4.Reference[] = Array.from(specimenPlans.values()).map((plan) => ({
    reference: plan.fullUrl,
    display: plan.display || undefined,
  }));

  const observationEntries: fhir4.BundleEntry[] = [];
  const resultReferences: fhir4.Reference[] = [];
  const keptObservationIds = new Set<string>();

  for (const line of values.lines) {
    const specimenReference = specimenPlans.get(specimenCodeOf(line.item))?.fullUrl;
    const resource = buildObservation(line, patientId, effective, specimenReference);
    const fullUrl = line.id ? `Observation/${line.id}` : `urn:uuid:${crypto.randomUUID()}`;
    if (line.id) keptObservationIds.add(line.id);

    observationEntries.push({
      fullUrl,
      resource,
      request: line.id
        ? { method: "PUT", url: `Observation/${line.id}` }
        : { method: "POST", url: "Observation" },
    });
    resultReferences.push({
      reference: fullUrl,
      display: line.item?.abbreviation ?? line.item?.fhir_item_name ?? undefined,
    });
  }

  const report: fhir4.DiagnosticReport = {
    resourceType: "DiagnosticReport",
    meta: { profile: [REPORT_PROFILE] },
    status: "final",
    category: [
      { coding: [{ system: REPORT_CATEGORY_SYSTEM, code: "LAB", display: "Laboratory" }] },
      {
        coding: [
          { system: SETTING_SYSTEM, code: values.setting, display: findSettingDisplay(values.setting) },
        ],
      },
    ],
    code: {
      coding: [{ system: LOINC_SYSTEM, code: LOINC_LAB_REPORT_CODE, display: "Laboratory report" }],
      text: "臨床検査結果",
    },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: effective,
    // 元になった検体検査オーダー。オーダーの明細ではなくヘッダを指す。
    // 更新でオーダーの選択を外した場合は、リソースごと組み直すので basedOn も消える。
    basedOn: values.orderId ? [{ reference: `ServiceRequest/${values.orderId}` }] : undefined,
    specimen: specimenReferences.length ? specimenReferences : undefined,
    result: resultReferences,
  };

  if (reportId) report.id = reportId;

  const removedObservationEntries: fhir4.BundleEntry[] = (originalObservationIds ?? [])
    .filter((id) => !keptObservationIds.has(id))
    .map((id) => ({ request: { method: "DELETE", url: `Observation/${id}` } }));

  // 使われなくなった材料の Specimen を消す。Observation より後に置くことで、
  // 参照元の Observation が先に更新/削除されてから検体が消える順序になる。
  const removedSpecimenEntries: fhir4.BundleEntry[] = (originalSpecimens ?? [])
    .filter((s) => !specimenPlans.has(s.code))
    .map((s) => ({ request: { method: "DELETE", url: `Specimen/${s.id}` } }));

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
      ...specimenEntries,
      ...observationEntries,
      ...removedObservationEntries,
      ...removedSpecimenEntries,
    ],
  };
}

export function buildLabResultBundle(
  values: LabResultFormValues,
  patientId: string,
): fhir4.Bundle {
  return buildLabResultTransactionBundle(values, patientId);
}

export function buildLabResultUpdateBundle(
  values: LabResultFormValues,
  patientId: string,
  reportId: string,
  originalObservationIds: string[],
  originalSpecimens: SpecimenRef[],
): fhir4.Bundle {
  return buildLabResultTransactionBundle(
    values,
    patientId,
    reportId,
    originalObservationIds,
    originalSpecimens,
  );
}

export function buildLabResultDeleteBundle(
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

function referencedIds(references: fhir4.Reference[] | undefined): string[] {
  return (references ?? [])
    .map((r) => r.reference?.split("/").pop())
    .filter((id): id is string => Boolean(id));
}

export function observationIdsFromReport(report: fhir4.DiagnosticReport): string[] {
  return referencedIds(report.result);
}

export function specimenIdsFromReport(report: fhir4.DiagnosticReport): string[] {
  return referencedIds(report.specimen);
}

// ---- 一覧・詳細表示のための parse ----

export interface LabResultSummary {
  id: string;
  date: string;
  settingDisplay: string;
  itemCount: number;
  /** 元になった検体検査オーダーの id。空なら紐付けなし。 */
  orderId: string;
}

/** DiagnosticReport.basedOn が指す検体検査オーダー(ヘッダ)の id。無ければ空。 */
export function labOrderIdFromReport(
  report: fhir4.DiagnosticReport | undefined,
): string {
  const reference = report?.basedOn?.find((r) =>
    r.reference?.startsWith("ServiceRequest/"),
  )?.reference;
  return reference?.split("/")[1] ?? "";
}

function codingBySystem(
  codings: fhir4.Coding[] | undefined,
  system: string,
): fhir4.Coding | undefined {
  return codings?.find((c) => c.system === system);
}

// Observation.interpretation から H/L/N コードを取り出す。未記録なら空文字。
function interpretationCodeOf(obs: fhir4.Observation): string {
  for (const concept of obs.interpretation ?? []) {
    const coding = codingBySystem(concept.coding, INTERPRETATION_SYSTEM);
    if (coding?.code) return coding.code;
  }
  return "";
}

// H/L のみ表示・フォームの対象にする。"N"(および未記録)は通常表示として扱う。
function formInterpretationOf(obs: fhir4.Observation): LabInterpretation {
  const code = interpretationCodeOf(obs);
  return code === "H" || code === "L" ? code : "";
}

// H/L 判定に応じた表示用クラス修飾子を返す。H: 赤字 / L: 青字。
export function interpretationClass(
  interpretation: string,
  base: string,
): string {
  if (interpretation === "H") return `${base} ${base}--high`;
  if (interpretation === "L") return `${base} ${base}--low`;
  return base;
}

function settingCoding(report: fhir4.DiagnosticReport): fhir4.Coding | undefined {
  for (const category of report.category ?? []) {
    const coding = codingBySystem(category.coding, SETTING_SYSTEM);
    if (coding) return coding;
  }
  return undefined;
}

export function summarizeDiagnosticReport(report: fhir4.DiagnosticReport): LabResultSummary {
  return {
    id: report.id ?? "",
    date: report.effectiveDateTime?.slice(0, 10) ?? "",
    settingDisplay: settingCoding(report)?.display ?? "",
    itemCount: report.result?.length ?? 0,
    orderId: labOrderIdFromReport(report),
  };
}

export interface LabResultDetailBundle {
  report?: fhir4.DiagnosticReport;
  observations: fhir4.Observation[];
  specimens: fhir4.Specimen[];
}

export function splitLabResultDetailBundle(bundle: fhir4.Bundle): LabResultDetailBundle {
  const result: LabResultDetailBundle = { observations: [], specimens: [] };
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
  // 参照順(=登録時の並び)に揃える。
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

export interface LabResultLineDisplay {
  id: string;
  name: string;
  abbreviation: string;
  specimen: string;
  value: string;
  unit: string;
  // H/L 判定("H" | "L" | "")。表示の色分けに使う。
  interpretation: LabInterpretation;
}

function specimenName(specimen: fhir4.Specimen): string {
  return (
    specimen.type?.text ??
    codingBySystem(specimen.type?.coding, JLAC11_SPECIMEN_SYSTEM)?.display ??
    ""
  );
}

// Observation.specimen の参照先を引くための、Specimen id → 材料名称の対応。
export function specimenNamesById(specimens: fhir4.Specimen[]): Map<string, string> {
  return new Map(
    specimens.flatMap((s) => (s.id ? [[s.id, specimenName(s)] as [string, string]] : [])),
  );
}

// Observation.value[x] の表示値と単位。PQ 以外に単位はない。
function observationValueDisplay(obs: fhir4.Observation): { value: string; unit: string } {
  if (obs.valueQuantity) {
    return {
      value: obs.valueQuantity.value != null ? String(obs.valueQuantity.value) : "",
      unit: obs.valueQuantity.unit ?? "",
    };
  }
  if (obs.valueCodeableConcept) {
    return {
      value: obs.valueCodeableConcept.coding?.[0]?.display ?? obs.valueCodeableConcept.text ?? "",
      unit: "",
    };
  }
  return { value: obs.valueString ?? "", unit: "" };
}

export function observationLineDisplay(
  obs: fhir4.Observation,
  specimenNames?: Map<string, string>,
): LabResultLineDisplay {
  const jlacCoding = codingBySystem(obs.code.coding, JLAC11_SYSTEM);
  const abbrCoding = codingBySystem(obs.code.coding, ABBREVIATION_SYSTEM);
  const specimenId = obs.specimen?.reference?.split("/").pop();
  const { value, unit } = observationValueDisplay(obs);

  return {
    id: obs.id ?? "",
    name: jlacCoding?.display ?? obs.code.text ?? "",
    abbreviation: abbrCoding?.display ?? "",
    specimen: (specimenId && specimenNames?.get(specimenId)) || "",
    value,
    unit,
    interpretation: formInterpretationOf(obs),
  };
}

// ---- 時系列表示のための parse ----

export interface LabTimelineRow {
  // JLAC11 コード。同じ項目コードの結果を1行にまとめるためのキー。
  // コードがない Observation は項目名で代用する。
  key: string;
  name: string;
  abbreviation: string;
  unit: string;
  // 検体採取日(YYYY-MM-DD) → 表示値
  values: Map<string, string>;
  // 検体採取日 → 数値。PQ(valueQuantity) のみ。グラフ描画に使う。
  numbers: Map<string, number>;
  // 検体採取日 → H/L 判定。H は赤字、L は青字で表示する。N は登録しない。
  interpretations: Map<string, LabInterpretation>;
}

export interface LabTimeline {
  // 表示対象の検体採取日。新しい順。
  dates: string[];
  rows: LabTimelineRow[];
}

// DiagnosticReport(検体採取日の降順) と _include で取得した Observation から、
// 「検査項目 × 検体採取日」のマトリクスを組み立てる。
// 行の並びは新しいレポートでの登場順(= 登録時の項目順)になる。
export function buildLabTimeline(
  reports: fhir4.DiagnosticReport[],
  observations: fhir4.Observation[],
  dateCount: number,
): LabTimeline {
  const obsById = new Map(observations.map((obs) => [obs.id ?? "", obs]));

  const dates: string[] = [];
  for (const report of reports) {
    const date = report.effectiveDateTime?.slice(0, 10);
    if (date && !dates.includes(date)) dates.push(date);
  }
  const shownDates = dates.slice(0, dateCount);
  const shown = new Set(shownDates);

  const rows = new Map<string, LabTimelineRow>();
  for (const report of reports) {
    const date = report.effectiveDateTime?.slice(0, 10) ?? "";
    if (!shown.has(date)) continue;
    for (const obsId of observationIdsFromReport(report)) {
      const obs = obsById.get(obsId);
      if (!obs) continue;

      const jlacCoding = codingBySystem(obs.code.coding, JLAC11_SYSTEM);
      const name = jlacCoding?.display ?? obs.code.text ?? "";
      const key = jlacCoding?.code ?? `name:${name}`;
      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          name,
          abbreviation: codingBySystem(obs.code.coding, ABBREVIATION_SYSTEM)?.display ?? "",
          unit: "",
          values: new Map(),
          numbers: new Map(),
          interpretations: new Map(),
        };
        rows.set(key, row);
      }

      const { value, unit } = observationValueDisplay(obs);
      if (!row.unit && unit) row.unit = unit;
      // 同じ日に同じ項目が複数ある場合(同日の別レポートなど)は、
      // 並びが先(=新しいレポート)の値を採用する。
      if (row.values.has(date)) continue;
      row.values.set(date, value);
      if (obs.valueQuantity?.value != null) row.numbers.set(date, obs.valueQuantity.value);
      const interpretation = formInterpretationOf(obs);
      if (interpretation) row.interpretations.set(date, interpretation);
    }
  }

  return { dates: shownDates, rows: [...rows.values()] };
}

// ---- 編集フォームへの復元 ----
//
// FHIR リソースにはマスタの全項目(コード型の選択肢など)は保存されていないため、
// まず保存済みの値のみを持つ簡易オブジェクトとして復元し、編集画面側で
// hydrateLabResultForm によりマスタ情報を引き直して補完する。

function labItemFromObservation(
  obs: fhir4.Observation,
  specimenNames: Map<string, string>,
): LabItem | null {
  const jlacCoding = codingBySystem(obs.code.coding, JLAC11_SYSTEM);
  if (!jlacCoding?.code) return null;
  const abbrCoding = codingBySystem(obs.code.coding, ABBREVIATION_SYSTEM);
  const specimenId = obs.specimen?.reference?.split("/").pop();

  const dataType = obs.valueQuantity ? "PQ" : obs.valueCodeableConcept ? "CD" : "ST";

  return {
    id: 0,
    category_name: null,
    major_item: null,
    fhir_item_name: jlacCoding.display ?? obs.code.text ?? null,
    abbreviation: abbrCoding?.display ?? null,
    jlac11_specimen: (specimenId && specimenNames.get(specimenId)) || null,
    jlac11_method: null,
    jlac11_code: jlacCoding.code,
    jlac10_code: null,
    display_unit: obs.valueQuantity?.unit ?? null,
    xml_unit: obs.valueQuantity?.code ?? null,
    data_type: dataType,
    code_value_list: null,
    code_oid: null,
  };
}

function lineValueFromObservation(obs: fhir4.Observation): string {
  if (obs.valueQuantity) {
    return obs.valueQuantity.value != null ? String(obs.valueQuantity.value) : "";
  }
  if (obs.valueCodeableConcept) {
    return obs.valueCodeableConcept.coding?.[0]?.code ?? obs.valueCodeableConcept.text ?? "";
  }
  return obs.valueString ?? "";
}

export function parseLabResultForm(
  report: fhir4.DiagnosticReport,
  observations: fhir4.Observation[],
  specimens: fhir4.Specimen[] = [],
): LabResultFormValues {
  const specimenNames = specimenNamesById(specimens);
  const lines: LabResultLineValues[] = observations.map((obs) => ({
    id: obs.id,
    item: labItemFromObservation(obs, specimenNames),
    value: lineValueFromObservation(obs),
    interpretation: formInterpretationOf(obs),
  }));

  return {
    setting: (settingCoding(report)?.code ?? "") as LabResultSetting,
    specimenDate: report.effectiveDateTime?.slice(0, 10) ?? today(),
    orderId: labOrderIdFromReport(report),
    lines: lines.length ? lines : [{ ...emptyLabResultLine }],
  };
}

// 既存の検査結果を DO(流用)して新規登録するためのフォーム値に変換する。
// ・検査項目(と入外区分)は引き継ぐ
// ・結果値(と H/L 判定)は継承せず空にする
// ・Observation の id を落とし、既存リソースの更新ではなく新規登録にする
// ・検体採取日は DO 元ではなく当日にする
// ・検体検査オーダーの紐付けは引き継がない(DO 元のオーダーには既に結果があるため)
export function buildDoLabResultForm(values: LabResultFormValues): LabResultFormValues {
  return {
    ...values,
    specimenDate: today(),
    orderId: "",
    lines: values.lines.map((line) => ({ item: line.item, value: "", interpretation: "" })),
  };
}

// 更新 Bundle 用に、保存済み Specimen の 材料コード → id を取り出す。
// 同じ材料が引き続き使われていればその Specimen を PUT で使い回す。
export function specimenRefsFrom(specimens: fhir4.Specimen[]): SpecimenRef[] {
  return specimens.flatMap((s) => {
    const code = codingBySystem(s.type?.coding, JLAC11_SPECIMEN_SYSTEM)?.code;
    return code && s.id ? [{ code, id: s.id }] : [];
  });
}

// 復元した簡易オブジェクトを、マスタから引き直した完全な LabItem で置き換える。
// マスタに存在しなくなったコードは簡易オブジェクトのまま残す。
export function hydrateLabResultForm(
  values: LabResultFormValues,
  masterItems: LabItem[],
): LabResultFormValues {
  const byCode = new Map(masterItems.map((item) => [item.jlac11_code, item]));
  return {
    ...values,
    lines: values.lines.map((line) => {
      const master = line.item && byCode.get(line.item.jlac11_code);
      return master ? { ...line, item: master } : line;
    }),
  };
}
