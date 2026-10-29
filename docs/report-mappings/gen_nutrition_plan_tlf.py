import json
# 栄養管理計画書(別紙23 相当、A4 縦)の .tlf とマッピング定義を生成する。
#   python3 gen_nutrition_plan_tlf.py  → nutrition-plan-01.tlf / nutrition-plan-01.mapping.json
# text-block の id はテンプレートの linkId(ItemIdMapper の規約でそのまま通る)。
# □ の上に同じ位置・大きさの ■ を display: false で重ね、マッピングの show で選んだ側だけ出す。
FONT = ["IPAMincho"]

def text(x, y, w, h, s, size=9, align="left", valign="middle", id="", display=True):
    return {"id": id, "type": "text", "display": display, "description": "", "x": x, "y": y, "width": w, "height": h,
            "texts": [s], "style": {"font-family": FONT, "font-size": size, "font-style": [], "color": "#000000",
                                    "text-align": align, "vertical-align": valign, "letter-spacing": "",
                                    "line-height": "", "line-height-ratio": ""}}

def block(id, x, y, w, h, size=9, multi=False):
    return {"id": id, "type": "text-block", "display": True, "description": "", "x": x, "y": y, "width": w, "height": h,
            "value": "", "multiple-line": multi, "format": {"base": "", "type": ""},
            "style": {"font-family": FONT, "font-size": size, "font-style": [], "color": "#000000", "text-align": "left",
                      "vertical-align": "top", "letter-spacing": "", "line-height": "12" if multi else "",
                      "line-height-ratio": "", "overflow": "truncate", "word-wrap": "break-word" if multi else "none"}}

def line(x1, y1, x2, y2):
    return {"id": "", "type": "line", "display": True, "description": "", "x1": x1, "y1": y1, "x2": x2, "y2": y2,
            "style": {"border-color": "#000000", "border-width": 0.5, "border-style": "solid"}}

L, R = 40.0, 555.0          # 表の左右
X1 = 175.0                  # 項目名と記入欄の仕切り
items = [text(L, 28, 60, 11, "別紙23", 8), text(L, 40, R - L, 20, "栄養管理計画書", 15, "center")]
rules = []

# ---- 患者・担当者 ----
y = 70.0
items += [text(L, y, 50, 10, "フリガナ", 7), block("pt_kana", L + 50, y, 200, 10, 7),
          text(L, y + 12, 50, 14, "氏　名"), block("pt_name", L + 50, y + 13, 190, 12, 10), text(L + 240, y + 12, 20, 14, "殿"),
          line(L + 50, y + 27, L + 260, y + 27),
          text(L + 280, y + 12, 30, 14, "性別"), block("pt_gender", L + 310, y + 13, 30, 12),
          text(L + 350, y + 12, 50, 14, "生年月日"), block("pt_birthdate", L + 400, y + 13, 70, 12),
          block("pt_age", L + 470, y + 13, 25, 12), text(L + 495, y + 12, 20, 14, "歳")]
y += 34
for i, (label, id) in enumerate([("病棟", "ward"), ("担当医師名", "attending"), ("担当管理栄養士名", "dietitian")]):
    x = L + i * 175
    items += [text(x, y, 80, 14, label, 8), block(id, x + 80, y + 2, 92, 12), line(x + 80, y + 15, x + 172, y + 15)]
y += 20
items += [text(L, y, 80, 14, "入院日", 8), block("admission_date", L + 80, y + 2, 92, 12), line(L + 80, y + 15, L + 172, y + 15),
          text(L + 175, y, 80, 14, "計画作成日", 8), block("qr_authored", L + 255, y + 2, 100, 12), line(L + 255, y + 15, L + 355, y + 15)]
y += 26

# ---- 表 ----
top = y
def row(label, id, height, label_size=8.5):
    global y
    items.append(text(L + 4, y, X1 - L - 8, height, label, label_size))
    items.append(block(id, X1 + 4, y + 3, R - X1 - 8, height - 6, 9, True))
    y += height
    items.append(line(L, y, R, y))

row("入院時栄養状態に関するリスク", "risk", 70)
row("栄養状態の評価と課題", "assessment", 70)

# 栄養管理計画(左に縦の見出し欄)
plan_top = y
SUB = L + 22                       # 見出し欄の右端
def subrow(label, id, height):
    global y
    items.append(text(SUB + 4, y, X1 - SUB - 8, height, label, 8.5))
    items.append(block(id, X1 + 4, y + 3, R - X1 - 8, height - 6, 9, True))
    y += height
    items.append(line(SUB, y, R, y))

