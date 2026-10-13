#!/usr/bin/env python3
"""複数のファイルに同じ形で繰り返されているコードの塊を列挙する(共通化の候補)。

  scripts/duplicate-blocks.py [dir ...] [--min-lines N] [--min-files M] [--same-file] [--top K] [--by-file]
  例: scripts/duplicate-blocks.py frontend/src/fhir --min-lines 10
      scripts/duplicate-blocks.py backend/app ../fhir-server/app

空白を詰めて比べるので、インデントや改行位置の違いは無視する。識別子の違い(buildRadTaskUpdate と
buildPhysioTaskUpdate など)は別物として扱うため、「名前だけ違う同形の関数」は --min-lines を
小さめにして前後を読むか、grep で探す。import・export だけの行、括弧だけの行は塊の中身に数えない。
長い順に --top 件(既定 40)出す。既定は別ファイル間の重複だけ(同一ファイル内は --same-file)。
重なり合う窓は別々に出るので、長いものから順に読み、同じ場所の短い報告は読み飛ばす。
--by-file は塊の一覧の代わりに「ファイルの組ごとに、相手と同じ内容の行が何行あるか」を多い順に出す
(生理と内視鏡は約 1,900 行同じ、のように全体像を掴むのに使う)。
"""
import os
import re
import sys

args = sys.argv[1:]
min_lines, min_files, same_file, top, by_file = 8, 2, False, 40, False
dirs = []
i = 0
while i < len(args):
    a = args[i]
    if a == "--min-lines":
        min_lines = int(args[i + 1]); i += 2
    elif a == "--min-files":
        min_files = int(args[i + 1]); i += 2
    elif a == "--same-file":
        same_file = True; i += 1
    elif a == "--top":
        top = int(args[i + 1]); i += 2
    elif a == "--by-file":
        by_file = True; i += 1
    else:
        dirs.append(a); i += 1
dirs = dirs or ["frontend/src"]

EXT = (".ts", ".tsx", ".rb", ".rake")
TRIVIAL = re.compile(r"^[\s{}()\[\];,]*$|^(import|export)\b.*\bfrom\b|^require|^end$|^else$|^\}\s*else\s*\{$")


def normalized(path):
    """(正規化行, 元の行番号) の列。空行・自明な行は除く。"""
    out = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for n, line in enumerate(fh, 1):
            s = re.sub(r"\s+", " ", line.strip())
            if not s or TRIVIAL.match(s):
                continue
            out.append((s, n))
    return out


files = []
for d in dirs:
    for dirpath, _, names in os.walk(d):
        for name in names:
            if name.endswith(EXT) and "node_modules" not in dirpath:
                files.append(os.path.join(dirpath, name))

lines = {f: normalized(f) for f in files}
windows = {}  # key -> [(file, index)]
for f, seq in lines.items():
    for idx in range(len(seq) - min_lines + 1):
        key = hash(tuple(s for s, _ in seq[idx : idx + min_lines]))
        windows.setdefault(key, []).append((f, idx))

def equal_at(locs, offset):
    first = None
    for f, idx in locs:
        seq = lines[f]
        if idx + offset < 0 or idx + offset >= len(seq):
            return False
        s = seq[idx + offset][0]
        if first is None:
            first = s
        elif s != first:
            return False
    return True

reports = []
seen = set()
for key, locs in windows.items():
    if len(locs) < 2:
        continue
    file_set = {f for f, _ in locs}
    if len(file_set) < min_files and not (same_file and len(locs) >= 2):
        continue
    # 1 行前も同じなら最大ではない(前の窓で報告される)
    if equal_at(locs, -1):
        continue
    length = min_lines
    while equal_at(locs, length):
        length += 1
    sig = tuple(sorted(locs))
    if sig in seen:
        continue
    seen.add(sig)
    reports.append((length, locs))

if by_file:
    covered = {}  # (fileA, fileB) -> fileA 側で fileB と同じ内容の行(正規化後の index)の集合
    for length, locs in reports:
        for fa, ia in locs:
            for fb, _ in locs:
                if fa != fb:
                    covered.setdefault((fa, fb), set()).update(range(ia, ia + length))
    pairs = sorted(((len(v), a, b) for (a, b), v in covered.items() if a < b), reverse=True)
    for n, a, b in pairs[:top]:
        print(f"{n:5d} 行  {a}  ⇔  {b}  ({len(lines[a])} 行 / {len(lines[b])} 行)")
    print(f"{len(pairs)} 組(うち {min(top, len(pairs))} 組を表示)", file=sys.stderr)
    sys.exit(0)

reports.sort(key=lambda r: -r[0])
for length, locs in reports[:top]:
    print(f"---- {length} 行 × {len(locs)} 箇所")
    for f, idx in sorted(locs):
        seq = lines[f]
        print(f"  {f}:{seq[idx][1]}-{seq[min(idx + length, len(seq)) - 1][1]}")
    print("  " + lines[locs[0][0]][locs[0][1]][0][:100])
print(f"{len(reports)} 件(うち {min(top, len(reports))} 件を表示)", file=sys.stderr)
