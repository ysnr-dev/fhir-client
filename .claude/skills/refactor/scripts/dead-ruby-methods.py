#!/usr/bin/env python3
"""定義ファイル以外から参照されていない Ruby のメソッドを列挙する。

  scripts/dead-ruby-methods.py [リポジトリのルート(既定 backend)] ...
  scripts/dead-ruby-methods.py backend ../fhir-server

ルート配下の app lib で def されたメソッド名を集め、app lib config db spec の .rb .rake .erb .yml
から識別子として一度も現れないもの(定義行を除く)を出す。Rails が名前で呼ぶもの(アクション・コールバック・演算子)は
routes.rb やシンボルで現れるので、ここに出たものは「名前がどこにも書かれていない」。
同名の別メソッドがあると見逃す(過検出はしない)。消す前に grep で確かめる。
"""
import os
import re
import sys

ROOTS = sys.argv[1:] or ["backend"]
DEF_DIRS = ("app", "lib")
REF_DIRS = ("app", "lib", "config", "db", "spec")
REF_EXT = (".rb", ".rake", ".erb", ".yml", ".yaml", ".tlf", ".json")
SKIP = {
    "initialize", "call", "perform", "to_s", "to_h", "to_a", "to_json", "as_json", "inspect",
    "each", "<=>", "==", "eql?", "hash", "method_missing", "respond_to_missing?",
    "index", "show", "create", "update", "destroy", "new", "edit",
    "up", "down", "change",
    # Rails が名前で呼ぶ上書き
    "serializable_hash", "to_param", "to_partial_path", "read_attribute_for_validation", "validate",
}
DEF_RE = re.compile(r"^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)")
IDENT_RE = re.compile(r"[A-Za-z_]\w*[?!]?")


def files_under(root, dirs, exts):
    for d in dirs:
        base = os.path.join(root, d)
        if not os.path.isdir(base):
            continue
        for dirpath, _, names in os.walk(base):
            for n in names:
                if n.endswith(exts):
                    yield os.path.join(dirpath, n)


for root in ROOTS:
    defs = []  # (file, line, name)
    for f in files_under(root, DEF_DIRS, (".rb", ".rake")):
        with open(f, encoding="utf-8", errors="replace") as fh:
            for i, line in enumerate(fh, 1):
                m = DEF_RE.match(line)
                if m and m.group(1) not in SKIP:
                    defs.append((f, i, m.group(1)))

    refs = {}  # name -> 参照回数(def 行は除く。同じファイル内の呼び出しも数える)
    for f in files_under(root, REF_DIRS, REF_EXT):
        with open(f, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if DEF_RE.match(line):
                    continue
                for ident in IDENT_RE.findall(line):
                    refs[ident] = refs.get(ident, 0) + 1

    dead = []
    for f, i, name in defs:
        base = name.rstrip("=")
        # setter(name=)は `obj.name = ` の形で base が現れる。
        if refs.get(name, 0) + (refs.get(base, 0) if base != name else 0) > 0:
            continue
        dead.append((f, i, name))

    print(f"==== {root}: {len(dead)} 件(def {len(defs)} 件中)")
    for f, i, name in sorted(dead):
        print(f"{f}:{i}\t{name}")
