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
import { departmentOf } from "./orderHeader";
import {
  SCHEMA_IMAGE_NOTE,
  UNIT_EXT_URL,
  containedPractitionerName,
  plainAnswerText,
  qrStatusLabel,
} from "./questionnaireResponseHelpers";
import { annotationOf } from "./schemaImage";

// テンプレートの抽出(docs/data-extract-design.md §8)。1 つのテンプレート(同じ url の全版)の回答を
// 「回答 1 件 = 1 行、項目 = 列」の表にする。列は全版の項目を linkId で突き合わせた和で、
// 繰り返しグループは回答に現れた件数だけ「項目名_2」「項目名_3」… と列を増やす。

/** 全版の項目を合わせた木の節。 */
interface TemplateNode {
  linkId: string;
  text: string;
  unit: string;
  isGroup: boolean;
  repeats: boolean;
  children: TemplateNode[];
}

export interface TemplateColumn {
  /** 回答の値を引くキー(`linkId#繰り返しの何件目`)。 */
  key: string;
  header: string;
}

export interface TemplateExtractRow extends ExtractPatientRow {
  responseId: string;
  authored: string;
  authorName: string;
  departmentName: string;
  version: string;
  status: string;
  values: Map<string, string>;
}

const FIXED_HEADERS = ["記入日時", "記入者", "診療科", "版", "状態"];

/** 回答の questionnaire(canonical)の版。版の無い canonical は空文字。 */
export function responseVersionOf(response: fhir4.QuestionnaireResponse): string {
  const canonical = response.questionnaire ?? "";
  const bar = canonical.indexOf("|");
  return bar < 0 ? "" : canonical.slice(bar + 1);
}

/** 新しい版から順に並べる(版の無いものは最後)。 */
export function sortVersionsDesc(questionnaires: fhir4.Questionnaire[]): fhir4.Questionnaire[] {
  return [...questionnaires].sort((a, b) => {
    if (!a.version || !b.version) return a.version ? -1 : b.version ? 1 : 0;
    return b.version.localeCompare(a.version, undefined, { numeric: true });
  });
}

function toNode(item: fhir4.QuestionnaireItem): TemplateNode {
  const unit = item.extension?.find((e) => e.url === UNIT_EXT_URL)?.valueCoding;
  return {
    linkId: item.linkId,
    text: item.text ?? item.linkId,
    unit: unit ? (unit.display ?? unit.code ?? "") : "",
    isGroup: item.type === "group",
    repeats: item.type === "group" && Boolean(item.repeats),
    children: (item.item ?? []).map(toNode),
  };
}

/**
 * 全版の項目を 1 つの木にする。新しい版の木を土台にし、古い版にだけある項目は、親が木にあれば
 * その子の末尾に、無ければ根の末尾に足す。
 */
function mergeTemplateTree(questionnaires: fhir4.Questionnaire[]): TemplateNode[] {
  const roots: TemplateNode[] = [];
  const byLinkId = new Map<string, TemplateNode>();
  const register = (node: TemplateNode) => {
    byLinkId.set(node.linkId, node);
    node.children.forEach(register);
  };
  for (const questionnaire of sortVersionsDesc(questionnaires)) {
    (function walk(items: fhir4.QuestionnaireItem[] | undefined, parent: TemplateNode | null) {
      for (const item of items ?? []) {
        const known = byLinkId.get(item.linkId);
        if (known) {
          walk(item.item, known);
          continue;
        }
        const node = toNode(item);
        (parent ? parent.children : roots).push(node);
        register(node);
      }
    })(questionnaire.item, null);
  }
  return roots;
}

function repeatGroupIds(nodes: TemplateNode[], into = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.repeats) into.add(node.linkId);
    repeatGroupIds(node.children, into);
  }
  return into;
}

function valueKey(linkId: string, indices: number[]): string {
  return `${linkId}#${indices.join("_")}`;
}

/**
 * 回答 1 件の値(キー → 表示文字列)。繰り返しグループは兄弟の中で何件目かを数え、配下の項目の
 * キーに添える。choice の下の条件付きの項目は item.item にも answer.item にも置かれうるので両方を辿る。
 * あわせて、繰り返しグループの件数(グループのキー → 件数)を数える。
 */