subrow("目標", "goal", 48)
# 栄養補給量
items.append(text(SUB + 4, y, X1 - SUB - 8, 34, "栄養補給量", 8.5))
half = (R - X1) / 2
for i, (label, id) in enumerate([("エネルギー", "energy"), ("たんぱく質", "protein"), ("水分", "water"), ("その他", "supply_other")]):
    x = X1 + 4 + (i % 2) * half
    yy = y + 3 + (i // 2) * 15
    items += [text(x, yy, 52, 13, "・" + label, 8.5), block(id, x + 54, yy + 1, half - 62, 12)]
y += 34
items.append(line(SUB, y, R, y))
# 栄養補給方法
items.append(text(SUB + 4, y, X1 - SUB - 8, 18, "栄養補給方法", 8.5))
for i, (code, label) in enumerate([("oral", "経口"), ("enteral", "経腸栄養"), ("parenteral", "静脈栄養")]):
    x = X1 + 6 + i * 90
    items += [text(x, y, 12, 18, "□", 10), text(x, y, 12, 18, "■", 10, id=f"mark_route_{code}", display=False),
              text(x + 13, y, 70, 18, label, 9)]
    rules.append({"linkId": "supply_route", "code": code, "show": [f"mark_route_{code}"]})
y += 18
items.append(line(SUB, y, R, y))
subrow("食事内容", "meal_content", 34)
subrow("留意事項", "supply_note", 34)
# 栄養食事相談
for key, label in [("counsel_admission", "入院時栄養食事指導の必要性"), ("counsel_inpatient", "栄養食事相談の必要性"),
                   ("counsel_discharge", "退院時の指導の必要性")]:
    items.append(text(SUB + 4, y, X1 - SUB - 8, 30, label, 8))
    for i, (code, mark) in enumerate([("01", "なし"), ("02", "あり")]):
        x = X1 + 6 + i * 50
        items += [text(x, y + 1, 12, 14, "□", 10), text(x, y + 1, 12, 14, "■", 10, id=f"mark_{key}_{code}", display=False),
                  text(x + 13, y + 1, 30, 14, mark, 9)]
        rules.append({"linkId": key, "code": code, "show": [f"mark_{key}_{code}"]})
    items += [text(X1 + 110, y + 1, 30, 14, "内容", 8), block(f"{key}_detail", X1 + 140, y + 2, R - X1 - 145, 12),
              text(X1 + 110, y + 15, 50, 14, "実施予定日", 8), block(f"{key}_date", X1 + 160, y + 16, 90, 12)]
    y += 30
    items.append(line(SUB, y, R, y))
subrow("備考", "counsel_note", 30)
# 見出し欄(縦書き)と縦線。サブ見出しの区切りは見出し欄の右から引いている。
items.append(text(L, plan_top, 22, y - plan_top, "\n".join("栄養管理計画"), 9, "center"))
items.append(line(SUB, plan_top, SUB, y))
items.append(line(L, y, R, y))
row("その他栄養管理上解決すべき課題に関する事項", "other_issues", 56, 8)
# 再評価の時期
items += [text(L + 4, y, X1 - L - 8, 20, "栄養状態の再評価の時期", 8.5),
          text(X1 + 6, y, 60, 20, "実施予定日", 8.5), block("reassess_date", X1 + 66, y + 4, 120, 12)]
y += 20
items.append(line(L, y, R, y))
row("退院時及び終了時の総合的評価", "discharge_evaluation", 70)
bottom = y

# 外枠・仕切り
items += [line(L, top, R, top), line(L, top, L, bottom), line(R, top, R, bottom), line(X1, top, X1, bottom)]
# 見出し欄の縦書きは text の改行で出す(texts を 1 行ずつに分ける)。
for item in items:
    if item["type"] == "text" and "\n" in item["texts"][0]:
        item["texts"] = item["texts"][0].split("\n")

layout = {"version": "0.11.0", "title": "栄養管理計画書",
          "report": {"paper-type": "A4", "orientation": "portrait", "margin": [0, 0, 0, 0]},
          "state": {"layout-guides": []}, "items": items}
json.dump(layout, open("nutrition-plan-01.tlf", "w"), ensure_ascii=False, indent=2)
json.dump(rules, open("nutrition-plan-01.mapping.json", "w"), ensure_ascii=False, indent=2)
print("bottom", bottom)
