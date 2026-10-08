module Dpc
  # 診断群分類の判定の入力。様式1 の値(画面から)と、入院期間の実施記録(Dpc::PerformedItems)。
  #
  # 未入力は nil。nil の分岐は「未確定」になり、変換テーブルでは問わない扱いで候補を広げる。
  Input = Struct.new(
    :icd10,              # 医療資源を最も投入した傷病名
    :comorbidity_icd10s, # 併存症・続発症(定義副傷病の判定)
    :age,                # 入院時の満年齢
    :month_age,          # 入院時の月齢
    :birth_weight,       # 出生時体重(g)
    :jcs,                # 入院時の JCS(数値)
    :burn_index,
    :gaf,
    :pregnancy_weeks,    # 入院時の妊娠週数
    :delivery_bleeding,  # 分娩時出血量(mL)
    :pneumonia_category, # 院内肺炎 3 / 市中肺炎 5 / 肺炎以外 8
    :adrop,              # A-DROP スコア(0〜5)
    :stroke_onset,       # 脳卒中の発症時期(1 発症3日目以内 〜 4 無症候性)
    :child_pugh,         # Child-Pugh の合計点(5〜15)
    :pancreatitis_a,     # 急性膵炎の予後因子スコア
    :pancreatitis_b,     # 急性膵炎の造影 CT Grade(8 CT のみ不明 / 9 不明)
    :transfer,           # 他の病院・診療所の病棟からの転院
    :bilateral,          # 両側(両眼)の手術
    :reoperation,        # 再手術
    :rehab,              # リハビリの実施
    :radiotherapy,       # 放射線治療の実施
    :items,              # 実施した手術・処置・薬剤(Dpc::Item)
    :overrides,          # 人の上書き(Dpc::Overrides)
    keyword_init: true
  ) do
    def items = self[:items] || []
    def comorbidity_icd10s = self[:comorbidity_icd10s] || []
    def overrides = self[:overrides] || Overrides.new
  end
end