function responseValues(
  response: fhir4.QuestionnaireResponse,
  repeatIds: Set<string>,
  counts: Map<string, number>,
): Map<string, string> {
  const values = new Map<string, string[]>();
  (function walk(items: fhir4.QuestionnaireResponseItem[] | undefined, indices: number[]) {
    const seen = new Map<string, number>();
    for (const item of items ?? []) {
      let childIndices = indices;
      if (repeatIds.has(item.linkId)) {
        const index = (seen.get(item.linkId) ?? 0) + 1;
        seen.set(item.linkId, index);
        const groupKey = valueKey(item.linkId, indices);
        counts.set(groupKey, Math.max(counts.get(groupKey) ?? 0, index));
        childIndices = [...indices, index];
      }
      const key = valueKey(item.linkId, indices);
      const texts = (item.answer ?? []).map(plainAnswerText).filter(Boolean);
      if (annotationOf(item)) texts.push(SCHEMA_IMAGE_NOTE);
      if (texts.length) values.set(key, [...(values.get(key) ?? []), ...texts]);
      walk(item.item, childIndices);
      for (const answer of item.answer ?? []) walk(answer.item, childIndices);
    }
  })(response.item, []);
  return new Map([...values].map(([key, texts]) => [key, texts.join("、")]));
}

function columnsOf(roots: TemplateNode[], counts: Map<string, number>): TemplateColumn[] {
  const columns: (TemplateColumn & { base: string; parent: string })[] = [];
  (function emit(nodes: TemplateNode[], indices: number[], parentText: string) {
    for (const node of nodes) {
      if (node.repeats) {
        const count = Math.max(1, counts.get(valueKey(node.linkId, indices)) ?? 0);
        for (let n = 1; n <= count; n += 1) emit(node.children, [...indices, n], node.text);
        continue;
      }
      if (!node.isGroup) {
        const base = node.unit ? `${node.text}(${node.unit})` : node.text;
        const suffix = indices.some((i) => i > 1) ? `_${indices.join("_")}` : "";
        columns.push({ key: valueKey(node.linkId, indices), header: base + suffix, base, parent: parentText });
      }
      emit(node.children, indices, node.isGroup ? node.text : parentText);
    }
  })(roots, [], "");
  const headerCounts = new Map<string, number>();
  for (const column of columns) headerCounts.set(column.header, (headerCounts.get(column.header) ?? 0) + 1);
  return columns.map(({ key, header, parent }) => ({
    key,
    header: (headerCounts.get(header) ?? 0) > 1 && parent ? `${parent}/${header}` : header,
  }));
}

/** 回答を表の行と列にする。行は記入日時の新しい順。 */
export function templateExtractTable(
  questionnaires: fhir4.Questionnaire[],
  responses: fhir4.QuestionnaireResponse[],
  patients: Map<string, fhir4.Patient>,
): { columns: TemplateColumn[]; rows: TemplateExtractRow[] } {
  const roots = mergeTemplateTree(questionnaires);
  const repeatIds = repeatGroupIds(roots);
  const counts = new Map<string, number>();
  const rows = responses
    .map((response): TemplateExtractRow => {
      const patientId = response.subject?.reference?.split("/").pop() ?? "";
      return {
        ...patientRowOf(patientId, patients.get(patientId)),
        responseId: response.id ?? "",
        authored: response.authored ?? "",
        authorName: containedPractitionerName(response),
        departmentName: departmentOf(response).departmentName,
        version: responseVersionOf(response),
        status: qrStatusLabel(response.status),
        values: responseValues(response, repeatIds, counts),
      };
    })
    .sort((a, b) => b.authored.localeCompare(a.authored));
  return { columns: columnsOf(roots, counts), rows };
}

/** 患者ごとに最新の回答だけを残す(rows は記入日時の新しい順)。 */
export function latestPerPatient(rows: TemplateExtractRow[]): TemplateExtractRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.patientId)) return false;
    seen.add(row.patientId);
    return true;
  });
}

export function templateFixedCells(row: TemplateExtractRow): string[] {
  return [dateTimeLabel(row.authored), row.authorName, row.departmentName, row.version, row.status];
}

export function templateExtractHeader(columns: TemplateColumn[], output: ExtractOutput | undefined): string[] {
  return [
    "患者番号",
    "氏名",
    ...patientColumnsOf(output).map(patientColumnLabel),
    ...FIXED_HEADERS,
    ...columns.map((c) => c.header),
  ];
}

export function templateExtractCsv(
  columns: TemplateColumn[],
  rows: TemplateExtractRow[],
  output: ExtractOutput | undefined,
): Blob {
  const patientColumns = patientColumnsOf(output);
  return csvBlob(
    templateExtractHeader(columns, output),
    rows.map((row) => [
      row.patientNumber,
      row.name,
      ...patientColumns.map((column) => patientCell(row, column)),
      ...templateFixedCells(row),
      ...columns.map((column) => row.values.get(column.key) ?? ""),
    ]),
  );
}
