import base64, json, os, subprocess, sys, tempfile
# 主治医意見書(介護保険)の様式テンプレートのエクスポートファイルを生成する。
# 紙面は HTML で組み、Chrome のヘッドレスで A4 150dpi(1240x1754px)の PNG を 2 ページ作る。
# 文字・□・入力欄は同じ座標計算(Flow)で置くので、チェック項目は必ず□の上に乗る。
# 使い方: python3 gen_care_opinion_form.py [出力先 JSON](既定 care-opinion-form-01.json)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
W, H = 1240, 1754
L, R = 70, 1170           # 枠の左右
IN = 84                   # 枠内の文字の左端
FS = 16                   # 本文の文字サイズ(px)
RH = 28                   # 1 行の高さ(px)
BOX = 15                  # □の一辺(px)
FIELD_PT = 9.5            # 入力値の文字サイズ(pt)
KANJI_NAME = "%patient.name.where(extension.where(value = 'SYL').empty()).select(family + ' ' + given.first()).first()"
KANA_NAME = "%patient.name.where(extension.value = 'SYL').select(family + ' ' + given.first()).first()"

pages = {1: [], 2: []}
fields = []
page = 1


def html(s):
    pages[page].append(s)


def tw(s, size=FS):
    # 明朝の全角は 1 字 = 文字サイズ、半角は少し広めに見積もる(重なるより空く方を選ぶ)。
    return round(sum(size if ord(c) > 0x7F else size * 0.6 for c in s))


def text(x, y, s, size=FS, bold=False, align="left", w=None):
    style = f"left:{x}px;top:{y}px;font-size:{size}px;font-weight:{'bold' if bold else 'normal'};text-align:{align};"
    if w is not None:
        style += f"width:{w}px;"
    html(f'<div class="t" style="{style}">{s}</div>')


def hline(x1, x2, y, width=2):
    html(f'<div class="l" style="left:{x1}px;top:{y - width // 2}px;width:{x2 - x1}px;height:{width}px"></div>')


def vline(x, y1, y2, width=2):
    html(f'<div class="l" style="left:{x - width // 2}px;top:{y1}px;width:{width}px;height:{y2 - y1}px"></div>')


def rect(x1, y1, x2, y2, width=2):
    hline(x1, x2, y1, width); hline(x1, x2, y2, width); vline(x1, y1, y2, width); vline(x2, y1, y2, width)


def field(id, type, label, x, y, w, h, font_size=FIELD_PT, **extra):
    assert not any(f["id"] == id for f in fields), f"id が重複: {id}"
    f = {"id": id, "type": type, "label": label, "page": page, "x": round(x), "y": round(y), "w": round(w), "h": round(h),
         "font_size": font_size, "align": extra.pop("align", "left"), "required": extra.pop("required", False)}
    if type in ("text", "textarea"):
        f["initial_expression"] = extra.pop("initial_expression", "")
        f["transfer_kinds"] = extra.pop("transfer_kinds", [])
    elif type == "date":
        f["initial_expression"] = extra.pop("initial_expression", "")
        f["date_format"] = extra.pop("date_format", "wareki")
    f.update(extra)
    assert f["x"] + f["w"] <= W and f["y"] + f["h"] <= H, f"ページからはみ出す: {id}"
    fields.append(f)


class Flow:
    """1 行ずつ左から並べる。幅が足りなければ wrap の位置で折り返す。"""

    def __init__(self, y, x=IN, wrap=None, size=FS):
        self.x, self.y, self.size = x, y, size
        self.wrap = x if wrap is None else wrap

    def _fit(self, width):
        if self.x + width > R - 12:
            self.x = self.wrap
            self.y += RH
        assert self.x + width <= R - 12, "1 行に収まらない"

    def t(self, s, bold=False):
        self._fit(tw(s, self.size))
        text(self.x, self.y, s, self.size, bold)
        self.x += tw(s, self.size)
        return self

    def gap(self, px):
        self.x += px
        return self

    def cb(self, id, label, caption=None, after=12):
        width = BOX + 4 + (tw(caption, self.size) if caption else 0)
        self._fit(width)
        top = self.y + (self.size * 1.3 - BOX) / 2
        html(f'<div class="b" style="left:{self.x}px;top:{top:.1f}px;width:{BOX}px;height:{BOX}px"></div>')
        field(id, "checkbox", label, self.x - 5, top - 5, BOX + 10, BOX + 10, 10, align="center")
        self.x += BOX + 4
        if caption:
            text(self.x, self.y, caption, self.size)
            self.x += tw(caption, self.size)
        self.x += after
        return self

    def tx(self, id, label, w, under=True, **extra):
        if w is None:
            w = R - 12 - self.x
        self._fit(w)
        if under:
            hline(self.x, self.x + w, self.y + 24, 1)
        field(id, extra.pop("type", "text"), label, self.x + 2, self.y - 5, w - 4, 29, **extra)
        self.x += w
        return self

    def nl(self, x=IN):
        self.x = self.wrap = x
        self.y += RH
        return self


