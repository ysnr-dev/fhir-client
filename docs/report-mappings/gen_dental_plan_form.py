import base64, io, json, os, sys
# 歯科疾患管理料に係る管理計画書(別紙様式 1 初回用・別紙様式 2 継続用)の様式テンプレートのエクスポートファイルを生成する。
# 紙面は同じディレクトリの dental-plan-form-01.pdf(厚生労働省の様式の 1・2 ページ)をそのまま 150dpi の PNG にし、
# 項目は PDF の文字の座標(pt)から置く(□ の上にチェック項目、（ ）の中に入力欄)。歯式図の欄は塗りつぶして
# 口腔診査の歯式図(画像)を重ねる。
# 使い方: python3 gen_dental_plan_form.py [出力先ディレクトリ](既定はこのスクリプトの場所)
#   pypdfium2 と Pillow が要る(pip install pypdfium2 pillow)。
#   dental-plan-initial-form-01.json(初回用)と dental-plan-continued-form-01.json(継続用)を書き出す。
import pypdfium2 as pdfium

HERE = os.path.dirname(os.path.abspath(__file__))
PDF = os.path.join(HERE, "dental-plan-form-01.pdf")
W = 1240                      # ページ画像の幅(px)。A4 150dpi
PT_W, PT_H = 595.276, 841.89  # A4(pt)
SCALE = W / PT_W
H = round(PT_H * SCALE)
FS = 11                       # 紙面の文字サイズ(pt)。□ も同じ大きさ
FIELD_PT = 9.5                # 入力値の文字サイズ(pt)
KANJI_NAME = "%patient.name.where(extension.where(value = 'SYL').empty()).select(family + ' ' + given.first()).first()"
CATEGORY = {"code": "20f88598-bea0-4280-8e85-24c639035e57", "name": "計画書"}


def px(v):
    return round(v * SCALE)


def has_icd10(*prefixes):
    """継続中の確定病名に、ICD-10 がどれかで始まるものがあれば真(デザイナの「で始まる」と同じ形)。"""
    return "%diagnosisIcd10.exists(" + " or ".join(f"$this.startsWith('{p}')" for p in prefixes) + ")"


class Sheet:
    def __init__(self):
        self.fields = []

    def field(self, id, type, label, x, y, w, h, font_size=FIELD_PT, **extra):
        assert not any(f["id"] == id for f in self.fields), f"id が重複: {id}"
        f = {"id": id, "type": type, "label": label, "page": 1, "x": round(x), "y": round(y), "w": round(w), "h": round(h),
             "font_size": font_size, "align": extra.pop("align", "left"), "required": extra.pop("required", False)}
        if extra.pop("mask", False):
            f["mask"] = True
        if type in ("text", "textarea"):
            f["initial_expression"] = extra.pop("initial_expression", "")
            f["transfer_kinds"] = extra.pop("transfer_kinds", [])
        elif type == "date":
            f["initial_expression"] = extra.pop("initial_expression", "")
            f["date_format"] = extra.pop("date_format", "wareki")
        elif type in ("checkbox", "image"):
            f["initial_expression"] = extra.pop("initial_expression", "")
        assert not extra, f"不明な指定: {extra}"
        assert f["x"] + f["w"] <= W and f["y"] + f["h"] <= H, f"ページからはみ出す: {id}"
        self.fields.append(f)

    def cb(self, id, label, x, y, expression=""):
        """□ の上のチェック項目。x は □ の左端、y は行のベースライン(pt)。"""
        box = px(FS)
        self.field(id, "checkbox", label, px(x) - 5, px(y - 10) - 5, box + 10, box + 10, 10, align="center",
                   initial_expression=expression)

    def tx(self, id, label, x1, x2, y, expression="", font_size=FIELD_PT, **extra):
        """1 行の入力欄。x1〜x2 は左右端、y は行のベースライン(pt)。"""
        self.field(id, extra.pop("type", "text"), label, px(x1), px(y - 11), px(x2 - x1), px(14), font_size,
                   initial_expression=expression, **extra)


