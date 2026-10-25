import base64, json, os, subprocess, sys, tempfile
# 生活習慣病 療養計画書(別紙様式 9 初回用・別紙様式 9 の 2 継続用)の様式テンプレートのエクスポートファイルを生成する。
# 紙面は HTML で組み、Chrome のヘッドレスで A4 150dpi(1240x1754px)の PNG にする。
# 文字・□・入力欄は同じ座標計算(Flow)で置くので、チェック項目は必ず□の上に乗る。
# 使い方: python3 gen_lifestyle_plan_form.py [出力先ディレクトリ](既定はこのスクリプトの場所)
#   lifestyle-plan-initial-form-01.json(初回用)と lifestyle-plan-continued-form-01.json(継続用)を書き出す。
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
W, H = 1240, 1754
L, R = 70, 1170           # 枠の左右
VC = 122                  # 縦書きの見出し列の右端
SC = 236                  # 「重点を置く領域」の領域名の列の右端
FS = 17                   # 本文の文字サイズ(px)
RH = 30                   # 1 行の高さ(px)
BOX = 16                  # □の一辺(px)
FIELD_PT = 9.5            # 入力値の文字サイズ(pt)
KANJI_NAME = "%patient.name.where(extension.where(value = 'SYL').empty()).select(family + ' ' + given.first()).first()"
CATEGORY = {"code": "20f88598-bea0-4280-8e85-24c639035e57", "name": "計画書"}


def tw(s, size=FS):
    # 明朝の全角は 1 字 = 文字サイズ、半角は少し広めに見積もる(重なるより空く方を選ぶ)。
    return round(sum(size if ord(c) > 0x7F else size * 0.6 for c in s))


class Sheet:
    """1 ページ分の紙面(HTML の部品)と項目。"""

    def __init__(self):
        self.html = []
        self.fields = []

    def text(self, x, y, s, size=FS, bold=False, align="left", w=None):
        style = f"left:{x}px;top:{y}px;font-size:{size}px;font-weight:{'bold' if bold else 'normal'};text-align:{align};"
        if w is not None:
            style += f"width:{w}px;"
        self.html.append(f'<div class="t" style="{style}">{s}</div>')

    def vtext(self, x1, y1, x2, y2, s, size=FS + 1):
        self.html.append(f'<div class="v" style="left:{x1}px;top:{y1}px;width:{x2 - x1}px;height:{y2 - y1}px">'
                         f'<span style="font-size:{size}px">{s}</span></div>')

    def hline(self, x1, x2, y, width=2):
        self.html.append(f'<div class="l" style="left:{x1}px;top:{y - width // 2}px;width:{x2 - x1}px;height:{width}px"></div>')

    def vline(self, x, y1, y2, width=2):
        self.html.append(f'<div class="l" style="left:{x - width // 2}px;top:{y1}px;width:{width}px;height:{y2 - y1}px"></div>')

    def rect(self, x1, y1, x2, y2, width=2):
        self.hline(x1, x2, y1, width); self.hline(x1, x2, y2, width)
        self.vline(x1, y1, y2, width); self.vline(x2, y1, y2, width)

    def box(self, x, y):
        self.html.append(f'<div class="b" style="left:{x}px;top:{y:.1f}px;width:{BOX}px;height:{BOX}px"></div>')

    def field(self, id, type, label, x, y, w, h, font_size=FIELD_PT, **extra):
        assert not any(f["id"] == id for f in self.fields), f"id が重複: {id}"
        f = {"id": id, "type": type, "label": label, "page": 1, "x": round(x), "y": round(y), "w": round(w), "h": round(h),
             "font_size": font_size, "align": extra.pop("align", "left"), "required": extra.pop("required", False)}
        if type in ("text", "textarea"):
            f["initial_expression"] = extra.pop("initial_expression", "")
            f["transfer_kinds"] = extra.pop("transfer_kinds", [])
        elif type == "date":
            f["initial_expression"] = extra.pop("initial_expression", "")
            f["date_format"] = extra.pop("date_format", "wareki")
        f.update(extra)
        assert f["x"] + f["w"] <= W and f["y"] + f["h"] <= H, f"ページからはみ出す: {id}"
        self.fields.append(f)


