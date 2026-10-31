import json
# 化学療法実施計画書(A4 縦)、患者向けのスケジュール表(A4 縦、1 ページ = 1 か月)、外部公開用のレジメン(A4 縦)の
# .tlf を生成する。
# backend ディレクトリで実行すると lib/report_layouts/ に書き出す。部品の書式は gen_injection_tlf.py と同じ。
FONT=["IPAGothic"]
def text(x,y,w,h,s,size=9,bold=False,align="left",id=""):
    return {"id":id,"type":"text","display":True,"description":"","x":x,"y":y,"width":w,"height":h,"texts":[s],
            "style":{"font-family":FONT,"font-size":size,"font-style":["bold"] if bold else [],"color":"#000000",
                     "text-align":align,"vertical-align":"top","letter-spacing":"","line-height":"","line-height-ratio":""}}
def block(id,x,y,w,h,size=9,align="left",lh="",bold=False,overflow="truncate"):
    return {"id":id,"type":"text-block","display":True,"description":"","x":x,"y":y,"width":w,"height":h,"value":"",
            "multiple-line":bool(lh),"format":{"base":"","type":""},
            "style":{"font-family":FONT,"font-size":size,"font-style":["bold"] if bold else [],"color":"#000000","text-align":align,
                     "vertical-align":"top","letter-spacing":"","line-height":lh,"line-height-ratio":"","overflow":overflow,"word-wrap":"none"}}
def rect(x,y,w,h,fill="none"):
    return {"id":"","type":"rect","display":True,"description":"","x":x,"y":y,"width":w,"height":h,"border-radius":0,
            "style":{"border-color":"#000000","border-width":0.5,"border-style":"solid","fill-color":fill}}
def line(x1,y1,x2,y2):
    return {"id":"","type":"line","display":True,"description":"","x1":x1,"y1":y1,"x2":x2,"y2":y2,
            "style":{"border-color":"#000000","border-width":0.5,"border-style":"solid"}}
def section(height,items,enabled=True):
    return {"enabled":enabled,"height":height,"translate":{"x":0,"y":0},"items":items}
def doc(title,items):
    return {"version":"0.11.0","title":title,
            "report":{"paper-type":"user","width":595.28,"height":841.89,"orientation":"portrait","margin":[0,0,0,0]},
            "state":{"layout-guides":[]},"items":items}

L,W=34.0,527.3; R=L+W

# ---- 化学療法実施計画書 ----
# 上段 = 患者とレジメン(2 列 × 7 行)、中段 = そのクールの投与表(list)、下段 = 備考と確認欄。
items=[text(L,26,W,20,"化学療法実施計画書",16,True,"center"),
       block("hospital_name",381,30,180.3,10,8,"right"), block("printed_on",381,42,180.3,10,8,"right"),
       block("cycle_title",L,50,300,14,12,bold=True)]
TOP,ROW=70.0,17.0; MID=L+W/2; LW=62
rows=[("患者番号","pt_id","氏　名","pt_name"),("生年月日","pt_birthdate","性　別","pt_gender"),
      ("レジメン","regimen_name","状　態","regimen_status"),("治療目的","purpose","入外区分","setting"),
      ("対象病名","problem","制吐リスク","emetic_risk"),("クール","cycle_rule","投与期間","cycle_period"),
      ("体　格","body_line","依　頼","doctor_line")]
items.append(rect(L,TOP,W,ROW*len(rows))); items.append(line(MID,TOP,MID,TOP+ROW*len(rows)))
for i,(l1,b1,l2,b2) in enumerate(rows):
    y=TOP+ROW*i
    if i>0: items.append(line(L,y,R,y))
    items.append(text(L+4,y+4,LW-4,10,l1,8))
    items.append(block(b1,L+LW,y+3.5,W/2-LW-4,11,9,overflow="fit"))
    items.append(text(MID+4,y+4,LW-4,10,l2,8))
    if b2=="pt_name":
        items.append(block("pt_kana",MID+LW,y+1,W/2-LW-4,5,4.5)); items.append(block("pt_name",MID+LW,y+6,W/2-LW-4,10,9))
    else:
        items.append(block(b2,MID+LW,y+3.5,W/2-LW-4,11,9,overflow="fit"))
