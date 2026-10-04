#!/usr/bin/env python3
"""fhir-client のコードが出す canonical の URL と、fhir-ig が定義・記載する URL を突き合わせる。

使い方: url-drift.py
  FHIR_IG_DIR で fhir-ig の場所を変えられる(既定はリポジトリの隣の ../fhir-ig)。

出力:
  A. アプリにあって IG に無い URL(IG に定義・記載を足す候補)
  B. IG が定義する Extension / CodeSystem のうち、アプリのコードに出てこないもの(消し忘れの候補)
  C. アプリが実行時に組み立てる URL のうち、IG に対応が見当たらないもの(手で確認)

アプリ側は `${BASE}/xxx`・`#{BASE}/xxx` のような同じファイル内の定数の連結を解決し、
`${prefix}-report-item` のような実行時の値は任意の語として扱う。
"""
import os
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

CANONICAL = "http://fhir-client.local"
ROOT = Path(
    subprocess.check_output(
        ["git", "-C", str(Path(__file__).resolve().parent), "rev-parse", "--show-toplevel"], text=True
    ).strip()
)
IG = Path(os.environ.get("FHIR_IG_DIR", ROOT.parent / "fhir-ig"))

# デモ投入ツールはアプリの組み立て関数を呼ぶだけなので、URL の出どころとしては数えない
APP_DIRS = ["frontend/src", "backend/app", "backend/lib"]
APP_EXCLUDE = ["frontend/src/demo-seed"]
APP_SUFFIXES = {".ts", ".tsx", ".rb", ".rake", ".json", ".erb"}
# valueCode(system を持たない code)用の CodeSystem。URL はインスタンスに現れないのでアプリのコードにも無い
IG_CODE_ONLY_FILES = {"input/fsh/terminology/code-only.fsh"}

URL_CHARS = r"[A-Za-z0-9_./-]"
INTERPOLATION = r"[$#]\{[^}]*\}"
URL_RE = re.compile(re.escape(CANONICAL) + URL_CHARS + "*")
CONST_RE = re.compile(r"\b([A-Z][A-Z0-9_]*)\s*=\s*[\"'`](" + re.escape(CANONICAL) + URL_CHARS + r"*)[\"'`]")
TAIL_RE = re.compile(r"(?:" + URL_CHARS + "|" + INTERPOLATION + ")*")
WILDCARD = "\0"
KIND_PATH = {"Extension": "StructureDefinition", "Profile": "StructureDefinition", "CodeSystem": "CodeSystem", "ValueSet": "ValueSet"}
DECL_RE = re.compile(r"^(Extension|Profile|CodeSystem|ValueSet|Instance|Logical|Resource|RuleSet|Invariant|Mapping|Alias):\s*(\S+)")
ID_RE = re.compile(r"^Id:\s*(\S+)")


def app_files():
    for d in APP_DIRS:
        for path in (ROOT / d).rglob("*"):
            rel = path.relative_to(ROOT).as_posix()
            if path.is_file() and path.suffix in APP_SUFFIXES and not any(rel.startswith(e) for e in APP_EXCLUDE):
                yield path, rel


def scan_app():
    """(完全な URL → 出現箇所, 実行時の値を含む URL → 出現箇所, 全ソースの連結) を返す。"""
    full = defaultdict(list)
    patterns = defaultdict(list)
    corpus = []
    for path, rel in app_files():
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        corpus.append(text)
        consts = dict(CONST_RE.findall(text))
        heads = [re.escape(CANONICAL)] + [r"[$#]\{" + re.escape(name) + r"\}" for name in consts]
        head_re = re.compile("|".join(heads))
        for lineno, line in enumerate(text.splitlines(), 1):
            pos = 0
            while True:
                m = head_re.search(line, pos)
                if not m:
                    break
                head = m.group(0)
                base = CANONICAL if head == CANONICAL else consts[head[2:-1]]
                tail = TAIL_RE.match(line, m.end()).group(0)
                pos = m.end() + len(tail)
                url = (base + re.sub(INTERPOLATION, WILDCARD, tail)).rstrip(".")
                (patterns if WILDCARD in url else full)[url].append(f"{rel}:{lineno}")
    return full, patterns, "\n".join(corpus)