class Flow:
    """1 行を左から並べる。右端を越えたら止める(折り返さない)。"""

    def __init__(self, sheet, y, x, right=R - 12, size=FS):
        self.s, self.x, self.y, self.size, self.right = sheet, x, y, size, right

    def _fit(self, width):
        assert self.x + width <= self.right, f"1 行に収まらない: y={self.y}"

    def t(self, s, bold=False):
        self._fit(tw(s, self.size))
        self.s.text(self.x, self.y, s, self.size, bold)
        self.x += tw(s, self.size)
        return self

    def at(self, x):
        assert x >= self.x, f"前の部品と重なる: y={self.y}"
        self.x = x
        return self

    def gap(self, px):
        self.x += px
        return self

    def cb(self, id, label, caption=None, after=14):
        width = BOX + 4 + (tw(caption, self.size) if caption else 0)
        self._fit(width)
        top = self.y + (self.size * 1.3 - BOX) / 2
        self.s.box(self.x, top)
        self.s.field(id, "checkbox", label, self.x - 5, top - 5, BOX + 10, BOX + 10, 10, align="center")
        self.x += BOX + 4
        if caption:
            self.s.text(self.x, self.y, caption, self.size)
            self.x += tw(caption, self.size)
        self.x += after
        return self

    def tx(self, id, label, w, **extra):
        """（ ）の中の入力欄。w が None なら閉じ括弧の分を残して右端まで。"""
        if w is None:
            w = self.right - self.size - self.x
        self._fit(w)
        self.s.field(id, extra.pop("type", "text"), label, self.x + 2, self.y - 5, w - 4, 31, **extra)
        self.x += w
        return self


