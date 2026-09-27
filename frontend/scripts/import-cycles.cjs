// ディレクトリ内の相対 import の循環を列挙する。
//   node scripts/import-cycles.cjs src/api/queries [src/api/masterClient ...]
const fs = require("fs");
const path = require("path");

const roots = process.argv.slice(2);
const graph = new Map();
for (const root of roots) {
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
    const file = path.join(root, name);
    const text = fs.readFileSync(file, "utf8");
    const deps = new Set();
    for (const m of text.matchAll(/from\s+"(\.[^"]+)"/g)) {
      let target = path.resolve(path.dirname(file), m[1]);
      for (const cand of [target + ".ts", target + ".tsx", path.join(target, "index.ts")]) {
        if (fs.existsSync(cand)) { target = cand; break; }
      }
      deps.add(path.relative(process.cwd(), target));
    }
    graph.set(path.relative(process.cwd(), file), deps);
  }
}

const cycles = [];
const state = new Map();
const stack = [];
function dfs(n) {
  state.set(n, 1);
  stack.push(n);
  for (const d of graph.get(n) ?? []) {
    if (!graph.has(d)) continue;
    if (state.get(d) === 1) cycles.push([...stack.slice(stack.indexOf(d)), d]);
    else if (!state.get(d)) dfs(d);
  }
  stack.pop();
  state.set(n, 2);
}
for (const n of graph.keys()) if (!state.get(n)) dfs(n);
const uniq = new Map();
for (const c of cycles) uniq.set([...c.slice(0, -1)].sort().join(" "), c);
console.log(`${uniq.size} cycles`);
for (const c of uniq.values()) console.log("  " + c.map((f) => path.basename(f)).join(" -> "));
