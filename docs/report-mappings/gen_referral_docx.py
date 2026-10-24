import os, sys, zipfile
from xml.sax.saxutils import escape
# 診療情報提供書(別紙様式 11 相当)の Word テンプレート(.docx)を生成する。
# 文書作成の「Word / Excel」で使う。{{ }} は文書テンプレート画面の「変数一覧」の名前。
# 本文の欄は表の行の最小の高さだけを決めるので、差し込んだ値や追記に合わせて行が伸びる。
# 使い方: python3 gen_referral_docx.py [出力先](既定 referral-word-01.docx)
FONT = "游明朝"
# A4、余白 20mm。幅の単位は twip(1mm = 56.7)。
PAGE_W, PAGE_H, MARGIN = 11906, 16838, 1134
BODY_W = PAGE_W - MARGIN * 2
LABEL_W = 1800

def run(text, size=10.5, bold=False, underline=False):
    props = f'<w:rFonts w:ascii="{FONT}" w:eastAsia="{FONT}" w:hAnsi="{FONT}"/>'
    if bold:
        props += "<w:b/>"
    props += f'<w:sz w:val="{int(size * 2)}"/><w:szCs w:val="{int(size * 2)}"/>'
    if underline:
        props += '<w:u w:val="single"/>'
    return f'<w:r><w:rPr>{props}</w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'

# 行間は文字サイズの 1.4 倍の固定値にする(游明朝の既定の行間は広く、1 ページに収まらない)。
def para(runs="", align="left", before=0, after=0, indent=0, size=10.5):
    jc = {"left": "left", "center": "center", "right": "right"}[align]
    ind = f'<w:ind w:left="{indent}"/>' if indent else ""
    line = round(size * 20 * 1.4)
    return (f'<w:p><w:pPr><w:spacing w:before="{before}" w:after="{after}" w:line="{line}" w:lineRule="exact"/>'
            f'{ind}<w:jc w:val="{jc}"/></w:pPr>'
            f"{runs}</w:p>")

def cell(content, width, valign="center", shade=False, span=1):
    grid_span = f'<w:gridSpan w:val="{span}"/>' if span > 1 else ""
    fill = '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' if shade else ""
    return (f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{grid_span}{fill}<w:vAlign w:val="{valign}"/></w:tcPr>'
            f"{content}</w:tc>")

def row(cells, height):
    return f'<w:tr><w:trPr><w:trHeight w:val="{height}" w:hRule="atLeast"/></w:trPr>{"".join(cells)}</w:tr>'

def table(rows, widths):
    border = "".join(f'<w:{side} w:val="single" w:sz="6" w:space="0" w:color="000000"/>'
                     for side in ("top", "left", "bottom", "right", "insideH", "insideV"))
    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    return (f'<w:tbl><w:tblPr><w:tblW w:w="{sum(widths)}" w:type="dxa"/><w:tblBorders>{border}</w:tblBorders>'
            f'<w:tblLayout w:type="fixed"/>'
            f'<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/>'
            f'<w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>'
            f'<w:tblGrid>{grid}</w:tblGrid>{"".join(rows)}</w:tbl>')

def label(text):
    lines = "".join(("<w:r><w:br/></w:r>" if i else "") + run(line) for i, line in enumerate(text.split("\n")))
    return cell(para(lines, "center"), LABEL_W, shade=True)

def value(text, width, valign="center", align="left"):
    return cell(para(run(text) if text else "", align), width, valign)

body = []
body.append(para(run("診療情報提供書", 18, True), "center", after=120, size=18))
body.append(para(run("{{今日の日付(和暦)}}"), "right"))

# 宛先
body.append(para(run("紹介先医療機関等名", 9), size=9))
body.append(para(run("　" * 24, underline=True), before=120, after=120))
body.append(para(run("　" * 8, underline=True) + run("　科　　") + run("　" * 10, underline=True) + run("　殿"), after=120))

# 紹介元
SENDER_INDENT = 4800
body.append(para(run("紹介元医療機関の所在地及び名称", 9), indent=SENDER_INDENT, size=9))
body.append(para(run("〒{{医療機関郵便番号}}　{{医療機関住所}}"), indent=SENDER_INDENT, before=40))
body.append(para(run("{{医療機関名}}"), indent=SENDER_INDENT, before=40))
body.append(para(run("電話番号　{{医療機関電話番号}}"), indent=SENDER_INDENT, before=40))
body.append(para(run("医師氏名　{{作成者氏名}}　　　　　印"), indent=SENDER_INDENT, before=40, after=160))

# 患者
SUB_LABEL_W = 1100
SUB_W = 2400
MAIN_W = BODY_W - LABEL_W - SUB_LABEL_W - SUB_W
def sub_label(text):
    return cell(para(run(text), "center"), SUB_LABEL_W, shade=True)

def wide(text):
    return cell(para(run(text)), BODY_W - LABEL_W, span=3)

patient_rows = [
    row([label("患者氏名"), value("{{患者氏名(漢字)}}", MAIN_W), sub_label("性別"), value("{{性別}}", SUB_W, align="center")], 460),
    row([label("患者住所"), wide("{{住所}}")], 460),
    row([label("電話番号"), value("{{電話番号}}", MAIN_W), sub_label("職業"), value("", SUB_W)], 460),
    row([label("生年月日"), wide("{{生年月日(和暦)}}（{{年齢}}歳）")], 460),
]
body.append(table(patient_rows, [LABEL_W, MAIN_W, SUB_LABEL_W, SUB_W]))
body.append(para(after=0, size=8))

# 本文。値の入る欄は上揃えにして、続きを書き足せるようにする。
SECTIONS = [
    ("傷病名", "{{傷病名(継続中・全区分)}}", 800),
    ("紹介目的", "", 1000),
    ("既往歴及び\n家族歴", "{{既往歴}}", 900),
    ("症状経過及び\n検査結果", "{{最新の検査結果}}", 1700),
    ("治療経過", "", 1100),
    ("現在の処方", "{{投与中の処方薬}}", 1100),
    ("備考", "", 500),
]
section_rows = [row([label(name), value(text, BODY_W - LABEL_W, "top")], height) for name, text, height in SECTIONS]
body.append(table(section_rows, [LABEL_W, BODY_W - LABEL_W]))

NOTES = [
    "備考　1. 必要がある場合は続紙に記載して添付すること。",
    "　　　2. 必要がある場合は画像診断のフィルム、検査の記録を添付すること。",
    "　　　3. 紹介先が保険医療機関以外である場合は、紹介先医療機関等名の欄に紹介先保険薬局、市町村、保健所名等を記入すること。",
    "　　　　 かつ、患者住所及び電話番号を必ず記入すること。",
]
body.append(para(size=6))
body += [para(run(note, 8), size=8) for note in NOTES]

W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
document = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document {W_NS}><w:body>{"".join(body)}'
            f'<w:sectPr><w:pgSz w:w="{PAGE_W}" w:h="{PAGE_H}"/>'
            f'<w:pgMar w:top="{MARGIN}" w:right="{MARGIN}" w:bottom="{MARGIN}" w:left="{MARGIN}" '
            f'w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>')
content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                 '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                 '<Default Extension="xml" ContentType="application/xml"/>'
                 '<Override PartName="/word/document.xml" '
                 'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                 '</Types>')
rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="word/document.xml"/></Relationships>')

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "referral-word-01.docx")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", content_types)
    z.writestr("_rels/.rels", rels)
    z.writestr("word/document.xml", document)
print(out)