LIST_Y=TOP+ROW*len(rows)+10
# 投与表の列: 種類 / 医薬品 / 基準 / 率 / 投与量 / 製剤数。日・RP の見出しと注記は行いっぱい。
# 字下げは日 → RP → 薬剤・注記の 3 段(薬剤が RP より左から始まらないように)。
COLS=[("種類","role",L+20,44,"left"),("医薬品","name",L+66,215,"left"),("基準","basis",L+283,68,"right"),
      ("率","ratio",L+353,34,"right"),("投与量","dose",L+389,70,"right"),("製剤数","packs",L+461,62,"right")]
DETAIL=13.0; HEADER=14.0; LIST_H=480.0
header_items=[text(x,LIST_Y+3,w,10,label,8,align=a) for (label,_,x,w,a) in COLS]
detail_y=LIST_Y+HEADER
detail_items=[block("day",L+2,detail_y+1.5,W-4,10,9,bold=True),
              block("step",L+10,detail_y+1.5,W-12,10,8.5),
              block("note",L+66,detail_y+2,W-68,10,7.5)]
for (_,id,x,w,a) in COLS:
    detail_items.append(block(id,x,detail_y+1.5,w,10,8.5,a,overflow="fit" if id=="name" else "truncate"))
items.append(rect(L,LIST_Y,W,LIST_H))
items.append(line(L,LIST_Y+HEADER,R,LIST_Y+HEADER))
items.append({"id":"content","type":"list","display":True,"description":"","x":L,"y":LIST_Y,"width":W,"height":LIST_H,
              "content-height":LIST_H-HEADER,"auto-page-break":False,
              "header":section(HEADER,header_items),"detail":section(DETAIL,detail_items),
              "page-footer":section(0,[],False),"footer":section(0,[],False)})
items.append(text(R-140,LIST_Y+LIST_H-12,136,10,"（次頁に続く）",8,align="right",id="continued"))
BOT=LIST_Y+LIST_H+8
items+= [text(L,BOT,60,10,"備考",8), rect(L,BOT+11,W,38), block("remarks",L+5,BOT+15,W-10,30,8,lh=10)]
# 確認欄: 依頼医・監査した薬剤師・投与する看護師が署名する(手書き)。
SIGN_Y=BOT+56
items.append(rect(L,SIGN_Y,W,32))
for i,label in enumerate(["医師","薬剤師（監査）","看護師"]):
    x=L+W/3*i
    if i>0: items.append(line(x,SIGN_Y,x,SIGN_Y+32))
    items.append(text(x+4,SIGN_Y+3,W/3-8,10,label,7.5))
    items.append(text(x+4,SIGN_Y+18,W/3-8,10,"　　　　　　　　　　　　　　印",8))
items.append(block("page_no",R-60,816,60,10,7,"right"))
json.dump(doc("化学療法実施計画書",items),open("lib/report_layouts/regimen_plan.tlf","w"),ensure_ascii=False,indent=2)

# ---- 化学療法スケジュール表(患者向け) ----
# 月の暦。マスの中はクールと Day、その日にすること(点滴・内服)と休薬。
items=[text(L,26,W,22,"治療スケジュール表",17,True,"center"),
       block("pt_name",L,58,300,16,13,bold=True), block("printed_on",381,62,180.3,10,8,"right"),
       block("regimen_line",L,78,W,12,10), block("month_label",L,96,W,18,14,bold=True,align="center")]
GRID_Y=120.0; HEAD_H=14.0; CELL_W=W/7; CELL_H=86.0; WEEKS=6
items.append(rect(L,GRID_Y,W,HEAD_H+CELL_H*WEEKS))
items.append(line(L,GRID_Y+HEAD_H,R,GRID_Y+HEAD_H))
for c,label in enumerate(["日","月","火","水","木","金","土"]):
    x=L+CELL_W*c
    if c>0: items.append(line(x,GRID_Y,x,GRID_Y+HEAD_H+CELL_H*WEEKS))
    items.append(text(x,GRID_Y+2.5,CELL_W,10,label,9,True,"center"))
for r in range(WEEKS):
    y=GRID_Y+HEAD_H+CELL_H*r
    if r>0: items.append(line(L,y,R,y))
    for c in range(7):
        x=L+CELL_W*c
        items.append(block(f"d{r}{c}",x+3,y+2,CELL_W-6,11,10,bold=True))
        items.append(block(f"c{r}{c}",x+3,y+14,CELL_W-6,CELL_H-16,7.5,lh=9.5))
