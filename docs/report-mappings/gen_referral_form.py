import base64, json, os, subprocess, sys, tempfile
# 診療情報提供書(別紙様式 11 相当)の様式テンプレートのエクスポートファイルを生成する。
# 紙面は HTML で組み、Chrome のヘッドレスで A4 150dpi(1240x1754px)の PNG にする。
# 罫線・見出しと項目の配置は同じ座標表から作るので、項目は必ず枠の中に収まる。
# 使い方: python3 gen_referral_form.py [出力先 JSON](既定 referral-form-01.json)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
W, H = 1240, 1754
L, R = 100, 1140          # 左右の罫線
LABEL_R = 270             # 見出し列の右端
KANJI_NAME = "%patient.name.where(extension.where(value = 'SYL').empty()).select(family + ' ' + given.first()).first()"

html = []
fields = []

def text(x, y, s, size=22, bold=False, align="left", w=None):
    style = f"left:{x}px;top:{y}px;font-size:{size}px;font-weight:{'bold' if bold else 'normal'};text-align:{align};"
    if w is not None:
        style += f"width:{w}px;"
    html.append(f'<div class="t" style="{style}">{s}</div>')

def hline(x1, x2, y, width=2):
    html.append(f'<div class="l" style="left:{x1}px;top:{y - width // 2}px;width:{x2 - x1}px;height:{width}px"></div>')

def vline(x, y1, y2, width=2):
    html.append(f'<div class="l" style="left:{x - width // 2}px;top:{y1}px;width:{width}px;height:{y2 - y1}px"></div>')

def rect(x1, y1, x2, y2, width=2):
    hline(x1, x2, y1, width); hline(x1, x2, y2, width); vline(x1, y1, y2, width); vline(x2, y1, y2, width)

def cell_label(x1, x2, y1, y2, s, size=21):
    # 見出しを枠の縦中央・横中央に置く(改行は <br>)。
    lines = s.count("<br>") + 1
    top = (y1 + y2) // 2 - lines * int(size * 1.3) // 2
    text(x1, top, s, size, align="center", w=x2 - x1)

def field(id, type, label, x, y, w, h, font_size=10.5, **extra):
    f = {"id": id, "type": type, "label": label, "page": 1, "x": x, "y": y, "w": w, "h": h,
         "font_size": font_size, "align": extra.pop("align", "left"), "required": extra.pop("required", False)}
    if type in ("text", "textarea"):
        f["initial_expression"] = extra.pop("initial_expression", "")
        f["transfer_kinds"] = extra.pop("transfer_kinds", [])
    elif type == "date":
        f["initial_expression"] = extra.pop("initial_expression", "")
        f["date_format"] = extra.pop("date_format", "wareki")
    f.update(extra)
    fields.append(f)

# ---- 表題・宛先 ----
text(0, 60, "診療情報提供書", 44, True, "center", W)
field("f_written_date", "date", "作成日", 840, 130, 300, 44, align="right", initial_expression="%today")

text(L, 190, "紹介先医療機関等名", 19)
field("f_dest_org", "text", "紹介先医療機関", L, 216, 560, 46, 12, required=True)
hline(L, 660, 264)
field("f_dest_dept", "text", "紹介先診療科", L, 280, 230, 46, 12)
text(L + 236, 290, "科", 24)
field("f_dest_doctor", "text", "紹介先担当医", L + 290, 280, 220, 46, 12)
text(L + 520, 290, "殿", 24)
hline(L, 660, 328)

# ---- 紹介元 ----
FX = 640
text(FX, 350, "紹介元医療機関の所在地及び名称", 19)
field("f_from_address", "text", "紹介元所在地", FX, 376, R - FX, 40, initial_expression="%facilityAddress")
field("f_from_name", "text", "紹介元医療機関名", FX, 418, R - FX, 40, 11, initial_expression="%facilityName")
hline(FX, R, 460, 1)
text(FX, 476, "電話番号", 19)
field("f_from_phone", "text", "紹介元電話番号", FX + 110, 466, R - FX - 110, 40, initial_expression="%facilityPhone")
hline(FX, R, 508, 1)
text(FX, 528, "医師氏名", 19)
field("f_from_doctor", "text", "紹介元医師", FX + 110, 518, 330, 40, 11, initial_expression="%authorName")
text(R - 30, 528, "印", 19)
hline(FX, R, 560, 1)

# ---- 患者 ----
PY = [584, 644, 704, 764, 824]
MID, MID_LABEL_R = 770, 880
rect(L, PY[0], R, PY[-1])
for y in PY[1:-1]:
    hline(L, R, y)
vline(LABEL_R, PY[0], PY[-1])
for i in (0, 2, 3):
    vline(MID, PY[i], PY[i + 1]); vline(MID_LABEL_R, PY[i], PY[i + 1])

def row_field(id, label, row, x1, x2, **extra):
    field(id, extra.pop("type", "text"), label, x1 + 10, PY[row] + 8, x2 - x1 - 20, PY[row + 1] - PY[row] - 16, **extra)

