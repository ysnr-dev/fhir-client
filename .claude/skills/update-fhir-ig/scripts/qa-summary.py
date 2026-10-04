#!/usr/bin/env python3
"""fhir-ig の output/qa.json・qa.txt から QA の件数とエラー行を出し、ビルド前後を比べる。

使い方:
  qa-summary.py                 件数とエラー行を表示
  qa-summary.py --save FILE     表示に加えて、比較用のスナップショットを FILE に保存(ビルド前に実行)
  qa-summary.py --compare FILE  スナップショットと比べ、増えた・消えたエラーと警告を表示(ビルド後に実行)

FHIR_IG_DIR で fhir-ig の場所を変えられる(既定はリポジトリの隣の ../fhir-ig)。
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(
    subprocess.check_output(
        ["git", "-C", str(Path(__file__).resolve().parent), "rev-parse", "--show-toplevel"], text=True
    ).strip()
)
IG = Path(os.environ.get("FHIR_IG_DIR", ROOT.parent / "fhir-ig"))
MAX_WARNINGS_SHOWN = 40


def load():
    qa_json = IG / "output" / "qa.json"
    qa_txt = IG / "output" / "qa.txt"
    if not qa_json.is_file() or not qa_txt.is_file():
        return None
    meta = json.loads(qa_json.read_text(encoding="utf-8"))
    errors, warnings = set(), set()
    for line in qa_txt.read_text(encoding="utf-8").splitlines():
        if line.startswith("ERROR: "):
            errors.add(line[len("ERROR: "):].strip())
        elif line.startswith("WARNING: "):
            # テンプレート由来の警告は「WARNING: 3: ...」と通し番号が付く(順序で変わるので落とす)
            warnings.add(re.sub(r"^\d+: ", "", line[len("WARNING: "):].strip()))
    return {
        "date": meta.get("dateISO8601"),
        "errs": meta.get("errs"),
        "warnings": meta.get("warnings"),
        "hints": meta.get("hints"),
        "error_lines": sorted(errors),
        "warning_lines": sorted(warnings),
    }


def short(line, width=260):
    return line if len(line) <= width else line[:width] + " …"


def show(snapshot):
    print(f"ビルド日時: {snapshot['date']}")
    print(f"Errors {snapshot['errs']} / Warnings {snapshot['warnings']} / Hints {snapshot['hints']}")
    print(f"\nエラー行({len(snapshot['error_lines'])} 種):")
    for line in snapshot["error_lines"]:
        print(f"  {short(line)}")


def compare(before, after):
    print(f"\n== 前回({before['date']})との比較 ==")
    for key, label in (("errs", "Errors"), ("warnings", "Warnings"), ("hints", "Hints")):
        delta = (after[key] or 0) - (before[key] or 0)
        print(f"{label}: {before[key]} → {after[key]} ({delta:+d})")

    for key, label in (("error_lines", "エラー"), ("warning_lines", "警告")):
        old, new = set(before[key]), set(after[key])
        added, removed = sorted(new - old), sorted(old - new)
        print(f"\n増えた{label}: {len(added)} 件")
        for line in added[:MAX_WARNINGS_SHOWN]:
            print(f"  + {short(line)}")
        if len(added) > MAX_WARNINGS_SHOWN:
            print(f"  …ほか {len(added) - MAX_WARNINGS_SHOWN} 件(output/qa.html で確認)")
        print(f"消えた{label}: {len(removed)} 件")
        if key == "error_lines":
            for line in removed:
                print(f"  - {short(line)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--save", metavar="FILE")
    parser.add_argument("--compare", metavar="FILE")
    args = parser.parse_args()

    snapshot = load()
    if snapshot is None:
        sys.exit(f"{IG}/output に qa.json / qa.txt が無い(まだビルドしていない)")
    show(snapshot)
    if args.save:
        Path(args.save).write_text(json.dumps(snapshot, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\nスナップショットを保存: {args.save}")
    if args.compare:
        compare(json.loads(Path(args.compare).read_text(encoding="utf-8")), snapshot)


if __name__ == "__main__":
    main()