def build(continued):
    s = Sheet()
    kind = "継続用" if continued else "初回用"

    # ---- 表題 ----
    s.text(L, 40, "（別紙様式９の２）" if continued else "（別紙様式９）", 15)
    s.text(L, 78, f"生活習慣病　療養計画書　{kind}", 26, True)
    f = Flow(s, 84, 640)
    f.t("（記入日：")
    f.tx("f_written_date", "記入日", 230, type="date", align="center", initial_expression="%today")
    f.t("）")
    if continued:
        f.t("（")
        f.tx("f_count", "回数", 64, align="center")
        f.t("）回目")

    # ---- 患者・主病 ----
    T = [128, 172, 216]
    s.rect(L, T[0], 760, T[2])
    s.hline(L, 760, T[1], 1)
    f = Flow(s, T[0] + 10, L + 14)
    f.t("患者氏名：")
    f.tx("f_pt_name", "患者氏名", 420, font_size=11, initial_expression=KANJI_NAME)
    f.at(L + 560).t("（")
    f.cb("f_pt_male", "性別：男", "男", after=8).t("・").gap(8)
    f.cb("f_pt_female", "性別：女", "女", after=0).t("）")
    f = Flow(s, T[1] + 10, L + 14)
    f.t("生年月日：")
    f.tx("f_pt_birth", "生年月日", 300, initial_expression="%patient.birthDate", type="date")
    f.t("生（")
    f.tx("f_pt_age", "年齢", 70, align="right", initial_expression="%age")
    f.t("才）")
    s.rect(790, T[0], R, T[2])
    s.text(804, T[0] + 10, "主病：", FS)
    f = Flow(s, T[1] + 10, 804)
    f.cb("f_dm", "主病：糖尿病", "糖尿病")
    f.cb("f_htn", "主病：高血圧症", "高血圧症")
    f.cb("f_dl", "主病：脂質異常症", "脂質異常症", after=0)

    # ---- 枠 ----
    TOP = 238
    s.text(L, TOP + 8, "ねらい：重点目標の達成状況を理解できること・目標再設定と指導された生活習慣改善に取り組めること"
           if continued else "ねらい：検査結果を理解できること・自分の生活上の問題点を抽出し、目標を設定できること",
           FS, True, "center", R - L)
    y = TOP + 8 + RH + 2
    s.hline(L, R, y)
    X = VC + 12

    # ---- 目標 ----
    top = y
    y += 8
    f = Flow(s, y, X)
    f.t("【目 標】", True).gap(8)
    f.cb("f_goal_weight", "目標：体重", "体重：（", after=0)
    f.tx("f_goal_weight_value", "目標：体重（kg）", 100, align="right").t("kg）").gap(18)
    f.cb("f_goal_bmi", "目標：BMI", "BMI：（", after=0)
    f.tx("f_goal_bmi_value", "目標：BMI", 90, align="right").t("）").gap(18)
    f.cb("f_goal_bp", "目標：収縮期／拡張期血圧", "収縮期／拡張期血圧（", after=0)
    f.tx("f_goal_sbp", "目標：収縮期血圧", 70, align="right").t("／")
    f.tx("f_goal_dbp", "目標：拡張期血圧", 70, align="right").t("mmHg）")
    y += RH
    f = Flow(s, y, X + tw("【目 標】") + 8)
    f.cb("f_goal_hba1c", "目標：HbA1c", "HbA1c：（", after=0)
    f.tx("f_goal_hba1c_value", "目標：HbA1c（%）", 100, align="right").t("%）")
    y += RH + 2
    goals = [("f_achieved_goal", "達成目標", "【①達成目標】：患者と相談した目標"),
             ("f_action_goal", "行動目標", "【②行動目標】：患者と相談した目標")]
    if continued:
        goals = [("f_progress", "目標の達成状況", "【①目標の達成状況】"),
                 ("f_achieved_goal", "達成目標", "【②達成目標】：患者と相談した目標"),
                 ("f_action_goal", "行動目標", "【③行動目標】：患者と相談した目標")]
    for id, label, heading in goals:
        s.text(X, y, heading, FS, True)
        y += RH - 2
        s.text(X + 4, y + 8, "（", 34)
        s.text(R - 46, y + 8, "）", 34)
        s.field(id, "textarea", label, X + 40, y + 2, R - 52 - X - 40, 62, FIELD_PT)
        y += 70
    y += 4
    s.vtext(L, top, VC, y, "【目標】")
    s.vline(VC, top, y)
    s.hline(L, R, y)

    # ---- 重点を置く領域と指導項目 ----
    top = y
    X = SC + 12
    X2 = 738                       # 2 列目の□の位置

    def domain(y, code, name, rows):
        start = y
        y += 6
        for row in rows:
            row(Flow(s, y, X))
            y += RH
        y += 2
        cy = (start + y) / 2 - FS * 0.65
        f = Flow(s, cy, VC + 14)
        f.cb(f"f_area_{code}", f"重点を置く領域：{name}", name, after=0)
        return y

    def none_row(code, name):
        return lambda f: f.cb(f"f_{code}_none", f"{name}：今回は、指導の必要なし", "今回は、指導の必要なし")

    def reduce_row(code, name):
        def row(f):
            f.cb(f"f_diet_{code}", f"食事：{name}", f"{name}：〔減らす（種類・量：", after=0)
            f.tx(f"f_diet_{code}_kind", f"{name}（種類・量）", 320).t("を週")
            f.tx(f"f_diet_{code}_times", f"{name}（週の回数）", 60, align="center").t("回）〕")
        return row

    def eat_row(f):
        f.cb("f_diet_manner", "食事：食べ方", "食べ方：（", after=0)
        f.cb("f_diet_manner_slow", "食べ方：ゆっくり食べる", "ゆっくり食べる", after=0).t("・").gap(6)
        f.cb("f_diet_manner_etc", "食べ方：その他", "その他（", after=0)
        f.tx("f_diet_manner_text", "食べ方（その他）", 300).t("））")

    diet = [
        lambda f: (f.cb("f_diet_amount", "食事：食事摂取量を適正にする", "食事摂取量を適正にする"),
                   f.at(X2).cb("f_diet_salt", "食事：食塩・調味料を控える", "食塩・調味料を控える")),
        lambda f: (f.cb("f_diet_fiber", "食事：食物繊維の摂取を増やす", "野菜・きのこ・海藻など食物繊維の摂取を増やす"),
                   f.at(X2).cb("f_diet_eating_out", "食事：外食の際の注意事項", "外食の際の注意事項（", after=0),
                   f.tx("f_diet_eating_out_text", "外食の際の注意事項", None).t("）")),
        lambda f: (f.cb("f_diet_oil", "食事：油を使った料理の摂取を減らす", "油を使った料理（揚げ物や炒め物等）の摂取を減らす"),
                   f.at(X2).cb("f_diet_etc", "食事：その他", "その他（", after=0),
                   f.tx("f_diet_etc_text", "食事（その他）", None).t("）")),
        reduce_row("alcohol", "節酒"),
        reduce_row("snack", "間食"),
        eat_row,
        lambda f: f.cb("f_diet_time", "食事：食事時間", "食事時間：朝食、昼食、夕食を規則正しくとる"),
    ]
    if continued:
        diet.insert(0, none_row("diet", "食事"))
    y = domain(y, "diet", "食事", diet)
    s.hline(VC, R, y, 1)

    def rx_type(f):
        f.cb("f_ex_rx", "運動：運動処方", "運動処方：種類（", after=0)
        f.cb("f_ex_walking", "運動処方：ウォーキング", "ウォーキング", after=0).t("・")
        f.tx("f_ex_type_text", "運動処方：種類", 420).t("）")

    def rx_time(f):
        f.gap(BOX + 4 + 14).t("時間（")
        f.cb("f_ex_30min", "運動処方：30分以上", "30分以上", after=0).t("・")
        f.tx("f_ex_time_text", "運動処方：時間", 150).t("）、頻度（")
        f.cb("f_ex_daily", "運動処方：ほぼ毎日", "ほぼ毎日", after=0).t("・週")
        f.tx("f_ex_days", "運動処方：週の日数", 60, align="center").t("日）")

    def rx_intensity(f):
        f.gap(BOX + 4 + 14).t("強度（")
        f.cb("f_ex_talk", "運動処方：息がはずむが会話が可能な強さ", "息がはずむが会話が可能な強さ", after=6).t("or 脈拍")
        f.tx("f_ex_pulse", "運動処方：脈拍（拍/分）", 70, align="center").t("拍/分 or")
        f.tx("f_ex_intensity_text", "運動処方：強度（その他）", None).t("）")

    exercise = [
        rx_type, rx_time, rx_intensity,
        lambda f: (f.cb("f_ex_activity", "運動：日常生活の活動量増加", "日常生活の活動量増加（例：1日1万歩・", after=0),
                   f.tx("f_ex_activity_text", "日常生活の活動量増加", 300), f.t("）")),
        lambda f: (f.cb("f_ex_caution", "運動：運動時の注意事項など", "運動時の注意事項など（", after=0),
                   f.tx("f_ex_caution_text", "運動時の注意事項など", None), f.t("）")),
    ]
    if continued:
        exercise.insert(0, none_row("ex", "運動"))
    y = domain(y, "exercise", "運動", exercise)
    s.hline(VC, R, y, 1)

    tobacco = [lambda f: (f.cb("f_tobacco_effect", "たばこ：禁煙・節煙の有効性", "禁煙・節煙の有効性", after=40),
                          f.cb("f_tobacco_method", "たばこ：禁煙の実施方法等", "禁煙の実施方法等"))]
    if not continued:
        tobacco.insert(0, lambda f: f.cb("f_tobacco_non_smoker", "たばこ：非喫煙者である", "非喫煙者である"))
    y = domain(y, "tobacco", "たばこ", tobacco)
    s.hline(VC, R, y, 1)

    y = domain(y, "other", "その他", [
        lambda f: (f.cb("f_other_work", "その他：仕事", "仕事", after=40), f.cb("f_other_leisure", "その他：余暇", "余暇", after=40),
                   f.cb("f_other_sleep", "その他：睡眠の確保", "睡眠の確保（質・量）", after=40),
                   f.cb("f_other_weight_loss", "その他：減量", "減量")),
        lambda f: f.cb("f_other_home_measure", "その他：家庭での計測", "家庭での計測（歩数、体重、血圧、腹囲等）"),
        lambda f: (f.cb("f_other_etc", "その他：その他", "その他（", after=0), f.tx("f_other_etc_text", "その他（その他）", None), f.t("）")),
    ])
    s.vtext(L, top, VC, y, "【重点を置く領域と指導項目】")
    s.vline(VC, top, y)
    s.vline(SC, top, y, 1)
    s.hline(L, R, y)

    # ---- 検査 ----
    top = y
    X = VC + 12
    X3 = 720                       # 右列の□の位置
    TX = 916                       # 右列の値の欄の左端

    def lipid(f, code, name):
        f.at(X3).cb(f"f_lab_{code}", f"血液検査：{name}", name, after=0).at(TX).t("（")
        f.tx(f"f_lab_{code}_value", f"血液検査：{name}（mg/dl）", 140, align="right").t("mg/dl）")

    y += 6
    f = Flow(s, y, X)
    f.t("【血液検査項目】", True).t("（採血日")
    f.tx("f_lab_date", "採血日", 170, type="date", date_format="slash", align="center").t("）")
    lipid(f, "tc", "総コレステロール")
    y += RH
    f = Flow(s, y, X)
    f.cb("f_lab_glucose", "血液検査：血糖", "血糖（", after=0)
    f.cb("f_lab_glucose_fasting", "血糖：空腹時", "空腹時", after=8)
    f.cb("f_lab_glucose_random", "血糖：随時", "随時", after=8)
    f.cb("f_lab_glucose_post", "血糖：食後", "食後（", after=0)
    f.tx("f_lab_glucose_hours", "血糖：食後の時間", 44, align="center").t("）時間）")
    lipid(f, "tg", "中性脂肪")
    y += RH
    f = Flow(s, y, X + 100)
    f.t("（")
    f.tx("f_lab_glucose_value", "血液検査：血糖（mg/dl）", 200, align="right").t("mg/dl）")
    lipid(f, "hdl", "HDLコレステロール")
    y += RH
    f = Flow(s, y, X)
    f.cb("f_lab_hba1c", "血液検査：HbA1c", "HbA1c：", after=0).at(X + 100).t("（")
    f.tx("f_lab_hba1c_value", "血液検査：HbA1c（%）", 200, align="right").t("%）")
    lipid(f, "ldl", "LDLコレステロール")
    y += RH
    f = Flow(s, y, X)
    f.t("※血液検査結果を手交している場合は記載不要", True)
    f.at(X3).cb("f_lab_etc", "血液検査：その他", "その他（", after=0)
    f.tx("f_lab_etc_text", "血液検査（その他）", None).t("）")
    y += RH + 2
    s.hline(VC, R, y, 1)
    y += 6
    s.text(X, y, "【その他】", FS, True)
    y += RH
    f = Flow(s, y, X)
    f.cb("f_nutrition", "その他：栄養状態", "栄養状態", after=0).at(X + 140).t("（")
    f.cb("f_nutrition_low", "栄養状態：低栄養状態の恐れ", "低栄養状態の恐れ", after=24)
    f.cb("f_nutrition_good", "栄養状態：良好", "良好", after=24)
    f.cb("f_nutrition_obese", "栄養状態：肥満", "肥満", after=0).t("）")
    y += RH
    f = Flow(s, y, X)
    f.cb("f_exam_etc", "検査（その他）", "その他", after=0).at(X + 140).t("（")
    f.tx("f_exam_etc_text", "検査（その他）の内容", 640).t("）")
    y += RH + 4
    s.vtext(L, top, VC, y, "【検査】")
    s.vline(VC, top, y)
    s.rect(L, TOP, R, y)

    # ---- 署名 ----
    y += 8
    s.text(L, y, "※実施項目は、□にチェック、（　）内には具体的に記入", FS, True)
    y += RH + 4
    s.rect(L + 120, y, 640, y + 74, 1)
    s.text(L + 128, y + 6, "患者署名", 15)
    s.rect(680, y, R, y + 74, 1)
    s.text(688, y + 6, "医師氏名", 15)
    s.field("f_doctor", "text", "医師氏名", 700, y + 28, R - 720, 40, 12, initial_expression="%authorName")
    y += 74 + 12
    if continued:
        f = Flow(s, y, L + 120)
        f.cb("f_understood", "患者が療養計画書の内容について説明を受けた上で十分に理解したことを確認した",
             "患者が療養計画書の内容について説明を受けた上で十分に理解したことを確認した。", after=0)
        y += RH - 4
        s.text(L + 140, y, "（なお、上記項目に担当医がチェックした場合については患者署名を省略して差し支えない）", 15)
        y += RH
    assert y <= H - 40, f"ページからはみ出す: {y}"
    return s