cell_label(L, LABEL_R, PY[0], PY[1], "患者氏名")
row_field("f_pt_name", "患者氏名", 0, LABEL_R, MID, font_size=12, initial_expression=KANJI_NAME)
cell_label(MID, MID_LABEL_R, PY[0], PY[1], "性別")
row_field("f_pt_sex", "性別", 0, MID_LABEL_R, R, type="select", options=["男", "女"], align="center")
cell_label(L, LABEL_R, PY[1], PY[2], "患者住所")
row_field("f_pt_address", "患者住所", 1, LABEL_R, R, initial_expression="%patient.address.first().text")
cell_label(L, LABEL_R, PY[2], PY[3], "電話番号")
row_field("f_pt_phone", "患者電話番号", 2, LABEL_R, MID,
          initial_expression="%patient.telecom.where(system = 'phone').value.first()")
cell_label(MID, MID_LABEL_R, PY[2], PY[3], "職業")
row_field("f_pt_job", "職業", 2, MID_LABEL_R, R)
cell_label(L, LABEL_R, PY[3], PY[4], "生年月日")
row_field("f_pt_birth", "生年月日", 3, LABEL_R, MID, type="date", initial_expression="%patient.birthDate")
cell_label(MID, MID_LABEL_R, PY[3], PY[4], "年齢")
field("f_pt_age", "text", "年齢", MID_LABEL_R + 10, PY[3] + 8, 160, PY[4] - PY[3] - 16, align="right",
      initial_expression="%age")
text(MID_LABEL_R + 180, PY[3] + 16, "歳", 21)

# ---- 本文 ----
SECTIONS = [
    ("f_diagnosis", "傷病名", "傷病名", 90, dict(initial_expression="%conditions", transfer_kinds=["condition"])),
    ("f_purpose", "紹介目的", "紹介目的", 110, dict(required=True)),
    ("f_history", "既往歴及び家族歴", "既往歴及び<br>家族歴", 90,
     dict(initial_expression="%pastHistory", transfer_kinds=["condition"])),
    ("f_course", "症状経過及び検査結果", "症状経過<br>及び<br>検査結果", 170,
     dict(initial_expression="%labResults", transfer_kinds=["lab"])),
    ("f_treatment", "治療経過", "治療経過", 110, dict(transfer_kinds=["prescription", "injection", "order"])),
    ("f_medication", "現在の処方", "現在の処方", 120,
     dict(initial_expression="%activeMedications", transfer_kinds=["prescription", "injection"])),
    ("f_remarks", "備考", "備考", 60, {}),
]
y = PY[-1] + 18
top = y
for id, label, heading, height, extra in SECTIONS:
    if y > top:
        hline(L, R, y)
    cell_label(L, LABEL_R, y, y + height, heading)
    field(id, "textarea", label, LABEL_R + 10, y + 8, R - LABEL_R - 20, height - 16, 10, **extra)
    y += height
rect(L, top, R, y)
vline(LABEL_R, top, y)

# ---- 注記 ----
NOTES = [
    "備考　1. 必要がある場合は続紙に記載して添付すること。",
    "　　　2. 必要がある場合は画像診断のフィルム、検査の記録を添付すること。",
    "　　　3. 紹介先が保険医療機関以外である場合は、紹介先医療機関等名の欄に紹介先保険薬局、市町村、保健所名等を記入すること。",
    "　　　　 かつ、患者住所及び電話番号を必ず記入すること。",
]
for i, note in enumerate(NOTES):
    text(L, y + 16 + i * 24, note, 16)
assert y + 16 + len(NOTES) * 24 <= H - 40, "注記がページからはみ出す"

page_html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;padding:0;background:#fff;width:{W}px;height:{H}px;overflow:hidden}}
body{{position:relative;font-family:"Hiragino Mincho ProN","Yu Mincho",serif;color:#000}}
.t{{position:absolute;white-space:nowrap;line-height:1.3}}
.l{{position:absolute;background:#000}}
</style></head><body>{''.join(html)}</body></html>"""

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "referral-form-01.json")
with tempfile.TemporaryDirectory() as tmp:
    html_path = os.path.join(tmp, "page.html")
    png_path = os.path.join(tmp, "page.png")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(page_html)
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                    f"--window-size={W},{H}", f"--screenshot={png_path}", f"file://{html_path}"],
                   check=True, capture_output=True)
    with open(png_path, "rb") as f:
        png = f.read()

export = {
    "format": "document-form-template",
    "format_version": 1,
    "template": {
        "name": "診療情報提供書",
        "file_name": "referral-form-01.png",
        "content_type": "image/png",
        "file_category": {"code": "1c504eb2-1abb-426a-810f-5102cae33628", "name": "紹介状"},
        "layout": {"schema_version": 1, "fields": fields},
    },
    "pages": [{"page_number": 1, "content_type": "image/png", "width_px": W, "height_px": H,
               "width_pt": 595.28, "height_pt": 841.89, "data": base64.b64encode(png).decode()}],
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(export, f, ensure_ascii=False, indent=2)
print(f"{out}: {len(fields)} fields, page {len(png)} bytes")
