import { csvBlob } from "../lib/csv";
import { dateTimeLabel } from "../lib/dates";
import {
  patientCell,
  patientColumnLabel,
  patientColumnsOf,
  patientRowOf,
  type ExtractOutput,
  type ExtractPatientRow,
} from "./extractQueryHelpers";
import { EXTRACT_ORDER_KINDS } from "./extractKinds";
import { lotNumberLabel } from "./lotNumberHelpers";
import { UNDERSTANDING_EXT_URL } from "./medicationGuidanceResultHelpers";
import { PERFORMED_MINUTES_EXT_URL } from "./nutritionGuidanceResultHelpers";
import { departmentOf } from "./orderHeader";
import { SETTING_SYSTEM } from "./prescriptionHelpers";
import { PERFORMED_UNITS_EXT_URL } from "./rehabResultHelpers";
import { categoryCoding, conceptLabel, findSettingDisplay, quantityLabel } from "./shared";

// 部門オーダーの実施記録の抽出(docs/data-extract-design.md §13)。実施 1 件(ハブの Procedure)を 1 行にし、
// 実施日時・状態・依頼の情報・実施者・手技・薬剤・材料と、測定値(被曝線量など)を項目ごとの列にする。
// 部門ごとに違うのは測定値の項目だけで、ほかは実施記録の共通の形から読む。

/** 実施記録を書く部門オーダー。手術は「手術」タブ、放射線治療は照射ごとの記録と分けられないので外す。 */
export const PERFORM_EXTRACT_KINDS = EXTRACT_ORDER_KINDS.filter(
  (kind) => kind.performed && kind.kind !== "surgery-order",
);

/**
 * 部門ごとの実施の値で、ハブの拡張に持つもの。値のある行があるときだけ列にする。
 * (栄養指導・服薬指導の記録の本文はテンプレートの回答なので「テンプレート」タブで出す。)
 */
const PERFORM_EXTENSION_COLUMNS = [
  { url: PERFORMED_UNITS_EXT_URL, header: "実施単位数" },
  { url: PERFORMED_MINUTES_EXT_URL, header: "指導時間(分)" },
  { url: UNDERSTANDING_EXT_URL, header: "理解度" },
];

function extensionValue(extension: fhir4.Extension | undefined): string {
  if (!extension) return "";
  if (typeof extension.valueInteger === "number") return String(extension.valueInteger);
  if (typeof extension.valueDecimal === "number") return String(extension.valueDecimal);
  if (extension.valueCoding) return extension.valueCoding.display ?? extension.valueCoding.code ?? "";
  if (extension.valueQuantity) return quantityLabel(extension.valueQuantity);
  return extension.valueString ?? "";
}

export interface PerformMeasureColumn {
  key: string;
  header: string;
}

export interface PerformExtractRow extends ExtractPatientRow {
  rowKey: string;
  performedAt: string;
  /** 折り返さない列(PERFORM_FIXED_HEADERS と同じ並び)。 */
  fixed: string[];
  /** 折り返す列(PERFORM_VALUE_HEADERS と同じ並び)。 */
  values: string[];
  /** 測定値の列のキー → 値。 */
  measures: Map<string, string>;
}

const PERFORM_FIXED_HEADERS = ["実施日時", "終了", "状態", "依頼日", "依頼科", "入外"];
const PERFORM_VALUE_HEADERS = ["依頼項目", "実施者", "手技", "手技コード", "薬剤", "材料", "コメント"];

const STATUS_LABELS: Record<string, string> = {
  completed: "実施済",
  stopped: "途中で中止",
  "not-done": "実施せず",
  "in-progress": "実施中",
  preparation: "準備中",
  "on-hold": "保留中",
};

/** 使った器材(名称と数量)。数量は部門ごとの `*-material-quantity` 拡張に入っている。 */
function materialLabel(usedCode: fhir4.CodeableConcept): string {
  const quantity = usedCode.extension?.find((e) => e.url.endsWith("-material-quantity"))?.valueQuantity;
  return [conceptLabel(usedCode), quantityLabel(quantity)].filter(Boolean).join(" ");
}

function medicineLabel(administration: fhir4.MedicationAdministration): string {
  return [
    conceptLabel(administration.medicationCodeableConcept),
    quantityLabel(administration.dosage?.dose),
    conceptLabel(administration.dosage?.route),
    lotNumberLabel(administration),
  ]
    .filter(Boolean)
    .join(" ");
}

function codeOf(concept: fhir4.CodeableConcept | undefined): string {
  return concept?.coding?.find((c) => c.code)?.code ?? "";
}

function measureKeyOf(observation: fhir4.Observation): string {
  const coding = observation.code.coding?.find((c) => c.code);
  return coding ? `${coding.system ?? ""}|${coding.code}` : `text:${observation.code.text ?? ""}`;
}

function measureValue(observation: fhir4.Observation): { text: string; unit: string } {
  if (observation.valueQuantity) {
    const value = observation.valueQuantity.value;
    return { text: value == null ? "" : String(value), unit: observation.valueQuantity.unit ?? "" };
  }
  if (typeof observation.valueInteger === "number") return { text: String(observation.valueInteger), unit: "" };
  if (observation.valueCodeableConcept) return { text: conceptLabel(observation.valueCodeableConcept), unit: "" };
  return { text: observation.valueString ?? "", unit: "" };
}

function referenceId(reference: string | undefined, type: string): string {
  return reference?.startsWith(`${type}/`) ? reference.slice(type.length + 1) : "";
}