def page_html(items):
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;padding:0;background:#fff;width:{W}px;height:{H}px;overflow:hidden}}
body{{position:relative;font-family:"Hiragino Mincho ProN","Yu Mincho",serif;color:#000}}
.t{{position:absolute;white-space:nowrap;line-height:1.3}}
.v{{position:absolute;display:flex;align-items:center;justify-content:center;font-weight:bold}}
.v span{{writing-mode:vertical-rl;letter-spacing:2px}}
.l{{position:absolute;background:#000}}
.b{{position:absolute;box-sizing:border-box;border:1.5px solid #000}}
</style></head><body>{''.join(items)}</body></html>"""


def render(items, tmp):
    html_path = os.path.join(tmp, "page.html")
    png_path = os.path.join(tmp, "page.png")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(page_html(items))
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                    f"--window-size={W},{H}", f"--screenshot={png_path}", f"file://{html_path}"],
                   check=True, capture_output=True)
    with open(png_path, "rb") as f:
        return f.read()


out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
for continued, slug, name in ((False, "lifestyle-plan-initial-form-01", "生活習慣病 療養計画書（初回用）"),
                              (True, "lifestyle-plan-continued-form-01", "生活習慣病 療養計画書（継続用）")):
    sheet = build(continued)
    with tempfile.TemporaryDirectory() as tmp:
        png = render(sheet.html, tmp)
    export = {
        "format": "document-form-template",
        "format_version": 1,
        "template": {
            "name": name,
            "file_name": f"{slug}.png",
            "content_type": "image/png",
            "file_category": CATEGORY,
            "layout": {"schema_version": 1, "fields": sheet.fields},
        },
        "pages": [{"page_number": 1, "content_type": "image/png", "width_px": W, "height_px": H,
                   "width_pt": 595.28, "height_pt": 841.89, "data": base64.b64encode(png).decode()}],
    }
    out = os.path.join(out_dir, f"{slug}.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(export, f, ensure_ascii=False, indent=2)
    print(f"{out}: {len(sheet.fields)} fields, page {len(png)} bytes")
