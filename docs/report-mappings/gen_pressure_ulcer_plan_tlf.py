import json
# 褥瘡対策に関する診療計画書(別紙3 相当、A4 縦)の .tlf とマッピング定義を生成する。
#   python3 gen_pressure_ulcer_plan_tlf.py  → pressure-ulcer-plan-01.tlf / pressure-ulcer-plan-01.mapping.json
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

L, R = 40.0, 555.0
items = [text(L, 28, 60, 11, "別紙3", 8), text(L, 40, R - L, 20, "褥瘡対策に関する診療計画書", 15, "center")]
rules = []

def marks(link_id, options, x, y, h, gap):
    """選択肢を □ ラベル の並びで置き、選んだものだけ ■ を出す。"""
    for i, (code, label) in enumerate(options):
        xx = x + i * gap
        mark = f"mark_{link_id}_{code}"
        items.extend([text(xx, y, 11, h, "□", 9.5), text(xx, y, 11, h, "■", 9.5, id=mark, display=False),
                      text(xx + 11, y, gap - 12, h, label, 8.5)])
        rules.append({"linkId": link_id, "code": code, "show": [mark]})

def field(label, id, x, y, label_w, w):
    items.extend([text(x, y, label_w, 14, label, 8), block(id, x + label_w, y + 2, w, 12), line(x + label_w, y + 15, x + label_w + w, y + 15)])

# ---- 患者・記入者 ----
y = 70.0
items += [text(L, y, 40, 14, "氏　名"), block("pt_name", L + 40, y + 1, 150, 12, 10), text(L + 190, y, 20, 14, "殿"),
          line(L + 40, y + 15, L + 205, y + 15),
          text(L + 215, y, 26, 14, "性別", 8), block("pt_gender", L + 241, y + 2, 25, 12)]
field("病棟", "ward", L + 275, y, 30, 80)
field("計画作成日", "qr_authored", L + 395, y, 48, 72)
y += 20
items += [text(L, y, 40, 14, "生年月日", 8), block("pt_birthdate", L + 40, y + 2, 75, 12),
          text(L + 115, y, 10, 14, "("), block("pt_age", L + 125, y + 2, 22, 12), text(L + 147, y, 20, 14, "歳)", 8)]
field("記入医師名", "physician", L + 215, y, 48, 100)
field("記入看護師名", "nurse", L + 375, y, 56, 84)
y += 26

# ---- 褥瘡の有無 ----
X1 = L + 70
top = y
items.append(text(L + 4, y, X1 - L - 8, 36, "褥瘡の有無", 8.5))
for i, (key, label, site, other, onset) in enumerate([
        ("pu_present", "現在", "pu_current_site", "pu_current_site_other", True),
        ("pu_past", "過去", "pu_past_site", "pu_past_site_other", False)]):
    yy = y + i * 18
    items.append(text(X1 + 4, yy, 26, 18, label, 8.5))
    marks(key, [("0", "なし"), ("1", "あり")], X1 + 30, yy, 18, 34)
    items += [text(X1 + 102, yy, 26, 18, "部位", 8), block(site, X1 + 128, yy + 4, 130, 12, 8),
              block(other, X1 + 260, yy + 4, 60, 12, 8)]
    if onset:
        items += [text(X1 + 325, yy, 46, 18, "褥瘡発生日", 8), block("pu_onset_date", X1 + 371, yy + 4, R - X1 - 373, 12)]
    if i == 0:
        items.append(line(X1, yy + 18, R, yy + 18))
y += 36
items += [line(L, top, R, top), line(L, y, R, y), line(L, top, L, y), line(R, top, R, y), line(X1, top, X1, y)]
y += 8

# ---- 危険因子の評価 ----
top = y
X2 = L + 190                     # 評価欄の左
X3 = R - 105                     # 対処欄の左
items += [text(L, y, X2 - L, 14, "危険因子の評価", 8.5, "center"), text(X2, y, X3 - X2, 14, "評価", 8.5, "center"),
          text(X3, y, R - X3, 14, "対処", 8.5, "center")]
y += 14
items.append(line(L, y, R, y))
risk_top = y
items.append(text(L + 4, y, X2 - L - 8, 18, "日常生活自立度", 8.5))
marks("pu_bedridden_level", [(c, c) for c in ["J1", "J2", "A1", "A2", "B1", "B2", "C1", "C2"]], X2 + 4, y, 18, 26)
y += 18
items.append(line(L, y, X3, y))
CAN = [("0", "できる"), ("1", "できない")]
NO_YES = [("0", "なし"), ("1", "あり")]
for link_id, label, options in [
        ("pu_risk_turn", "・基本的動作能力(ベッド上 自力体位変換)", CAN),
        ("pu_risk_sit", "・基本的動作能力(イス上 坐位姿勢の保持、除圧)", CAN),
        ("pu_risk_bone", "・病的骨突出", NO_YES),
        ("pu_risk_contracture", "・関節拘縮", NO_YES),
        ("pu_risk_nutrition", "・栄養状態低下", NO_YES),
        ("pu_risk_moisture", "・皮膚湿潤(多汗、尿失禁、便失禁)", NO_YES),
        ("pu_risk_edema", "・皮膚の脆弱性(浮腫)", NO_YES),
        ("pu_risk_skintear", "・皮膚の脆弱性(スキン-テアの保有、既往)", NO_YES)]:
    items.append(text(L + 4, y, X2 - L - 8, 16, label, 7.5))
    marks(link_id, options, X2 + 4, y, 16, 60)
    y += 16
    items.append(line(L, y, X3, y))