FOOT=GRID_Y+HEAD_H+CELL_H*WEEKS+10
items+= [text(L,FOOT,80,10,"メモ",8), rect(L,FOOT+11,W,40),
         text(L,FOOT+58,140,10,"体調の変化があったときの連絡先",8),
         block("contact",L,FOOT+70,W,12,10),
         block("page_no",R-60,816,60,10,7,"right")]
json.dump(doc("化学療法スケジュール表",items),open("lib/report_layouts/regimen_schedule.tlf","w"),ensure_ascii=False,indent=2)
# ---- 外部公開用のレジメン ----
# 患者情報を持たない。上段 = レジメンの属性(2 列 × 4 行)、中段 = 適応疾患・投与内容・基準・副作用を
# 見出しごとに流す list、下段 = 問い合わせ先。
items=[text(L,26,W,20,"がん化学療法レジメン",16,True,"center"),
       block("hospital_name",381,30,180.3,10,8,"right"), block("printed_on",381,42,180.3,10,8,"right"),
       block("regimen_title",L,52,W,16,13,bold=True,overflow="fit")]
TOP=74.0
rows=[("コード","regimen_code","診療科","department"),("治療目的","purpose","実施区分","setting"),
      ("1 クール","cycle_rule","クール数","planned_cycles"),("制吐リスク","emetic_risk","承認日","approved_on")]
items.append(rect(L,TOP,W,ROW*len(rows))); items.append(line(MID,TOP,MID,TOP+ROW*len(rows)))
for i,(l1,b1,l2,b2) in enumerate(rows):
    y=TOP+ROW*i
    if i>0: items.append(line(L,y,R,y))
    items.append(text(L+4,y+4,LW-4,10,l1,8))
    items.append(block(b1,L+LW,y+3.5,W/2-LW-4,11,9,overflow="fit"))
    items.append(text(MID+4,y+4,LW-4,10,l2,8))
    items.append(block(b2,MID+LW,y+3.5,W/2-LW-4,11,9,overflow="fit"))
LIST_Y=TOP+ROW*len(rows)+10; LIST_H=792.0-LIST_Y
# 行の種類: 見出し(section)/ 投与ステップ(step)/ 用法(usage)/ 列名(h_*)/ 薬剤(role・name・basis・max)/
# 注記(note)/ 本文(body)。投与内容が詰まって見えないよう、行の高さは実施計画書より広く取る。
PUB_DETAIL=15.0
detail_y=LIST_Y
detail_items=[block("section",L,detail_y+2,W,11,10,bold=True),
              block("step",L+10,detail_y+2.5,W-12,11,9.5,bold=True),
              block("usage",L+20,detail_y+3,W-22,10,8.5),
              block("body",L+20,detail_y+3,W-22,10,8.5),
              block("note",L+66,detail_y+3.5,W-68,10,7.5),
              block("role",L+20,detail_y+3,44,10,8.5),
              block("name",L+66,detail_y+3,270,10,8.5,overflow="fit"),
              block("basis",L+340,detail_y+3,90,10,8.5,"right"),
              block("max",L+434,detail_y+3,89,10,8.5,"right"),
              block("h_role",L+20,detail_y+4,44,9,7.5),
              block("h_name",L+66,detail_y+4,270,9,7.5),
              block("h_basis",L+340,detail_y+4,90,9,7.5,"right"),
              block("h_max",L+434,detail_y+4,89,9,7.5,"right")]
items.append({"id":"content","type":"list","display":True,"description":"","x":L,"y":LIST_Y,"width":W,"height":LIST_H,
              "content-height":LIST_H,"auto-page-break":False,
              "header":section(0,[],False),"detail":section(PUB_DETAIL,detail_items),
              "page-footer":section(0,[],False),"footer":section(0,[],False)})
items+= [line(L,800,R,800), text(L,804,60,10,"問い合わせ先",7.5), block("contact",L+60,803.5,360,10,8),
         block("page_no",R-60,816,60,10,7,"right")]
json.dump(doc("がん化学療法レジメン",items),open("lib/report_layouts/regimen_public.tlf","w"),ensure_ascii=False,indent=2)
print("generated")