def scan_ig():
    """(IG が定義する URL → (種別, Id, 場所), IG の入力に書かれた URL の集合) を返す。"""
    defined = {}
    literal = set()
    sources = [IG / "sushi-config.yaml"] + sorted((IG / "input").rglob("*"))
    for path in sources:
        if not path.is_file() or path.suffix not in {".fsh", ".md", ".json", ".xml", ".yaml"}:
            continue
        text = path.read_text(encoding="utf-8")
        literal.update(u.rstrip(".") for u in URL_RE.findall(text))
        if path.suffix != ".fsh":
            continue
        rel = path.relative_to(IG).as_posix()
        kind = name = None
        decl_line = 0
        has_id = False

        def flush():
            # Id: を書かない定義は SUSHI が Name を id にする
            if kind in KIND_PATH and not has_id:
                defined[f"{CANONICAL}/{KIND_PATH[kind]}/{name}"] = (kind, name, rel, decl_line)

        for lineno, line in enumerate(text.splitlines(), 1):
            m = DECL_RE.match(line)
            if m:
                flush()
                kind, name, decl_line, has_id = m.group(1), m.group(2), lineno, False
                continue
            m = ID_RE.match(line)
            if m and kind in KIND_PATH:
                has_id = True
                defined[f"{CANONICAL}/{KIND_PATH[kind]}/{m.group(1)}"] = (kind, m.group(1), rel, decl_line)
        flush()
    return defined, literal


def to_regex(pattern):
    return re.compile(".+".join(re.escape(part) for part in pattern.split(WILDCARD)))


def places(items):
    more = f" ほか {len(items) - 2} 箇所" if len(items) > 2 else ""
    return f"{', '.join(items[:2])}{more}"


def main():
    if not (IG / "input" / "fsh").is_dir():
        sys.exit(f"fhir-ig が見つからない: {IG}(FHIR_IG_DIR で指定する)")
    app_full, app_patterns, corpus = scan_app()
    ig_defined, ig_literal = scan_ig()
    ig_known = set(ig_defined) | ig_literal
    regexes = {p: to_regex(p) for p in app_patterns}

    def is_base(url):
        # 連結の土台(…/StructureDefinition など)はそれ自体が出力される URL ではない
        if url == CANONICAL or url.endswith("/"):
            return True
        prefix = url + "/"
        return any(u.startswith(prefix) for u in ig_known) or any(u.startswith(prefix) for u in app_full)

    missing = sorted(u for u in app_full if u not in ig_known and not is_base(u))
    print(f"A. アプリにあって IG に無い URL: {len(missing)} 件")
    for url in missing:
        print(f"  {url}\n      {places(app_full[url])}")

    stale = []
    for url, (kind, ident, rel, line) in sorted(ig_defined.items()):
        if kind not in ("Extension", "CodeSystem") or rel in IG_CODE_ONLY_FILES:
            continue
        if url in app_full or any(r.fullmatch(url) for r in regexes.values()):
            continue
        # valueCode の拡張に束縛するための CodeSystem(拡張と同じ Id)。拡張が使われていれば生きている
        if kind == "CodeSystem" and f"{CANONICAL}/StructureDefinition/{ident}" in app_full:
            continue
        stale.append((kind, url, f"{rel}:{line}"))
    print(f"\nB. IG が定義するがアプリのコードに出てこない Extension / CodeSystem: {len(stale)} 件")
    for kind, url, place in stale:
        print(f"  [{kind}] {url}\n      {place}")

    unmatched = sorted(p for p, r in regexes.items() if not any(r.fullmatch(u) for u in ig_known))
    print(f"\nC. 実行時に組み立てる URL で IG に対応が見当たらないもの(手で確認): {len(unmatched)} 件")
    for pattern in unmatched:
        print(f"  {pattern.replace(WILDCARD, '<実行時の値>')}\n      {places(app_patterns[pattern])}")

    print(
        f"\nアプリの URL {len(app_full)} 種 + 組み立て {len(app_patterns)} 種 / "
        f"IG の定義 {len(ig_defined)} 件(Extension・Profile・CodeSystem・ValueSet)"
    )


if __name__ == "__main__":
    main()