def oral_status(s, y0):
    """【口腔内の状況】の右列。y0 は「4mm以上の歯周ポケット」の行のベースライン(pt)。"""
    dy = 14.3
    s.cb("f_pocket_yes", "4mm以上の歯周ポケット：有", 383.5, y0)
    s.cb("f_pocket_no", "4mm以上の歯周ポケット：無", 416.5, y0)
    s.cb("f_mobility_yes", "歯の動揺：有", 320.3, y0 + dy)
    s.cb("f_mobility_no", "歯の動揺：無", 353.3, y0 + dy)
    s.cb("f_swelling_yes", "歯肉の腫れ：有", 320.3, y0 + dy * 2)
    s.cb("f_swelling_no", "歯肉の腫れ：無", 353.3, y0 + dy * 2)
    s.cb("f_plaque_many", "プラーク・歯石の付着状況：多い", 320.2, y0 + dy * 4)
    s.cb("f_plaque_few", "プラーク・歯石の付着状況：少ない", 364.2, y0 + dy * 4)
    s.cb("f_plaque_none", "プラーク・歯石の付着状況：無", 419.3, y0 + dy * 4)
    s.cb("f_caries_yes", "むし歯：有", 320.3, y0 + dy * 5, "%oralCariesTeeth.exists($this > 0)")
    s.cb("f_caries_no", "むし歯：無", 353.2, y0 + dy * 5, "%oralCariesTeeth.exists($this = 0)")
    s.tx("f_oral_etc_text", "歯や歯肉の状態（その他）", 293, 488, y0 + dy * 6, "%oralExamNote.replace('\\n', '、')")


def oral_chart(s, chart_top, text_top):
    """【口腔内の状況】の左列。紙面の歯式図を塗りつぶして口腔診査の歯式図(画像)を重ね、その下に歯数と未処置歯の部位を書く。
    chart_top は紙面の歯式図の上端、text_top は図の下の欄の上端(px)。"""
    s.field("f_oral_chart", "image", "口腔内の状況(歯式図)", 70, chart_top, 400, text_top - chart_top - 2, FIELD_PT, mask=True,
            initial_expression="%oralExamChart")
    s.field("f_oral_summary", "text", "歯数のまとめ", 75, text_top, 390, 30, 9, initial_expression="%oralExamSummary")
    s.field("f_oral_caries_list", "text", "未処置歯の部位", 75, text_top + 33, 390, 30, 9,
            initial_expression="%oralCariesTeethList.where($this != '').select('むし歯 ' + $this)")


def oral_function(s, y0, x2, x3, child_x2):
    """【口腔機能の問題】【小児口腔機能の問題】。y0 は「【口腔機能の問題】□無」の行のベースライン(pt)。"""
    dy = 14.3
    s.cb("f_func_none", "口腔機能の問題：無", 331.2, y0)
    s.cb("f_func_hygiene", "口腔機能の問題：口腔衛生状態", 243.2, y0 + dy)
    s.cb("f_func_dry", "口腔機能の問題：口腔乾燥", x2, y0 + dy)
    s.cb("f_func_bite", "口腔機能の問題：咬合力", x3, y0 + dy)
    s.cb("f_func_tongue_lip", "口腔機能の問題：舌口唇運動機能", 243.2, y0 + dy * 2)
    s.cb("f_func_tongue_pressure", "口腔機能の問題：舌圧", x2, y0 + dy * 2)
    s.cb("f_func_chew", "口腔機能の問題：咀嚼機能", x3, y0 + dy * 2)
    s.cb("f_func_swallow", "口腔機能の問題：嚥下機能", 243.2, y0 + dy * 3)
    s.cb("f_child_none", "小児口腔機能の問題：無", 353.2, y0 + dy * 4)
    s.cb("f_child_chew", "小児口腔機能の問題：咀嚼機能", 243.2, y0 + dy * 5)
    s.cb("f_child_swallow", "小児口腔機能の問題：嚥下機能", child_x2, y0 + dy * 5)
    s.cb("f_child_eating", "小児口腔機能の問題：食行動", 430.3, y0 + dy * 5)
    s.cb("f_child_speech", "小児口腔機能の問題：構音機能", 243.2, y0 + dy * 6)
    s.cb("f_child_nutrition", "小児口腔機能の問題：栄養", child_x2, y0 + dy * 6)
    s.cb("f_child_etc", "小児口腔機能の問題：その他", 430.3, y0 + dy * 6)


def signature(s, y):
    """医療機関名・担当歯科医師。y は「医療機関名」のベースライン(pt)。"""
    s.tx("f_facility", "医療機関名", 290, 560, y, "%facilityName", 11)
    s.tx("f_dentist", "担当歯科医師", 310, 560, y + 14.3, "%authorName", 11)


