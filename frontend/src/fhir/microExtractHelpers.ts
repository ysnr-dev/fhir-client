import { csvBlob } from "../lib/csv";
import { localDay } from "../lib/dates";
import {
  patientCell,
  patientColumnLabel,
  patientColumnsOf,
  patientRowOf,
  type ExtractOutput,
  type ExtractPatientRow,
} from "./extractQueryHelpers";
import { observationIdsFromReport } from "./labResultHelpers";
import {
  CAUSATIVE_OPTIONS,
  COLONY_COUNT_OPTIONS,
  CULTURE_OPTIONS,
  GECKLER_OPTIONS,
  PYURIA_METHOD_OPTIONS,
  PYURIA_RESULT_OPTIONS,
  QUANTITY_TYPE_OPTIONS,
  isolateLabel,
  micDisplay,
  parseMicroResultForm,
  reportStatusDisplay,
  type CodeOption,
  type MicroIsolateValues,
  type MicroResultFormValues,
} from "./microResultHelpers";
import { findSettingDisplay } from "./shared";

// 細菌検査の抽出(docs/data-extract-design.md §10)。細菌検査結果を「分離菌 1 株 = 1 行、
// 抗菌薬 = 列」の表にする。検体の所見(材料・培養・塗抹など)は分離菌の行ごとに繰り返す。

export type MicroSusceptibilityField = "sir" | "mic";

export const MICRO_SUSCEPTIBILITY_FIELDS: { value: MicroSusceptibilityField; label: string }[] = [
  { value: "sir", label: "S/I/R" },
  { value: "mic", label: "MIC" },
];

export interface MicroExtractOptions {
  /** 分離菌の無い検体(培養陰性・塗抹のみなど)も 1 行出す。 */
  includeNoIsolate: boolean;
  /** 患者 × 菌ごとに最初の分離菌だけを出す(アンチバイオグラムの集計の慣行)。 */
  firstIsolateOnly: boolean;
  /** 抗菌薬ごとに出す値(並びは MICRO_SUSCEPTIBILITY_FIELDS の順)。 */
  susceptibility: MicroSusceptibilityField[];
}

export interface MicroDrugColumn {
  key: string;
  field: MicroSusceptibilityField;
  header: string;
}

export interface MicroExtractRow extends ExtractPatientRow {
  rowKey: string;
  specimenDate: string;
  /** FIXED_HEADERS と同じ並びの値。 */
  fixed: string[];
  organismKey: string;
  /** 抗菌薬の列のキー → 値。 */
  drugs: Map<string, string>;
}

const FIXED_HEADERS = [
  "採取日",
  "入外",
  "診療科",
  "報告区分",
  "材料",
  "培養",
  "塗抹・鏡検所見",
  "喀痰品質(M&J)",
  "喀痰品質(Geckler)",
  "膿尿評価",
  "菌番号",
  "菌名",
  "菌コード",
  "菌量",
  "菌数",
  "起炎性",
];

function displayOf(options: CodeOption[], code: string): string {
  return options.find((o) => o.code === code)?.display ?? code;
}

function specimenCells(report: fhir4.DiagnosticReport, values: MicroResultFormValues): string[] {
  const pyuria = [displayOf(PYURIA_METHOD_OPTIONS, values.pyuriaMethod), displayOf(PYURIA_RESULT_OPTIONS, values.pyuriaResult)]
    .filter(Boolean)
    .join(" ");
  return [
    localDay(report.effectiveDateTime),
    values.setting ? findSettingDisplay(values.setting) : "",
    values.departmentName,
    reportStatusDisplay(report.status),
    values.specimenTypeName,
    displayOf(CULTURE_OPTIONS, values.culture),
    values.smear,
    values.millerJones,
    displayOf(GECKLER_OPTIONS, values.geckler),
    pyuria,
  ];
}

function isolateCells(isolate: MicroIsolateValues | null, index: number): string[] {
  if (!isolate) return ["", "", "", "", "", ""];
  return [
    isolateLabel(index),
    isolate.organismName,
    isolate.organismCode,
    displayOf(QUANTITY_TYPE_OPTIONS, isolate.quantityType),
    displayOf(COLONY_COUNT_OPTIONS, isolate.colonyCount),
    displayOf(CAUSATIVE_OPTIONS, isolate.causative),
  ];
}

function drugKeyOf(code: string, name: string): string {
  return code || `name:${name}`;
}