/** 実施記録を表の行と測定値の列にする。行は実施日時の新しい順。 */
export function performExtractTable(
  hubs: fhir4.Procedure[],
  children: Map<string, fhir4.Procedure[]>,
  administrations: Map<string, fhir4.MedicationAdministration[]>,
  observations: Map<string, fhir4.Observation[]>,
  serviceRequests: fhir4.ServiceRequest[],
  patients: Map<string, fhir4.Patient>,
): { measureColumns: PerformMeasureColumn[]; rows: PerformExtractRow[] } {
  const requestsById = new Map(serviceRequests.flatMap((sr) => (sr.id ? [[sr.id, sr] as const] : [])));
  const detailsByHeader = new Map<string, fhir4.ServiceRequest[]>();
  for (const sr of serviceRequests) {
    const parent = referenceId(sr.basedOn?.[0]?.reference, "ServiceRequest");
    if (parent) detailsByHeader.set(parent, [...(detailsByHeader.get(parent) ?? []), sr]);
  }

  const measureColumns = new Map<string, { label: string; units: Set<string> }>();
  const rows = hubs.map((hub): PerformExtractRow => {
    const hubId = hub.id ?? "";
    const childList = children.get(hubId) ?? [];
    const partIds = [hubId, ...childList.map((c) => c.id ?? "")].filter(Boolean);
    const orderId = (hub.basedOn ?? []).map((r) => referenceId(r.reference, "ServiceRequest")).find(Boolean) ?? "";
    const order = requestsById.get(orderId);
    const details = detailsByHeader.get(orderId) ?? [];
    const procedures = [hub, ...childList];

    const measures = new Map<string, string[]>();
    for (const column of PERFORM_EXTENSION_COLUMNS) {
      const value = extensionValue(hub.extension?.find((e) => e.url === column.url));
      if (!value) continue;
      const key = `ext:${column.url}`;
      measureColumns.set(key, measureColumns.get(key) ?? { label: column.header, units: new Set<string>() });
      measures.set(key, [value]);
    }
    for (const observation of partIds.flatMap((id) => observations.get(id) ?? [])) {
      const key = measureKeyOf(observation);
      const { text, unit } = measureValue(observation);
      if (!text) continue;
      const column = measureColumns.get(key) ?? { label: conceptLabel(observation.code), units: new Set<string>() };
      if (unit) column.units.add(unit);
      measureColumns.set(key, column);
      measures.set(key, [...(measures.get(key) ?? []), text]);
    }

    // 入外区分はオーダー共通の prescription-setting(処方と同じコード表)。
    const setting = order ? categoryCoding(order, SETTING_SYSTEM) : undefined;
    const patientId = hub.subject?.reference?.split("/").pop() ?? "";
    const performedAt = hub.performedDateTime ?? hub.performedPeriod?.start ?? "";
    return {
      ...patientRowOf(patientId, patients.get(patientId)),
      rowKey: hubId,
      performedAt,
      fixed: [
        dateTimeLabel(performedAt),
        dateTimeLabel(hub.performedPeriod?.end),
        STATUS_LABELS[hub.status] ?? hub.status,
        dateTimeLabel(order?.occurrenceDateTime ?? order?.authoredOn).slice(0, 10),
        order ? departmentOf(order).departmentName : "",
        setting?.display ?? findSettingDisplay(setting?.code ?? ""),
      ],
      values: [
        details.map((d) => conceptLabel(d.code)).filter(Boolean).join("、"),
        [...new Set((hub.performer ?? []).map((p) => p.actor?.display ?? "").filter(Boolean))].join("、"),
        procedures.map((p) => conceptLabel(p.code)).filter(Boolean).join("、"),
        procedures.map((p) => codeOf(p.code)).filter(Boolean).join("、"),
        partIds
          .flatMap((id) => administrations.get(id) ?? [])
          .map(medicineLabel)
          .filter(Boolean)
          .join("、"),
        procedures
          .flatMap((p) => p.usedCode ?? [])
          .map(materialLabel)
          .filter(Boolean)
          .join("、"),
        (hub.note ?? []).map((n) => n.text).filter(Boolean).join(" / "),
      ],
      measures: new Map([...measures].map(([key, texts]) => [key, texts.join("、")])),
    };
  });

  rows.sort(
    (a, b) =>
      b.performedAt.localeCompare(a.performedAt) ||
      a.patientNumber.localeCompare(b.patientNumber, undefined, { numeric: true }),
  );
  return {
    // 測定値の単位が 1 つなら見出しに添える。
    measureColumns: [...measureColumns].map(([key, { label, units }]) => ({
      key,
      header: units.size === 1 ? `${label}(${[...units][0]})` : label,
    })),
    rows,
  };
}

export function performExtractHeader(
  measureColumns: PerformMeasureColumn[],
  output: ExtractOutput | undefined,
): string[] {
  return [
    "患者番号",
    "氏名",
    ...patientColumnsOf(output).map(patientColumnLabel),
    ...PERFORM_FIXED_HEADERS,
    ...PERFORM_VALUE_HEADERS,
    ...measureColumns.map((c) => c.header),
  ];
}

export function performRowCells(row: PerformExtractRow, measureColumns: PerformMeasureColumn[]): string[] {
  return [...row.values, ...measureColumns.map((c) => row.measures.get(c.key) ?? "")];
}

export function performExtractCsv(
  measureColumns: PerformMeasureColumn[],
  rows: PerformExtractRow[],
  output: ExtractOutput | undefined,
): Blob {
  const patientColumns = patientColumnsOf(output);
  return csvBlob(
    performExtractHeader(measureColumns, output),
    rows.map((row) => [
      row.patientNumber,
      row.name,
      ...patientColumns.map((column) => patientCell(row, column)),
      ...row.fixed,
      ...performRowCells(row, measureColumns),
    ]),
  );
}
