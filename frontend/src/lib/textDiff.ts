// 2 つの文章の差分。行単位で比べ、書き換えた行(消えた行と増えた行が並ぶところ)は
// 文字単位でも比べて、変わった文字だけを示せるようにする(日本語は単語の区切りが無いので
// 文字単位にする)。行は文字のほかに描き方(太字・字下げ・ラベル)を持ち、差分でも同じに描く。

import type { RenderedLine } from "./renderedLines";

export type DiffKind = "same" | "removed" | "added";

export interface DiffSegment {
  text: string;
  /** 行の中で変わった部分か。行ごと増減しただけの行では立てない。 */
  changed: boolean;
}

export interface DiffRow extends RenderedLine {
  kind: DiffKind;
  segments: DiffSegment[];
  /** 行ごと消えた・増えた行(書き換えではない)。 */
  whole: boolean;
}

// LCS の表の大きさの上限。超えたら比べずに「全部消えて全部増えた」とみなす。
const MAX_CELLS = 4_000_000;
// 書き換えとみなす(文字単位で比べる)のは、共通の文字が短い方の行のこの割合以上あるとき。
// 似ていない行どうしを文字で比べると、たまたま同じ文字が点々と残るだけで読みにくい。
const PAIR_SIMILARITY = 0.4;

type Op<T> = { kind: DiffKind; value: T };

function diffSequence<T>(a: T[], b: T[], key: (value: T) => string): Op<T>[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) {
    return [
      ...a.map((value) => ({ kind: "removed" as const, value })),
      ...b.map((value) => ({ kind: "added" as const, value })),
    ];
  }
  const ak = a.map(key);
  const bk = b.map(key);
  // lengths[i][j] = a[i..] と b[j..] の LCS の長さ。
  const lengths = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        ak[i] === bk[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const ops: Op<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ak[i] === bk[j]) {
      ops.push({ kind: "same", value: b[j] });
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      ops.push({ kind: "removed", value: a[i] });
      i += 1;
    } else {
      ops.push({ kind: "added", value: b[j] });
      j += 1;
    }
  }
  for (; i < n; i += 1) ops.push({ kind: "removed", value: a[i] });
  for (; j < m; j += 1) ops.push({ kind: "added", value: b[j] });
  return ops;
}

const sameChar = (c: string) => c;

function wholeLine(kind: DiffKind, line: RenderedLine): DiffRow {
  return { ...line, kind, whole: true, segments: [{ text: line.text, changed: false }] };
}

// 同じ種類の連続した文字を 1 区間にまとめる。
function segmentsOf(ops: Op<string>[], side: "removed" | "added"): DiffSegment[] {
  const segments: DiffSegment[] = [];
  for (const op of ops) {
    if (op.kind !== "same" && op.kind !== side) continue;
    const changed = op.kind === side;
    const last = segments[segments.length - 1];
    if (last && last.changed === changed) last.text += op.value;
    else segments.push({ text: op.value, changed });
  }
  return segments;
}

function pairRows(before: RenderedLine, after: RenderedLine): DiffRow[] | null {
  const ops = diffSequence([...before.text], [...after.text], sameChar);
  const common = ops.filter((op) => op.kind === "same").length;
  if (common < Math.min([...before.text].length, [...after.text].length) * PAIR_SIMILARITY) return null;
  return [
    { ...before, kind: "removed", whole: false, segments: segmentsOf(ops, "removed") },
    { ...after, kind: "added", whole: false, segments: segmentsOf(ops, "added") },
  ];
}

/** before → after の差分を行で返す。書き換えた行は消えた行・増えた行の組で並ぶ。 */
export function diffLines(before: RenderedLine[], after: RenderedLine[]): DiffRow[] {
  const ops = diffSequence(before, after, (line) => line.text);
  const rows: DiffRow[] = [];
  let index = 0;
  while (index < ops.length) {
    if (ops[index].kind === "same") {
      rows.push({ ...ops[index].value, kind: "same", whole: false, segments: [{ text: ops[index].value.text, changed: false }] });
      index += 1;
      continue;
    }
    // 変わったひとかたまり(消えた行・増えた行の連続)。前から順に組にして、
    // 似ている組は書き換えとして文字単位で比べる。
    const removed: RenderedLine[] = [];
    const added: RenderedLine[] = [];
    while (index < ops.length && ops[index].kind !== "same") {
      (ops[index].kind === "removed" ? removed : added).push(ops[index].value);
      index += 1;
    }
    const pairs = Math.min(removed.length, added.length);
    for (let k = 0; k < pairs; k += 1) {
      const paired = pairRows(removed[k], added[k]);
      if (paired) rows.push(...paired);
      else rows.push(wholeLine("removed", removed[k]), wholeLine("added", added[k]));
    }
    for (const line of removed.slice(pairs)) rows.push(wholeLine("removed", line));
    for (const line of added.slice(pairs)) rows.push(wholeLine("added", line));
  }
  return rows;
}

/** 変わった行のかたまり(hunk)ごとの先頭の行番号。 */
export function changeStarts(rows: DiffRow[]): number[] {
  const starts: number[] = [];
  rows.forEach((row, index) => {
    if (row.kind !== "same" && (index === 0 || rows[index - 1].kind === "same")) starts.push(index);
  });
  return starts;
}

/** 行ごとに出すかどうか。context が無ければすべて出す。変わった行の前後 context 行と、
 *  そのかたまりが属する直前の太字の行(見出し)を残す。 */
export function visibleRows(rows: DiffRow[], context: number | undefined): boolean[] {
  if (context === undefined) return rows.map(() => true);
  const visible = rows.map(() => false);
  rows.forEach((row, index) => {
    if (row.kind === "same") return;
    for (let near = Math.max(0, index - context); near <= Math.min(rows.length - 1, index + context); near += 1) {
      visible[near] = true;
    }
    for (let back = index - 1; back >= 0; back -= 1) {
      if (rows[back].strong && rows[back].indent <= row.indent) {
        visible[back] = true;
        break;
      }
    }
  });
  return visible;
}