def degree(f, id, label):
    f.t("程度：")
    for code, name in (("mild", "軽"), ("moderate", "中"), ("severe", "重")):
        f.cb(f"{id}_{code}", f"{label}（程度：{name}）", name, after=6)


def part_and_degree(y, id, label):
    """□○○（部位：＿ 程度：□軽 □中 □重）の 1 行。"""
    f = Flow(y, IN + 24)
    f.cb(id, label, label, after=4).gap(max(0, 150 - tw(label))).t("（部位：")
    f.tx(f"{id}_site", f"{label}（部位）", 330)
    f.gap(16)
    degree(f, id, label)
    f.t("）")
    return f.nl().y


def section(y, title):
    hline(L, R, y)
    text(IN, y + 6, title, 17, True)
    return y + 6 + RH + 2


# ================= 1 ページ目 =================
text(0, 34, "主　治　医　意　見　書", 30, True, "center", W)
text(850, 52, "記入日", FS)
field("f_written_date", "date", "記入日", 920, 44, 250, 32, 10.5, align="right", initial_expression="%today")

# ---- 申請者 ----
T = [96, 130, 176, 212]
C1, C2, C3 = 170, 650, 740
rect(L, T[0], R, T[-1])
vline(C1, T[0], T[-1]); vline(C2, T[0], T[-1]); vline(C3, T[0], T[-1])
hline(C1, C2, T[1], 1)
hline(L, C3, T[2], 1)
hline(C3, R, T[1], 1); hline(C3, R, T[2], 1)
text(C1 + 8, T[0] + 9, "（ふりがな）", 14)
field("f_pt_kana", "text", "申請者（ふりがな）", C1 + 100, T[0] + 3, C2 - C1 - 110, 28, 9, initial_expression=KANA_NAME)
text(L, (T[0] + T[2]) // 2 - 11, "申請者", FS, align="center", w=C1 - L)
field("f_pt_name", "text", "申請者氏名", C1 + 10, T[1] + 6, C2 - C1 - 20, T[2] - T[1] - 12, 12, initial_expression=KANJI_NAME)
sx = Flow(T[0] + 18, C2 + 22)
sx.cb("f_pt_male", "性別：男", "男")
sx = Flow(T[1] + 20, C2 + 22)
sx.cb("f_pt_female", "性別：女", "女")
text(L, T[2] + 8, "生年月日", FS, align="center", w=C1 - L)
field("f_pt_birth", "date", "生年月日", C1 + 10, T[2] + 4, 300, 28, initial_expression="%patient.birthDate")
text(C1 + 330, T[2] + 8, "生　（", FS)
field("f_pt_age", "text", "年齢", C1 + 380, T[2] + 4, 70, 28, align="right", initial_expression="%age")
text(C1 + 456, T[2] + 8, "歳）", FS)
text(C3 + 10, T[0] + 8, "〒", FS)
field("f_pt_postal", "text", "申請者郵便番号", C3 + 34, T[0] + 3, 200, 28, initial_expression="%patient.address.first().postalCode")
field("f_pt_address", "text", "申請者住所", C3 + 10, T[1] + 6, R - C3 - 20, T[2] - T[1] - 12,
      initial_expression="%patient.address.first().text")
text(C3 + 10, T[2] + 8, "連絡先", FS)
field("f_pt_phone", "text", "申請者連絡先", C3 + 70, T[2] + 4, R - C3 - 80, 28,
      initial_expression="%patient.telecom.where(system = 'phone').value.first()")

# ---- 意見の宛先・医師 ----
text(L, 224, "上記の申請者に関する意見は以下の通りです。", FS)
f = Flow(252, L)
f.t("主治医として、本意見書が介護サービス計画作成等に利用されることに").gap(14)
f.cb("f_consent_yes", "介護サービス計画作成等への利用：同意する", "同意する。", after=18)
f.cb("f_consent_no", "介護サービス計画作成等への利用：同意しない", "同意しない。")

DX = 220
for y, label, id, expr, right in (
    (288, "医師氏名", "f_doctor", "%authorName", None),
    (320, "医療機関名", "f_facility", "%facilityName", ("電話", "f_facility_phone", "%facilityPhone")),
    (352, "医療機関所在地", "f_facility_address", "%facilityAddress", ("ＦＡＸ", "f_facility_fax", "%facilityFax")),
):
    text(L, y, label, FS)
    hline(DX, 760, y + 24, 1)
    field(id, "text", label, DX + 2, y - 5, 760 - DX - 4, 29, 10.5 if id == "f_doctor" else FIELD_PT, initial_expression=expr)
    if right:
        rl, rid, rexpr = right
        text(800, y, rl, FS)
        hline(870, R, y + 24, 1)
        field(rid, "text", f"医療機関{rl}", 872, y - 5, R - 874, 29, initial_expression=rexpr)

# ---- 枠の中 ----
TOP = 394
y = TOP + 8
f = Flow(y)
f.t("（１）最終診察日").gap(8)
f.tx("f_last_visit", "最終診察日", 260, type="date", initial_expression="%today")
f.gap(60).t("（２）意見書作成回数").gap(8)
f.cb("f_count_first", "意見書作成回数：初回", "初回")
f.cb("f_count_repeat", "意見書作成回数：２回目以上", "２回目以上")
f.nl()
f.t("（３）他科受診の有無").gap(8)
f.cb("f_other_yes", "他科受診：有", "有")
f.cb("f_other_no", "他科受診：無", "無", after=24)
f.t("（有の場合）→").gap(6)
f.wrap = IN + 48
for code, name in (("internal", "内科"), ("psych", "精神科"), ("surgery", "外科"), ("ortho", "整形外科"),
                   ("neuro", "脳神経外科"), ("derma", "皮膚科"), ("uro", "泌尿器科"), ("gyn", "婦人科"),
                   ("eye", "眼科"), ("ent", "耳鼻咽喉科"), ("rehab", "リハビリテーション科"), ("dental", "歯科")):
    f.cb(f"f_other_{code}", f"他科受診：{name}", name)
f.cb("f_other_etc", "他科受診：その他", "その他", after=0).t("（")
f.tx("f_other_etc_text", "他科受診（その他）", 200).t("）")
y = f.nl().y + 4

# ---- 1. 傷病に関する意見 ----
y = section(y, "１．傷病に関する意見")
text(IN, y, "（１）診断名（特定疾病または生活機能低下の直接の原因となっている傷病名については１．に記入）及び発症年月日", FS)
y += RH + 2
for i in (1, 2, 3):
    f = Flow(y, IN + 24)
    f.t(f"{'１２３'[i - 1]}．").gap(4)
    f.tx(f"f_dx{i}", f"診断名{i}", 560, transfer_kinds=["condition"])
    f.gap(20).t("発症年月日（")
    f.tx(f"f_dx{i}_onset", f"診断名{i}の発症年月日", 220).t("頃）")
    y += RH + 4
f = Flow(y)
f.t("（２）症状としての安定性").gap(8)
f.cb("f_stable", "症状としての安定性：安定", "安定")
f.cb("f_unstable", "症状としての安定性：不安定", "不安定")
f.cb("f_stable_unknown", "症状としての安定性：不明", "不明")
f.nl(IN + 48).t("（「不安定」とした場合、具体的な状況を記入）").gap(6)
f.tx("f_unstable_text", "不安定の具体的な状況", None)
y = f.nl().y
text(IN, y, "（３）生活機能低下の直接の原因となっている傷病または特定疾病の経過及び投薬内容を含む治療内容", FS)
text(IN + 48, y + RH - 4, "（最近（概ね６ヶ月以内）介護に影響のあったもの　及び　特定疾病についてはその診断の根拠等について記入）", 14)
y += RH * 2 - 2
rect(IN + 24, y, R - 12, y + 96, 1)
field("f_course", "textarea", "傷病の経過及び治療内容", IN + 30, y + 4, R - 12 - IN - 36, 88, 9,
      transfer_kinds=["prescription", "injection", "order", "condition", "lab"])
y += 96 + 10

# ---- 2. 特別な医療 ----
y = section(y, "２．特別な医療（過去１４日間以内に受けた医療のすべてにチェック）")
f = Flow(y, IN + 150)
f.x = IN + 24
f.t("処置内容").x = IN + 150
for code, name in (("drip", "点滴の管理"), ("tpn", "中心静脈栄養"), ("dialysis", "透析"), ("stoma", "ストーマの処置"),
                   ("oxygen", "酸素療法"), ("ventilator", "レスピレーター"), ("tracheostomy", "気管切開の処置"),
                   ("pain", "疼痛の看護"), ("tube", "経管栄養")):
    f.cb(f"f_sm_{code}", f"特別な医療：{name}", name, after=18)
f.nl(IN + 24).t("特別な対応").x = IN + 150
f.cb("f_sm_monitor", "特別な医療：モニター測定", "モニター測定（血圧、心拍、酸素飽和度等）", after=18)
f.cb("f_sm_pressure_ulcer", "特別な医療：褥瘡の処置", "褥瘡の処置")
f.nl(IN + 24).t("失禁への対応").x = IN + 150
f.cb("f_sm_catheter", "特別な医療：カテーテル", "カテーテル（コンドームカテーテル、留置カテーテル　等）")
y = f.nl().y + 4

# ---- 3. 心身の状態に関する意見 ----
y = section(y, "３．心身の状態に関する意見")
text(IN, y, "（１）日常生活の自立度等について", FS)
y += RH
f = Flow(y, IN + 24)
f.t("・障害高齢者の日常生活自立度（寝たきり度）").x = IN + 440
for code, name in (("independent", "自立"), ("j1", "J1"), ("j2", "J2"), ("a1", "A1"), ("a2", "A2"),
                   ("b1", "B1"), ("b2", "B2"), ("c1", "C1"), ("c2", "C2")):
    f.cb(f"f_bedridden_{code}", f"障害高齢者の日常生活自立度：{name}", name, after=14)
f.nl(IN + 24).t("・認知症高齢者の日常生活自立度").x = IN + 440
for code, name in (("independent", "自立"), ("1", "Ⅰ"), ("2a", "Ⅱa"), ("2b", "Ⅱb"), ("3a", "Ⅲa"),
                   ("3b", "Ⅲb"), ("4", "Ⅳ"), ("m", "Ｍ")):
    f.cb(f"f_dementia_{code}", f"認知症高齢者の日常生活自立度：{name}", name, after=14)
y = f.nl().y
text(IN, y, "（２）認知症の中核症状（認知症以外の疾患で同様の症状を認める場合を含む）", FS)
y += RH
for key, title, options in (
    ("memory", "短期記憶", (("ok", "問題なし"), ("ng", "問題あり"))),
    ("decision", "日常の意思決定を行うための認知能力",
     (("independent", "自立"), ("some", "いくらか困難"), ("watch", "見守りが必要"), ("unable", "判断できない"))),
    ("communication", "自分の意思の伝達能力",
     (("able", "伝えられる"), ("some", "いくらか困難"), ("limited", "具体的要求に限られる"), ("unable", "伝えられない"))),
):
    f = Flow(y, IN + 24)
    f.t(f"・{title}").x = IN + 440
    for code, name in options:
        f.cb(f"f_{key}_{code}", f"{title}：{name}", name, after=18)
    y = f.nl().y
text(IN, y, "（３）認知症の行動・心理症状(BPSD)（該当する項目全てチェック：認知症以外の疾患で同様の症状を認める場合を含む）", FS)
y += RH
f = Flow(y, IN + 24)
f.cb("f_bpsd_no", "BPSD：無", "無")
f.cb("f_bpsd_yes", "BPSD：有", "有", after=8).t("→（").gap(4)
f.wrap = f.x
for code, name in (("hallucination", "幻視・幻聴"), ("delusion", "妄想"), ("day_night", "昼夜逆転"), ("verbal", "暴言"),
                   ("violence", "暴行"), ("resistance", "介護への抵抗"), ("wandering", "徘徊"), ("fire", "火の不始末"),
                   ("unclean", "不潔行為"), ("pica", "異食行動"), ("sexual", "性的問題行動")):
    f.cb(f"f_bpsd_{code}", f"BPSD：{name}", name)
f.cb("f_bpsd_etc", "BPSD：その他", "その他", after=0).t("（")
f.tx("f_bpsd_etc_text", "BPSD（その他）", 200).t("））")
y = f.nl().y
text(IN, y, "（４）その他の精神・神経症状", FS)
f = Flow(y, IN + 260)
f.x = IN + 260
f.cb("f_neuro_no", "その他の精神・神経症状：無", "無")
f.cb("f_neuro_yes", "その他の精神・神経症状：有", "有", after=8).t("〔症状名：")
f.tx("f_neuro_text", "その他の精神・神経症状（症状名）", 240)
f.gap(12).t("専門医受診の有無").gap(10)
f.cb("f_neuro_specialist_yes", "専門医受診：有", "有", after=0).t("（")
f.tx("f_neuro_specialist_text", "専門医受診（内容）", 110).t("）").gap(8)
f.cb("f_neuro_specialist_no", "専門医受診：無", "無", after=0).t("〕")
y = f.nl().y
text(IN, y, "（５）身体の状態", FS)
y += RH
f = Flow(y, IN + 24)
f.t("利き腕（").gap(4)
f.cb("f_hand_right", "利き腕：右", "右")
f.cb("f_hand_left", "利き腕：左", "左", after=0).t("）").gap(20).t("身長＝")
f.tx("f_height", "身長", 90, align="right", initial_expression="%bodyHeight").t("cm").gap(16).t("体重＝")
f.tx("f_weight", "体重", 90, align="right", initial_expression="%bodyWeight").t("kg")
f.t("（過去６ヶ月の体重の変化").gap(6)
f.cb("f_weight_up", "過去６ヶ月の体重の変化：増加", "増加")
f.cb("f_weight_keep", "過去６ヶ月の体重の変化：維持", "維持")
f.cb("f_weight_down", "過去６ヶ月の体重の変化：減少", "減少", after=0).t("）")
y = f.nl().y
f = Flow(y, IN + 24)
f.cb("f_limb_loss", "四肢欠損", "四肢欠損", after=4).gap(150 - tw("四肢欠損")).t("（部位：")
f.tx("f_limb_loss_site", "四肢欠損（部位）", 330).t("）")
y = f.nl().y
f = Flow(y, IN + 24)
f.cb("f_paralysis", "麻痺", "麻痺", after=4).gap(150 - tw("麻痺"))
for i, (code, name) in enumerate((("ru", "右上肢"), ("lu", "左上肢"), ("rl", "右下肢"), ("ll", "左下肢"))):
    if i == 2:
        f.nl(IN + 24 + BOX + 4 + 150)
    f.cb(f"f_paralysis_{code}", f"麻痺：{name}", name, after=0).t("（")
    degree(f, f"f_paralysis_{code}", f"麻痺：{name}")
    f.t("）").gap(20)
f.nl(IN + 24 + BOX + 4 + 150)
f.cb("f_paralysis_etc", "麻痺：その他", "その他", after=0).t("（部位：")
f.tx("f_paralysis_etc_site", "麻痺：その他（部位）", 200).gap(16)
degree(f, "f_paralysis_etc", "麻痺：その他")
f.t("）")
y = f.nl().y
for id, label in (("f_weakness", "筋力の低下"), ("f_contracture", "関節の拘縮"), ("f_joint_pain", "関節の痛み")):
    y = part_and_degree(y, id, label)
f = Flow(y, IN + 24)
f.cb("f_ataxia", "失調・不随意運動", "失調・不随意運動", after=4).gap(max(0, 150 - tw("失調・不随意運動")) + 8)
for code, name in (("upper", "上肢"), ("lower", "下肢"), ("trunk", "体幹")):
    f.t(f"・{name}").gap(6)
    f.cb(f"f_ataxia_{code}_r", f"失調・不随意運動：{name} 右", "右")
    f.cb(f"f_ataxia_{code}_l", f"失調・不随意運動：{name} 左", "左", after=24)
y = f.nl().y
for id, label in (("f_ulcer", "褥瘡"), ("f_skin", "その他の皮膚疾患")):
    y = part_and_degree(y, id, label)
BOTTOM1 = y + 4
assert BOTTOM1 <= H - 40, f"1 ページ目がはみ出す: {BOTTOM1}"
rect(L, TOP, R, BOTTOM1)

# ================= 2 ページ目 =================
page = 2
TOP2 = 70
text(L, 30, "主治医意見書（２ページ目）", 14)
y = TOP2 + 6
text(IN, y, "４．生活機能とサービスに関する意見", 17, True)
y += RH + 2

text(IN, y, "（１）移動", FS)
y += RH
for key, title, options in (
    ("walk", "屋外歩行", (("independent", "自立"), ("assisted", "介助があればしている"), ("none", "していない"))),
    ("wheelchair", "車いすの使用", (("none", "用いていない"), ("self", "主に自分で操作している"), ("other", "主に他人が操作している"))),
    ("aid", "歩行補助具・装具の使用（複数選択可）", (("none", "用いていない"), ("outdoor", "屋外で使用"), ("indoor", "屋内で使用"))),
):
    f = Flow(y, IN + 24)
    f.t(title).x = IN + 360
    for code, name in options:
        f.cb(f"f_{key}_{code}", f"{title.split('（')[0]}：{name}", name, after=24)
    y = f.nl().y
text(IN, y, "（２）栄養・食生活", FS)
y += RH
f = Flow(y, IN + 24)
f.t("食事行為").x = IN + 360
f.cb("f_eating_independent", "食事行為：自立ないし何とか自分で食べられる", "自立ないし何とか自分で食べられる", after=24)
f.cb("f_eating_full", "食事行為：全面介助", "全面介助")
f.nl(IN + 24).t("現在の栄養状態").x = IN + 360
f.cb("f_nutrition_good", "現在の栄養状態：良好", "良好", after=24)
f.cb("f_nutrition_poor", "現在の栄養状態：不良", "不良")
f.nl(IN + 24).t("→ 栄養・食生活上の留意点（")
f.tx("f_nutrition_note", "栄養・食生活上の留意点", R - 12 - 40 - f.x).t("）")
y = f.nl().y
text(IN, y, "（３）現在あるかまたは今後発生の可能性の高い状態とその対処方針", FS)
y += RH
f = Flow(y, IN + 24)
for code, name in (("incontinence", "尿失禁"), ("fall", "転倒・骨折"), ("mobility", "移動能力の低下"), ("ulcer", "褥瘡"),
                   ("cardio", "心肺機能の低下"), ("withdrawal", "閉じこもり"), ("motivation", "意欲低下"),
                   ("wandering", "徘徊"), ("malnutrition", "低栄養"), ("dysphagia", "摂食・嚥下機能低下"),
                   ("dehydration", "脱水"), ("infection", "易感染性"), ("cancer_pain", "がん等による疼痛")):
    f.cb(f"f_risk_{code}", f"今後発生の可能性の高い状態：{name}", name, after=18)
f.cb("f_risk_etc", "今後発生の可能性の高い状態：その他", "その他", after=0).t("（")
f.tx("f_risk_etc_text", "今後発生の可能性の高い状態（その他）", 260).t("）")
f.nl(IN + 24).t("→ 対処方針（")
f.tx("f_risk_plan", "対処方針", R - 12 - 40 - f.x).t("）")
y = f.nl().y
f = Flow(y)
f.t("（４）サービス利用による生活機能の維持・改善の見通し").gap(16)
f.cb("f_outlook_yes", "生活機能の維持・改善の見通し：期待できる", "期待できる", after=24)
f.cb("f_outlook_no", "生活機能の維持・改善の見通し：期待できない", "期待できない", after=24)
f.cb("f_outlook_unknown", "生活機能の維持・改善の見通し：不明", "不明")
y = f.nl().y
text(IN, y, "（５）医学的管理の必要性（特に必要性の高いものには下線を引いて下さい。予防給付により提供されるサービスを含みます。）", FS)
y += RH
f = Flow(y, IN + 24)
for code, name in (("visit_medical", "訪問診療"), ("visit_nursing", "訪問看護"), ("visit_dental", "訪問歯科診療"),
                   ("visit_pharmacy", "訪問薬剤管理指導"), ("visit_rehab", "訪問リハビリテーション"),
                   ("short_stay", "短期入所療養介護"), ("visit_dental_hygiene", "訪問歯科衛生指導"),
                   ("visit_nutrition", "訪問栄養食事指導"), ("day_rehab", "通所リハビリテーション"),
                   ("geriatric_facility", "老人保健施設"), ("care_hospital", "介護医療院")):
    f.cb(f"f_need_{code}", f"医学的管理の必要性：{name}", name, after=18)
f.cb("f_need_etc", "医学的管理の必要性：その他の医療系サービス", "その他の医療系サービス", after=0).t("（")
f.tx("f_need_etc_text", "その他の医療系サービス", 180).t("）").gap(18)
f.cb("f_need_none", "医学的管理の必要性：特記すべき項目なし", "特記すべき項目なし")
y = f.nl().y
text(IN, y, "（６）サービス提供時における医学的観点からの留意事項", FS)
y += RH
for code, name in (("bp", "血圧"), ("intake", "摂食"), ("swallow", "嚥下"), ("move", "移動"), ("exercise", "運動")):
    f = Flow(y, IN + 24)
    f.t(f"・{name}").x = IN + 110
    f.cb(f"f_caution_{code}_none", f"留意事項（{name}）：特になし", "特になし", after=24)
    f.cb(f"f_caution_{code}_yes", f"留意事項（{name}）：あり", "あり", after=0).t("（")
    f.tx(f"f_caution_{code}_text", f"留意事項（{name}）", R - 12 - 40 - f.x).t("）")
    y = f.nl().y
f = Flow(y, IN + 24)
f.t("・その他").x = IN + 110
f.t("（")
f.tx("f_caution_etc_text", "留意事項（その他）", R - 12 - 40 - f.x).t("）")
y = f.nl().y
f = Flow(y)
f.t("（７）感染症の有無（有の場合は具体的に記入して下さい）").gap(16)
f.cb("f_infection_no", "感染症：無", "無", after=18)
f.cb("f_infection_yes", "感染症：有", "有", after=0).t("（")
f.tx("f_infection_text", "感染症（具体的に）", 380, initial_expression="%infections").t("）").gap(18)
f.cb("f_infection_unknown", "感染症：不明", "不明")
y = f.nl().y + 4

y = section(y, "５．特記すべき事項")
for line in ("要介護認定及び介護サービス計画作成時に必要な医学的なご意見等を記載して下さい。なお、専門医等に別途意見を求めた場合は",
             "その内容、結果も記載して下さい。（情報提供書や身体障害者申請診断書の写し等を添付して頂いても結構です。）"):
    text(IN, y, line, 14)
    y += 22
y += 6
BOTTOM2 = H - 80
assert BOTTOM2 - y >= 300, f"特記すべき事項の欄が狭い: {BOTTOM2 - y}"
field("f_remarks", "textarea", "特記すべき事項", IN, y, R - 12 - IN, BOTTOM2 - 10 - y, 9.5,
      transfer_kinds=["prescription", "injection", "order", "condition", "lab"])
rect(L, TOP2, R, BOTTOM2)

assert len(fields) <= 300, f"項目が多すぎる: {len(fields)}"


def page_html(items):
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;padding:0;background:#fff;width:{W}px;height:{H}px;overflow:hidden}}
body{{position:relative;font-family:"Hiragino Mincho ProN","Yu Mincho",serif;color:#000}}
.t{{position:absolute;white-space:nowrap;line-height:1.3}}
.l{{position:absolute;background:#000}}
.b{{position:absolute;box-sizing:border-box;border:1.5px solid #000}}
</style></head><body>{''.join(items)}</body></html>"""


def render(items, tmp, n):
    html_path = os.path.join(tmp, f"page{n}.html")
    png_path = os.path.join(tmp, f"page{n}.png")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(page_html(items))
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                    f"--window-size={W},{H}", f"--screenshot={png_path}", f"file://{html_path}"],
                   check=True, capture_output=True)
    with open(png_path, "rb") as f:
        return f.read()


out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "care-opinion-form-01.json")
with tempfile.TemporaryDirectory() as tmp:
    pngs = [render(pages[n], tmp, n) for n in (1, 2)]

export = {
    "format": "document-form-template",
    "format_version": 1,
    "template": {
        "name": "主治医意見書",
        "file_name": "care-opinion-form-01.png",
        "content_type": "image/png",
        "file_category": {"code": "dfd54cf2-2490-4936-a171-6049627ca3f3", "name": "診断書・意見書"},
        "layout": {"schema_version": 1, "fields": fields},
    },
    "pages": [{"page_number": n, "content_type": "image/png", "width_px": W, "height_px": H,
               "width_pt": 595.28, "height_pt": 841.89, "data": base64.b64encode(png).decode()}
              for n, png in enumerate(pngs, 1)],
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(export, f, ensure_ascii=False, indent=2)
print(f"{out}: {len(fields)} fields, pages {[len(p) for p in pngs]} bytes")
