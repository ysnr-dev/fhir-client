// 文書テンプレート(Word / Excel)へのプレースホルダー差し込み(docs/document-template-design.md)。
//
// .docx / .xlsx は ZIP に入った XML なので、本文の XML から {{名前}} を探して値に置き換える。
// XML は DOM に通さず、タグ単位に切って必要な文字だけを書き換える(DOM で読んで書き戻すと
// XML 宣言や名前空間の書き方が変わり、触っていない部分まで別物になる)。
//
// Word はプレースホルダーを書式の境目や校正の印で複数の run に割ることがあるので、
// 段落ごとに文字をつなげてから探す。値は {{ のあった run に入れ、その書式で表示される。
// 段落をまたぐプレースホルダーは拾わない。
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export type OfficeTemplateKind = "docx" | "xlsx";

export const OFFICE_CONTENT_TYPES: Record<OfficeTemplateKind, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const KIND_MARKERS: Record<OfficeTemplateKind, string> = {
  docx: "word/document.xml",
  xlsx: "xl/workbook.xml",
};

interface PartRule {
  /** プレースホルダーを探す単位になる要素。 */
  paragraphs: ReadonlySet<string>;
  /** 文字を持つ要素。 */
  texts: ReadonlySet<string>;
  /** 中の文字を数えず、置き換えた段落からは取り除く要素(Excel のふりがな)。 */
  skips: ReadonlySet<string>;
  /** 値の改行を Word の改行要素にする。 */
  wordBreak: boolean;
}

const NONE: ReadonlySet<string> = new Set();

const DOCX_RULE: PartRule = {
  paragraphs: new Set(["w:p"]),
  texts: new Set(["w:t"]),
  skips: NONE,
  wordBreak: true,
};

const SHARED_STRINGS_RULE: PartRule = {
  paragraphs: new Set(["si"]),
  texts: new Set(["t"]),
  skips: new Set(["rPh"]),
  wordBreak: false,
};

// ヘッダー・フッターは要素そのものが文字を持つ。
const SHEET_HEADER_FOOTERS = [
  "oddHeader",
  "oddFooter",
  "evenHeader",
  "evenFooter",
  "firstHeader",
  "firstFooter",
];

const SHEET_RULE: PartRule = {
  paragraphs: new Set(["is", ...SHEET_HEADER_FOOTERS]),
  texts: new Set(["t", ...SHEET_HEADER_FOOTERS]),
  skips: new Set(["rPh"]),
  wordBreak: false,
};

const DRAWING_RULE: PartRule = {
  paragraphs: new Set(["a:p"]),
  texts: new Set(["a:t"]),
  skips: NONE,
  wordBreak: false,
};

const DOCX_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
const SHEET_PART = /^xl\/worksheets\/sheet\d+\.xml$/;
const DRAWING_PART = /^xl\/drawings\/drawing\d+\.xml$/;
const WORKBOOK_PART = "xl/workbook.xml";

function ruleOf(kind: OfficeTemplateKind, path: string): PartRule | null {
  if (kind === "docx") return DOCX_PART.test(path) ? DOCX_RULE : null;
  if (path === "xl/sharedStrings.xml") return SHARED_STRINGS_RULE;
  if (SHEET_PART.test(path)) return SHEET_RULE;
  if (DRAWING_PART.test(path)) return DRAWING_RULE;
  return null;
}

const XML_TOKEN = /<[^>]+>|[^<]+/g;
const TAG_NAME = /^<(\/?)([^\s/>!?]+)/;
const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, entity: string) => {
    if (entity[0] !== "#") return ENTITIES[entity];
    const code = entity[1] === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return String.fromCodePoint(code);
  });
}

function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// XML 1.0 に書けない制御文字(タブ・改行以外)は落とす。
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

interface Segment {
  /** 文字を持つ要素の開始タグの位置。 */
  open: number;
  /** 文字のトークンの位置。 */
  index: number;
  /** 段落の文字をつなげたときの開始位置。 */
  start: number;
  text: string;
}

interface Frame {
  segments: Segment[];
  length: number;
  skipRanges: [number, number][];
}

type Resolver = (name: string) => string | undefined;

function renderValue(value: string, openTag: string, rule: PartRule): string {
  const lines = value.replace(INVALID_XML_CHARS, "").split(/\r\n|\r|\n/).map(escapeXml);
  if (!rule.wordBreak) return lines.join("\n");
  const name = TAG_NAME.exec(openTag)?.[2] ?? "w:t";
  return lines.join(`</${name}><w:br/><${name} xml:space="preserve">`);
}

function preserveSpace(openTag: string): string {
  if (openTag.includes("xml:space=")) return openTag;
  return `${openTag.slice(0, -1)} xml:space="preserve">`;
}

function applyFrame(tokens: string[], frame: Frame, rule: PartRule, resolve: Resolver): boolean {
  const joined = frame.segments.map((s) => s.text).join("");
  const edits: { start: number; end: number; value: string }[] = [];
  for (const match of joined.matchAll(PLACEHOLDER)) {
    const value = resolve(match[1]);
    if (value !== undefined) {
      edits.push({ start: match.index, end: match.index + match[0].length, value });
    }
  }
  if (edits.length === 0) return false;

  for (const segment of frame.segments) {
    const segmentEnd = segment.start + segment.text.length;
    const overlapping = edits.filter((e) => e.start < segmentEnd && e.end > segment.start);
    if (overlapping.length === 0) continue;

    const openTag = tokens[segment.open];
    let out = "";
    let position = segment.start;
    for (const edit of overlapping) {
      if (edit.start > position) out += escapeXml(joined.slice(position, edit.start));
      if (edit.start >= segment.start) out += renderValue(edit.value, openTag, rule);
      position = Math.min(edit.end, segmentEnd);
    }
    out += escapeXml(joined.slice(position, segmentEnd));
    tokens[segment.index] = out;

    const name = TAG_NAME.exec(openTag)?.[2] ?? "";
    // 自身が段落でもある要素(ヘッダー・フッター)は属性を持てない。
    if (!rule.paragraphs.has(name)) tokens[segment.open] = preserveSpace(openTag);
  }

  for (const [from, to] of frame.skipRanges) {
    for (let i = from; i <= to; i++) tokens[i] = "";
  }
  return true;
}

