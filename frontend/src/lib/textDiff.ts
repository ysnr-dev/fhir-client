// 2 つの文章の差分。行単位で比べ、書き換えた行(消えた行と増えた行が並ぶところ)は
// 文字単位でも比べて、変わった文字だけを示せるようにする(日本語は単語の区切りが無いので
// 文字単位にする)。

export type DiffKind = "same" | "removed" | "added";

export interface DiffSegment {
  text: string;
  /** 行の中で変わった部分か。行ごと増減しただけの行では立てない。 */
  changed: boolean;
}

export interface DiffRow {
  kind: DiffKind;
  segments: DiffSegment[];
}

// LCS の表の大きさの上限。超えたら比べずに「全部消えて全部増えた」とみなす。
const MAX_CELLS = 4_000_000;
// 書き換えとみなす(文字単位で比べる)のは、共通の文字が短い方の行のこの割合以上あるとき。
// 似ていない行どうしを文字で比べると、たまたま同じ文字が点々と残るだけで読みにくい。
const PAIR_SIMILARITY = 0.4;

type Op<T> = { kind: DiffKind; value: T };

function diffSequence<T>(a: T[], b: T[]): Op<T>[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) {
    return [
      ...a.map((value) => ({ kind: "removed" as const, value })),
      ...b.map((value) => ({ kind: "added" as const, value })),
    ];
  }
  // lengths[i][j] = a[i..] と b[j..] の LCS の長さ。
  const lengths = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const ops: Op<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", value: a[i] });
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

function wholeLine(kind: DiffKind, text: string): DiffRow {
  return { kind, segments: [{ text, changed: false }] };
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

function pairRows(before: string, after: string): DiffRow[] | null {
  const ops = diffSequence([...before], [...after]);
  const common = ops.filter((op) => op.kind === "same").length;
  if (common < Math.min([...before].length, [...after].length) * PAIR_SIMILARITY) return null;
  return [
    { kind: "removed", segments: segmentsOf(ops, "removed") },
    { kind: "added", segments: segmentsOf(ops, "added") },
  ];
}

/** 文章を比べる行に分ける。空行と行末の空白は比べない(描画の都合で増減するため)。 */
export function diffLinesOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim() !== "");
}

/** before → after の差分を行で返す。書き換えた行は消えた行・増えた行の組で並ぶ。 */
export function diffText(before: string, after: string): DiffRow[] {
  const ops = diffSequence(diffLinesOf(before), diffLinesOf(after));
  const rows: DiffRow[] = [];
  let index = 0;
  while (index < ops.length) {
    if (ops[index].kind === "same") {
      rows.push(wholeLine("same", ops[index].value));
      index += 1;
      continue;
    }
    // 変わったひとかたまり(消えた行・増えた行の連続)。前から順に組にして、
    // 似ている組は書き換えとして文字単位で比べる。
    const removed: string[] = [];
    const added: string[] = [];
    while (index < ops.length && ops[index].kind !== "same") {
      (ops[index].kind === "removed" ? removed : added).push(ops[index].value);
      index += 1;
    }
    const pairs = Math.min(removed.length, added.length);
    const pending: DiffRow[] = [];
    for (let k = 0; k < pairs; k += 1) {
      const paired = pairRows(removed[k], added[k]);
      if (paired) pending.push(...paired);
      else pending.push(wholeLine("removed", removed[k]), wholeLine("added", added[k]));
    }
    for (const line of removed.slice(pairs)) pending.push(wholeLine("removed", line));
    for (const line of added.slice(pairs)) pending.push(wholeLine("added", line));
    rows.push(...pending);
  }
  return rows;
}