def build_initial():
    s = Sheet()
    s.field("f_written_date", "date", "記入日", px(398), px(86), px(134), px(15), FIELD_PT, align="center", mask=True,
            initial_expression="%today", date_format="wareki")
    s.tx("f_pt_name", "患者氏名", 85, 300, 133.0, KANJI_NAME, 11)

    y = 154.7
    s.cb("f_dz_htn", "基礎疾患：高血圧症", 100, y, has_icd10("I10", "I11", "I12", "I13", "I15"))
    s.cb("f_dz_cvd", "基礎疾患：心血管疾患", 166, y, has_icd10("I0", "I2", "I3", "I4", "I5"))
    s.cb("f_dz_resp", "基礎疾患：呼吸器疾患", 243, y, has_icd10("J4", "J6", "J8", "J9"))
    s.cb("f_dz_dm", "基礎疾患：糖尿病", 319.9, y, has_icd10("E10", "E11", "E12", "E13", "E14"))
    s.cb("f_dz_op", "基礎疾患：骨粗鬆症", 375, y, has_icd10("M80", "M81"))
    y = 168.8
    s.cb("f_dz_etc", "基礎疾患：その他", 100, y)
    s.tx("f_dz_etc_text", "基礎疾患（その他）", 155, 510, y, transfer_kinds=["condition"])
    y = 183.1
    s.cb("f_med_none", "服薬：無", 100, y)
    s.cb("f_med_yes", "服薬：有", 127.5, y, "%activeMedications.exists($this != '')")
    s.tx("f_med_text", "薬剤の種類・薬剤名", 262, 510, y, "%activeMedications.replace('\\n', '、')",
         transfer_kinds=["prescription"])
    y = 197.4
    s.cb("f_life_smoke", "生活習慣：喫煙", 100, y)
    s.cb("f_life_etc", "生活習慣：その他", 144, y)
    s.tx("f_life_etc_text", "生活習慣（その他）", 199, 444, y)
    s.tx("f_general_etc_text", "その他", 105, 411, 211.7)

    oral_status(s, 244.6)
    oral_chart(s, 528, 1008)
    oral_function(s, 356.5, 342.4, 413.8, 342.4)
    s.field("f_remarks", "textarea", "その他・特記事項", px(238), px(478), px(327), px(44), FIELD_PT)

    y = 550.8
    s.cb("f_goal_brushing", "改善目標：歯磨きの習慣", 133, y)
    s.cb("f_goal_tools", "改善目標：歯ブラシ・フロス・歯間ブラシの使用", 232.1, y)
    s.cb("f_goal_smoking", "改善目標：喫煙習慣", 133, y + 14.3)
    s.cb("f_goal_diet", "改善目標：食習慣の改善", 232.1, y + 14.3)
    s.cb("f_goal_function", "改善目標：口腔機能の改善・獲得", 133, y + 14.3 * 2)
    s.cb("f_goal_etc", "改善目標：その他", 133, y + 14.3 * 3)
    s.tx("f_goal_etc_text", "改善目標（その他）", 188, 472, y + 14.3 * 3)

    y = 651.8
    s.cb("f_plan_caries", "治療の予定：むし歯", 133, y)
    s.cb("f_plan_bridge", "治療の予定：ブリッジ", 325.6, y)
    s.cb("f_plan_denture", "治療の予定：義歯", 391.6, y)
    s.cb("f_plan_perio", "治療の予定：歯肉炎・歯周炎の治療", 133, y + 14.3)
    s.cb("f_plan_etc", "治療の予定：その他", 133, y + 14.3 * 2)
    s.tx("f_plan_etc_text", "治療の予定（その他）", 188, 472, y + 14.3 * 2)

    signature(s, 754.9)
    return s


