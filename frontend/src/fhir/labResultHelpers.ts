import type { LabItem } from "../api/masterClient";

// ローカル拡張・コードシステム。正式な CodeSystem が定義されていない(または
// 不明な)項目を表現するための、この検査結果機能専用の URI。
const SETTING_SYSTEM = "http://fhir-client.local/CodeSystem/lab-result-setting"; // 入外区分
// JLAC11 コード。正式な CodeSystem URL が公開されていないためローカル URI を使用。
const JLAC11_SYSTEM = "http://fhir-client.local/CodeSystem/jlac11";
// 検査項目の略称。詳細表示・編集フォームへの復元に使う補助 coding。
const ABBREVIATION_SYSTEM = "http://fhir-client.local/CodeSystem/lab-item-abbreviation";

const OBSERVATION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";
const REPORT_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0074";
const LOINC_SYSTEM = "http://loinc.org";
const LOINC_LAB_REPORT_CODE = "11502-2"; // Laboratory report
const UNITS_OF_MEASURE_SYSTEM = "http://unitsofmeasure.org";

// JP Core の検体検査結果プロファイル。
const OBSERVATION_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Observation_LabResult";
const REPORT_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_DiagnosticReport_LabResult";

export type LabResultSetting = "inpatient" | "outpatient" | "";

export const SETTING_OPTIONS: { code: Exclude<LabResultSetting, "">; display: string }[] = [
  { code: "inpatient", display: "入院" },
  { code: "outpatient", display: "外来" },
];

export interface LabResultLineValues {
  id?: string;
  item: LabItem | null;
  // 結果値。PQ/ST は入力文字列、CD/CO は code_value_list 中の値コード。
  value: string;
}

export interface LabResultFormValues {
  setting: LabResultSetting;
  specimenDate: string;
  lines: LabResultLineValues[];
}

export const emptyLabResultLine: LabResultLineValues = { item: null, value: "" };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyLabResultForm(): LabResultFormValues {
  return {
    setting: "outpatient",
    specimenDate: today(),
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

function effectiveDateTime(dateStr: string): string {
  // fhir-server は Time.iso8601 でパースするため日付のみは不可。時刻0時固定で送る。
  return `${dateStr}T00:00:00+09:00`;
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

function buildObservation(
  line: LabResultLineValues,
  patientId: string,
  effective: string,
): fhir4.Observation {
  const item = line.item;

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
  };

  if (line.id) resource.id = line.id;
  return resource;
}

function buildLabResultTransactionBundle(
  values: LabResultFormValues,
  patientId: string,
  reportId?: string,
  originalObservationIds?: string[],
): fhir4.Bundle {
  const effective = effectiveDateTime(values.specimenDate);
  const reportReference = reportId
    ? `DiagnosticReport/${reportId}`
    : `urn:uuid:${crypto.randomUUID()}`;

  const observationEntries: fhir4.BundleEntry[] = [];
  const resultReferences: fhir4.Reference[] = [];
  const keptObservationIds = new Set<string>();

  for (const line of values.lines) {
    const resource = buildObservation(line, patientId, effective);
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
      ...observationEntries,
      ...removedObservationEntries,
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
): fhir4.Bundle {
  return buildLabResultTransactionBundle(values, patientId, reportId, originalObservationIds);
}

export function buildLabResultDeleteBundle(
  reportId: string,
  observationIds: string[],
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      { request: { method: "DELETE", url: `DiagnosticReport/${reportId}` } },
      ...observationIds.map((id) => ({
        request: { method: "DELETE" as const, url: `Observation/${id}` },
      })),
    ],
  };
}

export function observationIdsFromReport(report: fhir4.DiagnosticReport): string[] {
  return (report.result ?? [])
    .map((r) => r.reference?.split("/").pop())
    .filter((id): id is string => Boolean(id));
}

// ---- 一覧・詳細表示のための parse ----

export interface LabResultSummary {
  id: string;
  date: string;
  settingDisplay: string;
  itemCount: number;
}

function codingBySystem(
  codings: fhir4.Coding[] | undefined,
  system: string,
): fhir4.Coding | undefined {
  return codings?.find((c) => c.system === system);
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
  };
}

export interface LabResultDetailBundle {
  report?: fhir4.DiagnosticReport;
  observations: fhir4.Observation[];
}

export function splitLabResultDetailBundle(bundle: fhir4.Bundle): LabResultDetailBundle {
  const result: LabResultDetailBundle = { observations: [] };
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType === "DiagnosticReport") {
      result.report = resource as fhir4.DiagnosticReport;
    } else if (resource?.resourceType === "Observation") {
      result.observations.push(resource as fhir4.Observation);
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
  value: string;
  unit: string;
}

export function observationLineDisplay(obs: fhir4.Observation): LabResultLineDisplay {
  const jlacCoding = codingBySystem(obs.code.coding, JLAC11_SYSTEM);
  const abbrCoding = codingBySystem(obs.code.coding, ABBREVIATION_SYSTEM);

  let value = "";
  let unit = "";
  if (obs.valueQuantity) {
    value = obs.valueQuantity.value != null ? String(obs.valueQuantity.value) : "";
    unit = obs.valueQuantity.unit ?? "";
  } else if (obs.valueCodeableConcept) {
    value = obs.valueCodeableConcept.coding?.[0]?.display ?? obs.valueCodeableConcept.text ?? "";
  } else if (obs.valueString != null) {
    value = obs.valueString;
  }

  return {
    id: obs.id ?? "",
    name: jlacCoding?.display ?? obs.code.text ?? "",
    abbreviation: abbrCoding?.display ?? "",
    value,
    unit,
  };
}

// ---- 編集フォームへの復元 ----
//
// FHIR リソースにはマスタの全項目(コード型の選択肢など)は保存されていないため、
// まず保存済みの値のみを持つ簡易オブジェクトとして復元し、編集画面側で
// hydrateLabResultForm によりマスタ情報を引き直して補完する。

function labItemFromObservation(obs: fhir4.Observation): LabItem | null {
  const jlacCoding = codingBySystem(obs.code.coding, JLAC11_SYSTEM);
  if (!jlacCoding?.code) return null;
  const abbrCoding = codingBySystem(obs.code.coding, ABBREVIATION_SYSTEM);

  const dataType = obs.valueQuantity ? "PQ" : obs.valueCodeableConcept ? "CD" : "ST";

  return {
    id: 0,
    category_name: null,
    fhir_item_name: jlacCoding.display ?? obs.code.text ?? null,
    abbreviation: abbrCoding?.display ?? null,
    jlac11_specimen: null,
    jlac11_method: null,
    jlac11_code: jlacCoding.code,
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
): LabResultFormValues {
  const lines: LabResultLineValues[] = observations.map((obs) => ({
    id: obs.id,
    item: labItemFromObservation(obs),
    value: lineValueFromObservation(obs),
  }));

  return {
    setting: (settingCoding(report)?.code ?? "") as LabResultSetting,
    specimenDate: report.effectiveDateTime?.slice(0, 10) ?? today(),
    lines: lines.length ? lines : [{ ...emptyLabResultLine }],
  };
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