// 1 つの XML を走査する。resolve が値を返したプレースホルダーだけ置き換え、
// 置き換えが無ければ元の文字列をそのまま返す。
function processXml(xml: string, rule: PartRule, resolve: Resolver): string {
  const tokens = xml.match(XML_TOKEN) ?? [];
  // テキストボックスでは段落の中に段落が入るので、積んで最も内側に文字を足す。
  const stack: Frame[] = [];
  let textOpen = -1;
  let skipOpen = -1;
  let changed = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token[0] !== "<") {
      const frame = stack[stack.length - 1];
      if (frame && textOpen >= 0 && skipOpen < 0) {
        const text = decodeXml(token);
        frame.segments.push({ open: textOpen, index: i, start: frame.length, text });
        frame.length += text.length;
      }
      continue;
    }

    const tag = TAG_NAME.exec(token);
    if (!tag) continue;
    const name = tag[2];

    if (tag[1] !== "/") {
      if (token.endsWith("/>")) continue;
      if (rule.skips.has(name) && skipOpen < 0) skipOpen = i;
      if (rule.paragraphs.has(name)) stack.push({ segments: [], length: 0, skipRanges: [] });
      if (rule.texts.has(name)) textOpen = i;
      continue;
    }

    if (rule.texts.has(name)) textOpen = -1;
    if (rule.skips.has(name) && skipOpen >= 0) {
      stack[stack.length - 1]?.skipRanges.push([skipOpen, i]);
      skipOpen = -1;
    }
    if (rule.paragraphs.has(name)) {
      const frame = stack.pop();
      if (frame && applyFrame(tokens, frame, rule, resolve)) changed = true;
    }
  }

  return changed ? tokens.join("") : xml;
}

function isUtf16(bytes: Uint8Array): boolean {
  return (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0xff && bytes[1] === 0xfe);
}

// 数式のセルは保存時の計算結果を持っているので、開いたときに計算し直させる
// (差し込んだ値を参照する数式が古い結果のまま表示されないように)。
function forceRecalculation(xml: string): string {
  const calcPr = /<calcPr\b[^>]*>/.exec(xml);
  if (calcPr) {
    if (calcPr[0].includes("fullCalcOnLoad=")) return xml;
    const end = calcPr[0].endsWith("/>") ? "/>" : ">";
    const updated = `${calcPr[0].slice(0, -end.length)} fullCalcOnLoad="1"${end}`;
    return xml.replace(calcPr[0], updated);
  }
  // calcPr は definedNames の後ろ(無ければ sheets の後ろ)に置く決まり。
  for (const anchor of ["</definedNames>", "<definedNames/>", "</sheets>"]) {
    const at = xml.indexOf(anchor);
    if (at >= 0) {
      const insertAt = at + anchor.length;
      return `${xml.slice(0, insertAt)}<calcPr fullCalcOnLoad="1"/>${xml.slice(insertAt)}`;
    }
  }
  return xml;
}

/** 拡張子と中身から形式を判定する。対応していないファイルは null。 */
export function officeTemplateKindOf(fileName: string, bytes: Uint8Array): OfficeTemplateKind | null {
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension !== "docx" && extension !== "xlsx") return null;
  let found = false;
  try {
    unzipSync(bytes, {
      filter: (file) => {
        if (file.name === KIND_MARKERS[extension]) found = true;
        return false;
      },
    });
  } catch {
    return null;
  }
  return found ? extension : null;
}

/** ファイル内のプレースホルダー({{ }} の中身)を出現順・重複なしで返す。 */
export function extractPlaceholders(bytes: Uint8Array, kind: OfficeTemplateKind): string[] {
  const names = new Set<string>();
  const collect: Resolver = (name) => {
    names.add(name);
    return undefined;
  };
  const files = unzipSync(bytes, { filter: (file) => ruleOf(kind, file.name) !== null });
  for (const [path, data] of Object.entries(files)) {
    const rule = ruleOf(kind, path);
    if (rule && !isUtf16(data)) processXml(strFromU8(data), rule, collect);
  }
  return [...names];
}

/**
 * プレースホルダーを values の値に置き換えたファイルを返す。
 * values に無い名前は {{名前}} のまま残す。
 */
export function fillOfficeTemplate(
  bytes: Uint8Array,
  kind: OfficeTemplateKind,
  values: ReadonlyMap<string, string>,
): Uint8Array {
  const resolve: Resolver = (name) => values.get(name);
  const files = unzipSync(bytes);
  for (const [path, data] of Object.entries(files)) {
    if (isUtf16(data)) continue;
    const rule = ruleOf(kind, path);
    if (rule) {
      const xml = strFromU8(data);
      const filled = processXml(xml, rule, resolve);
      if (filled !== xml) files[path] = strToU8(filled);
    } else if (kind === "xlsx" && path === WORKBOOK_PART) {
      files[path] = strToU8(forceRecalculation(strFromU8(data)));
    }
  }
  return zipSync(files);
}