def build_continued():
    s = Sheet()
    s.field("f_written_date", "date", "記入日", px(398), px(101), px(134), px(15), FIELD_PT, align="center", mask=True,
            initial_expression="%today", date_format="wareki")
    s.tx("f_pt_name", "患者氏名", 85, 300, 127.1, KANJI_NAME, 11)

    oral_status(s, 172.8)
    oral_chart(s, 382, 858)
    oral_function(s, 284.8, 347.9, 419.4, 353.3)
    s.field("f_remarks", "textarea", "その他・特記事項", px(238), px(408), px(327), px(33), FIELD_PT)

    y = 457.6
    s.cb("f_past_caries", "これまでの治療：むし歯の治療", 147.1, y)
    s.cb("f_past_bridge", "これまでの治療：ブリッジ", 372.7, y)
    s.cb("f_past_denture", "これまでの治療：義歯", 444.2, y)
    s.cb("f_past_perio", "これまでの治療：歯肉炎・歯周炎の治療", 147.1, y + 14.3)
    s.cb("f_past_etc", "これまでの治療：その他", 147.1, y + 14.3 * 2)
    s.tx("f_past_etc_text", "これまでの治療（その他）", 195, 560, y + 14.3 * 2)

    y = 515.2
    s.cb("f_goal_brushing", "改善目標：歯磨きの習慣", 147.1, y)
    s.cb("f_goal_tools", "改善目標：歯ブラシ・フロス・歯間ブラシの使用", 246.2, y)
    s.cb("f_goal_smoking", "改善目標：喫煙習慣", 147.1, y + 14.3)
    s.cb("f_goal_diet", "改善目標：食習慣の改善", 246.2, y + 14.3)
    s.cb("f_goal_function", "改善目標：口腔機能の改善・獲得", 147.1, y + 14.3 * 2)
    s.cb("f_goal_etc", "改善目標：その他", 147.1, y + 14.3 * 3)
    s.tx("f_goal_etc_text", "改善目標（その他）", 195, 560, y + 14.3 * 3)

    y = 586.9
    s.cb("f_plan_caries", "治療の予定：むし歯", 147.1, y)
    s.cb("f_plan_bridge", "治療の予定：ブリッジ", 339.7, y)
    s.cb("f_plan_denture", "治療の予定：義歯", 405.7, y)
    s.cb("f_plan_perio", "治療の予定：歯肉炎・歯周炎の治療", 147.1, y + 14.3)
    s.cb("f_plan_prevention", "治療の予定：歯科疾患の重症化予防", 147.1, y + 14.3 * 2)
    s.cb("f_plan_perio_regular", "治療の予定：定期的な歯周病の治療と管理", 158.2, y + 14.3 * 3)
    s.cb("f_plan_caries_regular", "治療の予定：定期的なむし歯の管理", 323.2, y + 14.3 * 3)
    s.cb("f_plan_function_regular", "治療の予定：継続的な口腔機能の管理", 157.7, y + 14.3 * 4)
    s.cb("f_plan_etc", "治療の予定：その他", 147.1, y + 14.3 * 5)
    s.tx("f_plan_etc_text", "治療の予定（その他）", 195, 560, y + 14.3 * 5)

    signature(s, 772.9)
    return s


def render(page_index):
    page = pdfium.PdfDocument(PDF)[page_index]
    # pdfium は端数を切り上げるので、右端・下端の余白を落として A4 150dpi の大きさにそろえる。
    image = page.render(scale=SCALE).to_pil().convert("L")
    assert image.size[0] >= W and image.size[1] >= H, f"ページ画像が小さい: {image.size}"
    image = image.crop((0, 0, W, H))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


out_dir = sys.argv[1] if len(sys.argv) > 1 else HERE
for page_index, build, slug, name in ((0, build_initial, "dental-plan-initial-form-01", "歯科疾患管理料に係る管理計画書（初回用）"),
                                      (1, build_continued, "dental-plan-continued-form-01", "歯科疾患管理料に係る管理計画書（継続用）")):
    sheet = build()
    png = render(page_index)
    export = {
        "format": "document-form-template",
        "format_version": 1,
        "template": {
            "name": name,
            "file_name": "dental-plan-form-01.pdf",
            "content_type": "application/pdf",
            "file_category": CATEGORY,
            "layout": {"schema_version": 1, "fields": sheet.fields},
        },
        "pages": [{"page_number": 1, "content_type": "image/png", "width_px": W, "height_px": H,
                   "width_pt": round(PT_W, 2), "height_pt": round(PT_H, 2), "data": base64.b64encode(png).decode()}],
    }
    out = os.path.join(out_dir, f"{slug}.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(export, f, ensure_ascii=False, indent=2)
    print(f"{out}: {len(sheet.fields)} fields, page {len(png)} bytes")