items += [text(X3 + 4, risk_top + 4 + i * 11, R - X3 - 8, 11, s, 7.5)
          for i, s in enumerate(["「あり」もしくは", "「できない」が1つ以上の", "場合、看護計画を立案し", "実施する"])]
items += [
text(X3 + 4, risk_top + 70, 50, 14, "該当する因子", 7.5), block("pu_count", X3 + 54, risk_top + 72, R - X3 - 58, 12),
          text(X3 + 4, risk_top + 88, 50, 14, "看護計画", 7.5), block("pu_plan", X3 + 54, risk_top + 90, R - X3 - 58, 12)]
items += [line(L, top, R, top), line(L, y, R, y), line(L, top, L, y), line(R, top, R, y), line(X2, top, X2, y),
          line(X3, top, X3, y)]
y += 8

# ---- 褥瘡の状態の評価(DESIGN-R2020) ----
top = y
items.append(text(L, y, R - L, 14, "褥瘡の状態の評価(DESIGN-R2020)", 8.5, "center"))
y += 14
items.append(line(L, y, R, y))
X4 = L + 130
for link_id, label in [("designr_d", "深さ"), ("designr_e", "滲出液"), ("designr_s", "大きさ(cm²)"),
                       ("designr_i", "炎症/感染"), ("designr_g", "肉芽組織"), ("designr_n", "壊死組織"),
                       ("designr_p", "ポケット(cm²)"), ("designr_total", "合計点(深さを除く)")]:
    items += [text(L + 4, y, X4 - L - 8, 14, label, 8), block(link_id, X4 + 4, y + 2, R - X4 - 8, 11, 8)]
    y += 14
    items.append(line(L, y, R, y))
items += [line(L, top, R, top), line(L, top, L, y), line(R, top, R, y), line(X4, top + 14, X4, y)]
y += 8

# ---- 看護計画 ----
top = y
X5 = L + 150
items += [text(L, y, X5 - L, 14, "留意する項目", 8.5, "center"), text(X5, y, R - X5, 14, "計画の内容", 8.5, "center")]
y += 14
items.append(line(L, y, R, y))
plan_top = y
SUB = L + 22
for link_id, label, height in [
        ("care_pressure_bed", "ベッド上", 40), ("care_pressure_chair", "イス上", 40)]:
    items += [text(SUB + 4, y, X5 - SUB - 8, height, label, 8), block(link_id, X5 + 4, y + 3, R - X5 - 8, height - 6, 8.5, True)]
    y += height
    items.append(line(SUB if link_id == "care_pressure_bed" else L, y, R, y))
items.append(text(L, plan_top, 22, y - plan_top, "\n".join("圧迫ズレ力の排除"), 7, "center"))
items.append(line(SUB, plan_top, SUB, y))
for link_id, label, height in [("care_skin", "スキンケア", 36), ("care_nutrition", "栄養状態改善", 36),
                               ("care_rehab", "リハビリテーション", 36)]:
    items += [text(L + 4, y, X5 - L - 8, height, label, 8), block(link_id, X5 + 4, y + 3, R - X5 - 8, height - 6, 8.5, True)]
    y += height
    items.append(line(L, y, R, y))
items += [line(L, top, R, top), line(L, top, L, y), line(R, top, R, y), line(X5, top, X5, y)]
y += 8

# ---- 評価 ----
top = y
items += [text(L + 4, y, X5 - L - 8, 18, "評価の予定日", 8), block("reassess_date", X5 + 4, y + 4, 120, 12)]
y += 18
items.append(line(L, y, R, y))
items += [text(L + 4, y, X5 - L - 8, 44, "評価", 8), block("evaluation", X5 + 4, y + 3, R - X5 - 8, 38, 8.5, True)]
y += 44
items += [line(L, top, R, top), line(L, y, R, y), line(L, top, L, y), line(R, top, R, y), line(X5, top, X5, y)]
bottom = y

# 縦書きの見出しは text の改行で出す(texts を 1 行ずつに分ける)。
for item in items:
    if item["type"] == "text" and "\n" in item["texts"][0]:
        item["texts"] = item["texts"][0].split("\n")

layout = {"version": "0.11.0", "title": "褥瘡対策に関する診療計画書",
          "report": {"paper-type": "A4", "orientation": "portrait", "margin": [0, 0, 0, 0]},
          "state": {"layout-guides": []}, "items": items}
json.dump(layout, open("pressure-ulcer-plan-01.tlf", "w"), ensure_ascii=False, indent=2)
json.dump(rules, open("pressure-ulcer-plan-01.mapping.json", "w"), ensure_ascii=False, indent=2)
print("bottom", bottom)
