import json, sys
# 注射箋(A5)と注射ラベル(60x40mm)の .tlf を生成する。処方箋(院内)と同じスタイル値。
FONT=["IPAGothic"]
def text(x,y,w,h,s,size=9,bold=False,align="left",id=""):
    return {"id":id,"type":"text","display":True,"description":"","x":x,"y":y,"width":w,"height":h,"texts":[s],
            "style":{"font-family":FONT,"font-size":size,"font-style":["bold"] if bold else [],"color":"#000000",
                     "text-align":align,"vertical-align":"top","letter-spacing":"","line-height":"","line-height-ratio":""}}
def block(id,x,y,w,h,size=9,align="left",lh=""):
    return {"id":id,"type":"text-block","display":True,"description":"","x":x,"y":y,"width":w,"height":h,"value":"",
            "multiple-line":bool(lh),"format":{"base":"","type":""},
            "style":{"font-family":FONT,"font-size":size,"font-style":[],"color":"#000000","text-align":align,
                     "vertical-align":"top","letter-spacing":"","line-height":lh,"line-height-ratio":"","overflow":"truncate","word-wrap":"none"}}
def rect(x,y,w,h):
    return {"id":"","type":"rect","display":True,"description":"","x":x,"y":y,"width":w,"height":h,"border-radius":0,
            "style":{"border-color":"#000000","border-width":0.5,"border-style":"solid","fill-color":"none"}}
def line(x1,y1,x2,y2):
    return {"id":"","type":"line","display":True,"description":"","x1":x1,"y1":y1,"x2":x2,"y2":y2,
            "style":{"border-color":"#000000","border-width":0.5,"border-style":"solid"}}
def image(id,x,y,w,h):
    return {"id":id,"type":"image-block","display":True,"description":"","x":x,"y":y,"width":w,"height":h,
            "style":{"position-x":"center","position-y":"middle"}}
def doc(title,w,h,items):
    return {"version":"0.11.0","title":title,"report":{"paper-type":"user","width":w,"height":h,"orientation":"portrait","margin":[0,0,0,0]},
            "state":{"layout-guides":[]},"items":items}

# ---- 注射箋 (A5 419.53 x 595.28) ----
L,W=17.0,385.5; MID=210.0
items=[text(L,16,W,18,"注射箋（注射指示票）",15,True,"center")]
items+= [rect(L,42,W,72), line(MID,42,MID,114), line(L,60,L+W,60), line(L,78,L+W,78), line(L,96,L+W,96)]
rows=[("患者番号","pt_id","注射日","issue_date"),("氏　名",None,"区　分","rx_category"),("生年月日","pt_birthdate","性　別","pt_gender"),("病　棟","ward_name","依頼科|医師","doctor_line")]
for i,(l1,b1,l2,b2) in enumerate(rows):
    y=47+18*i
    items.append(text(L,y,58,10,l1))
    if b1: items.append(block(b1,79.0,y-1,127.0,12))
    else:
        items.append(block("pt_kana",79.0,y-3.5,127.0,5,4.5)); items.append(block("pt_name",79.0,y+2,127.0,10))
    items.append(text(MID,y,58,10,l2)); items.append(block(b2,272.0,y-1,126.5,12))
items.append(block("series_label",L,117,200,10,8))
items.append(text(L+200,117,185.5,10,"※連日オーダーはこの日の分のみ",6,align="right"))
items+= [rect(L,128,W,290.0), block("rx_content",23.0,134,373.5,276.0,9,lh=12), text(247.5,404.0,145,10,"（次頁に続く）",id="continued")]
# 実施記録欄: 病棟が時刻・実施者を手書きする。指示票を兼ねる理由。
items+= [text(L,423,120,10,"実施記録（時刻・実施者）",8), rect(L,434,W,52), line(MID,434,MID,486), line(L,460,L+W,460)]
for (x,y) in [(L,438),(MID,438),(L,464),(MID,464)]:
    items.append(text(x+3,y,190,10,"　　:　　　　実施者　　　　　　　　　印",7))
items+= [text(L,491,60,10,"備考",8), rect(L,501,W,34), block("remarks",23.0,505,373.5,26,8),
         block("hospital_name",L,542.0,250,12,8), block("page_no",342.5,544.0,60,8,6,"right")]
json.dump(doc("注射箋",419.53,595.28,items),open("lib/report_layouts/injection_order.tlf","w"),ensure_ascii=False,indent=2)

# ---- 注射ラベル (60x40mm = 170.1 x 113.4) ----
# 上段は患者番号、その下に RP バーコード(INJ-{オーダー id 先頭 12 桁}-{RP 番号})を横長に置く。
# 3点認証でベッドサイドの照合に読む。直下の文字列は読めないときの目視用。
# 2 本のバーコードの間と RP の左右は、リーダーが隣を拾わないよう余白(クワイエットゾーン)を空ける。
items=[image("barcode_img",8,2,114,13), text(128,3,36,14,"至急",11,True,id="urgent"),
       image("rp_barcode_img",10,20,150,14), block("rp_barcode_text",5,35,160,6,5,"center"),
       block("rp_label",8,41,114,8,7,"center"),
       block("pt_id",5,50,40,11,9), block("pt_kana",48,50,117,11,9),
       block("pt_name",5,61,100,11,9), block("pt_birthdate",108,62,40,10,7), block("pt_gender",150,62,18,10,7),
       block("medicines",5,72,160,28,6.5,lh=7),
       # 用法は 1 行に収まるよう幅いっぱい。注射日は RP 行の右端に置く。
       # 最下段はレジメン名(化学療法のときだけ入る。それ以外は空行になる)。
       block("usage",5,100,160,7,6), block("regimen",5,107,160,6,5.5),
       block("order_date",125,41,42,8,6,"right")]
json.dump(doc("注射ラベル",170.1,113.4,items),open("lib/report_layouts/injection_label.tlf","w"),ensure_ascii=False,indent=2)
print("generated")
