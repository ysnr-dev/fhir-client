// frontend/src の、定義ファイルの外から一度も参照されていない export を列挙する(未使用と export 不要に分けて)。
//   node .claude/skills/refactor/scripts/dead-exports.cjs [--path <定義ファイルの前方一致>] [src ディレクトリ(既定 frontend/src)]
//   例: node .claude/skills/refactor/scripts/dead-exports.cjs --path frontend/src/fhir/rad
// --path は「定義がそのパスにあるもの」だけを出す(参照は src 全体から数える)。
// tsc の noUnusedLocals は export された名前を見ないので、その穴を埋める。
// 名前の一致で数えるので、同名の別物があると見逃す(過検出はしない方向)。
// 出力の名前が本当に未使用かは、消す前に grep で確かめる。
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const pathIdx = argv.indexOf("--path");
const prefixes = [];
if (pathIdx >= 0) {
  prefixes.push(path.resolve(argv[pathIdx + 1]));
  argv.splice(pathIdx, 2);
}
const root = path.resolve(argv[0] ?? "frontend/src");

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(root, []);
const texts = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));

// 定義: export const/let/function/class/type/interface/enum NAME、export { a, b as c }(from 無し)
const defs = [];
const defRe =
  /^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum|abstract class)\s+([A-Za-z_$][\w$]*)/gm;
const listRe = /^export\s*\{([^}]*)\}\s*;?\s*$/gm;
for (const [file, text] of texts) {
  for (const m of text.matchAll(defRe)) {
    const isType = /\b(type|interface)\s+\w+$/.test(m[0]);
    defs.push({ file, name: m[1], line: lineOf(text, m.index), isType });
  }
  for (const m of text.matchAll(listRe)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop();
      if (name) defs.push({ file, name, line: lineOf(text, m.index), isType: /^\s*type\s/.test(part) });
    }
  }
}

function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// 参照: 各ファイルの識別子を集める。純粋な再 export 行(export ... from)は参照に数えない。
const refs = new Map(); // name -> Map(file -> 出現回数)
const reexportLine = /^\s*export\s+(\*|\{[^}]*\})\s+from\s+/;
for (const [file, text] of texts) {
  for (const line of text.split("\n")) {
    if (reexportLine.test(line)) continue;
    for (const m of line.matchAll(/[A-Za-z_$][\w$]*/g)) {
      let byFile = refs.get(m[0]);
      if (!byFile) refs.set(m[0], (byFile = new Map()));
      byFile.set(file, (byFile.get(file) ?? 0) + 1);
    }
  }
}

const entry = new Set(["main.tsx", "vite-env.d.ts"]);
// 定義ファイルの外から参照が無いもの。さらに定義ファイル内でも定義行(1 回)以外に現れなければ「未使用」。
const unused = [];
const exportOnly = [];
for (const d of defs) {
  if (entry.has(path.basename(d.file))) continue;
  if (prefixes.length && !prefixes.some((p) => d.file.startsWith(p))) continue;
  const byFile = refs.get(d.name) ?? new Map();
  let outside = false;
  for (const f of byFile.keys()) if (f !== d.file) outside = true;
  if (outside) continue;
  ((byFile.get(d.file) ?? 0) <= 1 ? unused : exportOnly).push(d);
}

const byPos = (a, b) => a.file.localeCompare(b.file) || a.line - b.line;
const show = (title, list) => {
  for (const [label, isType] of [["値", false], ["型", true]]) {
    const part = list.filter((d) => d.isType === isType).sort(byPos);
    console.log(`## ${title} / ${label}: ${part.length} 件`);
    for (const d of part) console.log(`${path.relative(process.cwd(), d.file)}:${d.line}\t${d.name}`);
    console.log();
  }
};
show("どこからも使われていない(定義ごと消せる候補)", unused);
show("定義ファイルの中でしか使われていない(export を外す候補)", exportOnly);
console.error(`export ${defs.length} 件中、未使用 ${unused.length} 件、export 不要 ${exportOnly.length} 件`);
