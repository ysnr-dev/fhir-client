#!/usr/bin/env python3
"""部門名だけが違うファイルどうしを、部門名を正規化してから比べる(「名前だけ違う同形」の近さを測る)。

  scripts/compare-departments.py <fileA> <fileB> [--diff]
  scripts/compare-departments.py --pairs <glob の元になるファイル> ...   例: --pairs frontend/src/fhir/physioOrderHelpers.ts

- 2 ファイル指定: 正規化後の差分行数と、両者の行数を出す。--diff で差分そのものも出す。
- --pairs: 指定ファイルの名前に含まれる部門名を他の部門に置き換えた相手ファイルを探し、
  見つかったものすべてと比べて一覧にする(physioOrderHelpers.ts → endoscopy/rad/treatment/... OrderHelpers.ts)。

部門名は英語(識別子・CSS クラス)と日本語(表示文言・コメント)の両方を DEPT / 部門 に置き換える。
差分 0 行なら丸ごと同じ、数十行なら設定で差を表せる見込み、数百行なら別物。
"""
import difflib
import os
import re
import sys

# (英語の語幹, 日本語名). 英語は小文字・先頭大文字・全部大文字の 3 形を置き換える。
DEPARTMENTS = [
    ("radiotherapy", "放射線治療"),  # rad より先(前方一致を避ける)
    ("rad", "放射線"),
    ("physio", "生理検査"),
    ("physio", "生理"),
    ("endoscopy", "内視鏡"),
    ("patho", "病理"),
    ("micro", "細菌検査"),
    ("micro", "細菌"),
    ("treatment", "処置"),
    ("surgery", "手術"),
    ("rehab", "リハビリ"),
    ("transfusion", "輸血"),
    ("meal", "食事"),
    ("nursing", "看護"),
    ("consult", "他科依頼"),
    ("nutrition", "栄養指導"),
    ("lab", "検体検査"),
    ("lab", "検体"),
    ("injection", "注射"),
    ("prescription", "処方"),
]


def normalize(text):
    for en, ja in DEPARTMENTS:
        text = text.replace(ja, "部門")
        text = re.sub(r"(?<![A-Za-z])" + en + r"(?![a-z])", "DEPT", text)
        text = re.sub(r"(?<![A-Za-z])" + en.capitalize() + r"(?![a-z])", "Dept", text)
        text = re.sub(r"(?<![A-Za-z])" + en.upper() + r"(?![A-Z])", "DEPT", text)
        # camelCase の途中(buildRadTaskUpdate)
        text = re.sub(r"(?<=[a-z])" + en.capitalize() + r"(?=[A-Z_]|$)", "Dept", text)
    return text


def lines_of(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        return [normalize(l.rstrip("\n")) for l in fh]


def compare(a, b, show_diff=False):
    la, lb = lines_of(a), lines_of(b)
    diff = list(difflib.unified_diff(la, lb, fromfile=a, tofile=b, lineterm="", n=0))
    changed = sum(1 for l in diff if (l.startswith("+") or l.startswith("-")) and not l.startswith(("+++", "---")))
    print(f"{changed:5d} 行の差  {a} ({len(la)} 行)  ⇔  {b} ({len(lb)} 行)")
    if show_diff:
        print("\n".join(diff))
    return changed


args = sys.argv[1:]
if not args:
    print(__doc__)
    sys.exit(1)

if args[0] == "--pairs":
    for src in args[1:]:
        d, name = os.path.split(src)
        seen = set()
        for en, _ in DEPARTMENTS:
            for form in (en, en.capitalize(), en.upper()):
                if form not in name:
                    continue
                for other, _ in DEPARTMENTS:
                    if other == en:
                        continue
                    alt = {en: other, en.capitalize(): other.capitalize(), en.upper(): other.upper()}[form]
                    cand = os.path.join(d, name.replace(form, alt))
                    if os.path.exists(cand) and cand != src and cand not in seen:
                        seen.add(cand)
                        compare(src, cand)
        if not seen:
            print(f"      相手が見つからない  {src}")
else:
    show = "--diff" in args
    files = [a for a in args if a != "--diff"]
    if len(files) != 2:
        print("2 ファイルを指定する", file=sys.stderr)
        sys.exit(1)
    compare(files[0], files[1], show)