/** 細菌検査結果を表の行と列にする。行は採取日の新しい順。 */
export function microExtractTable(
  reports: fhir4.DiagnosticReport[],
  observations: Map<string, fhir4.Observation>,
  specimens: Map<string, fhir4.Specimen>,
  patients: Map<string, fhir4.Patient>,
  options: MicroExtractOptions,
): { drugColumns: MicroDrugColumn[]; rows: MicroExtractRow[] } {
  const drugs = new Map<string, { code: string; label: string }>();
  let rows: MicroExtractRow[] = [];
  for (const report of reports) {
    const reportObservations = observationIdsFromReport(report).flatMap((id) => observations.get(id) ?? []);
    const reportSpecimens = (report.specimen ?? []).flatMap(
      (ref) => specimens.get(ref.reference?.split("/").pop() ?? "") ?? [],
    );
    const values = parseMicroResultForm(report, reportObservations, reportSpecimens);
    const patientId = report.subject?.reference?.split("/").pop() ?? "";
    const base = {
      ...patientRowOf(patientId, patients.get(patientId)),
      specimenDate: localDay(report.effectiveDateTime),
    };
    const specimen = specimenCells(report, values);
    values.isolates.forEach((isolate, index) => {
      const cells = new Map<string, string[]>();
      for (const s of isolate.susceptibilities) {
        const key = drugKeyOf(s.drugCode, s.drugName);
        if (!drugs.has(key)) drugs.set(key, { code: s.drugCode, label: s.drugAbbreviation || s.drugName });
        // 同じ株で同じ薬を 2 つの測定法で測っていれば「、」でつなぐ。
        const add = (field: MicroSusceptibilityField, value: string) => {
          if (!value) return;
          const cellKey = `${key}|${field}`;
          cells.set(cellKey, [...(cells.get(cellKey) ?? []), value]);
        };
        add("sir", s.sir);
        add("mic", micDisplay(s));
      }
      rows.push({
        ...base,
        rowKey: `${report.id}#${index}`,
        fixed: [...specimen, ...isolateCells(isolate, index)],
        organismKey: isolate.organismCode || isolate.organismName,
        drugs: new Map([...cells].map(([k, v]) => [k, v.join("、")])),
      });
    });
    if (values.isolates.length === 0 && options.includeNoIsolate) {
      rows.push({
        ...base,
        rowKey: `${report.id}#`,
        fixed: [...specimen, ...isolateCells(null, 0)],
        organismKey: "",
        drugs: new Map(),
      });
    }
  }

  if (options.firstIsolateOnly) {
    const seen = new Set<string>();
    const oldestFirst = [...rows].sort((a, b) => a.specimenDate.localeCompare(b.specimenDate) || a.rowKey.localeCompare(b.rowKey));
    const kept = new Set<MicroExtractRow>();
    for (const row of oldestFirst) {
      if (!row.organismKey) {
        kept.add(row);
        continue;
      }
      const key = `${row.patientId}|${row.organismKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.add(row);
    }
    rows = rows.filter((row) => kept.has(row));
  }

  rows.sort(
    (a, b) =>
      b.specimenDate.localeCompare(a.specimenDate) ||
      a.patientNumber.localeCompare(b.patientNumber, undefined, { numeric: true }) ||
      a.rowKey.localeCompare(b.rowKey),
  );

  // 表に残った行に出す値がある薬だけを、JANIS 抗菌薬コードの順(系統ごとにまとまる)に並べる。
  const fields = MICRO_SUSCEPTIBILITY_FIELDS.filter((f) => options.susceptibility.includes(f.value));
  const used = new Set(
    rows.flatMap((row) =>
      [...row.drugs.keys()]
        .filter((k) => fields.some((f) => k.endsWith(`|${f.value}`)))
        .map((k) => k.slice(0, k.lastIndexOf("|"))),
    ),
  );
  const drugColumns = [...drugs]
    .filter(([key]) => used.has(key))
    .sort(([a, x], [b, y]) => x.code.localeCompare(y.code, undefined, { numeric: true }) || a.localeCompare(b))
    .flatMap(([key, drug]) =>
      fields.map((field) => ({
        key: `${key}|${field.value}`,
        field: field.value,
        header: fields.length > 1 ? `${drug.label} ${field.label}` : drug.label,
      })),
    );
  return { drugColumns, rows };
}

export function microExtractHeader(drugColumns: MicroDrugColumn[], output: ExtractOutput | undefined): string[] {
  return [
    "患者番号",
    "氏名",
    ...patientColumnsOf(output).map(patientColumnLabel),
    ...FIXED_HEADERS,
    ...drugColumns.map((c) => c.header),
  ];
}

export function microExtractCsv(
  drugColumns: MicroDrugColumn[],
  rows: MicroExtractRow[],
  output: ExtractOutput | undefined,
): Blob {
  const patientColumns = patientColumnsOf(output);
  return csvBlob(
    microExtractHeader(drugColumns, output),
    rows.map((row) => [
      row.patientNumber,
      row.name,
      ...patientColumns.map((column) => patientCell(row, column)),
      ...row.fixed,
      ...drugColumns.map((column) => row.drugs.get(column.key) ?? ""),
    ]),
  );
}
