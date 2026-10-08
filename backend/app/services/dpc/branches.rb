module Dpc
  # 診断群分類(14 桁)を決める分岐。変換テーブル(12)の列と、条件シート(5・10)の
  # 条件区分をここで同じキーにそろえる。
  module Branches
    # 14 桁の並び: MDC(2) 分類(4) 病態等(1) 年齢等(1) 手術(2) 処置1(1) 処置2(1) 副傷病(1) 重症度(1)
    AGE_GROUP_KEYS = %w[age month_age weight jcs burn_index gaf pregnancy_weeks delivery_bleeding].freeze
    SEVERITY_KEYS = %w[
      sev_age sev_jcs sev_bilateral sev_reoperation sev_eye sev_side sev_rehab sev_pancreatitis
      sev_rankin sev_adrop sev_transfer sev_stroke_onset sev_child_pugh
    ].freeze
    ITEM_KEYS = %w[surgery proc1 proc2 comorbidity].freeze
    ALL_KEYS = (["pathology"] + AGE_GROUP_KEYS + ITEM_KEYS + SEVERITY_KEYS).freeze

    # 「５）年齢、出生時体重等」の条件区分。
    AGE_GROUP_BY_KIND = {
      "1" => "age", "2" => "jcs", "3" => "weight", "4" => "burn_index",
      "5" => "gaf", "6" => "month_age", "7" => "pregnancy_weeks", "8" => "delivery_bleeding"
    }.freeze

    # 「10）重症度等」の条件区分。急性膵炎は予後因子 A の範囲で 9 と 10 に分かれ、どちらも
    # 変換テーブルでは「軽症 重症」の列になる。
    SEVERITY_BY_KIND = {
      "1" => "sev_age", "2" => "sev_jcs", "4" => "sev_eye", "5" => "sev_side", "6" => "sev_reoperation",
      "7" => "sev_bilateral", "8" => "sev_rehab", "9" => "sev_pancreatitis", "10" => "sev_pancreatitis",
      "11" => "sev_rankin", "12" => "sev_adrop", "13" => "sev_transfer", "14" => "sev_stroke_onset",
      "15" => "sev_child_pugh"
    }.freeze

    # 変換テーブルの見出し(1 行目の親見出し、2 行目の子見出し。空白と全角は詰めて比べる)。
    CONVERSION_COLUMNS = {
      ["病態等分類", nil] => "pathology",
      ["年齢、出生時体重等", "年齢"] => "age",
      ["年齢、出生時体重等", "月齢"] => "month_age",
      ["年齢、出生時体重等", "体重"] => "weight",
      ["年齢、出生時体重等", "JCS"] => "jcs",
      ["年齢、出生時体重等", "BurnIndex"] => "burn_index",
      ["年齢、出生時体重等", "GAF"] => "gaf",
      ["年齢、出生時体重等", "妊娠週数"] => "pregnancy_weeks",
      ["年齢、出生時体重等", "分娩時出血量"] => "delivery_bleeding",
      ["手術", nil] => "surgery",
      ["手術・処置等1", nil] => "proc1",
      ["手術・処置等2", nil] => "proc2",
      ["定義副傷病", nil] => "comorbidity",
      ["重症度等", "年齢"] => "sev_age",
      ["重症度等", "JCS"] => "sev_jcs",
      ["重症度等", "一側両側"] => "sev_bilateral",
      ["重症度等", "初回再手術"] => "sev_reoperation",
      ["重症度等", "片眼両眼"] => "sev_eye",
      ["重症度等", "片側両側"] => "sev_side",
      ["重症度等", "リハビリ"] => "sev_rehab",
      ["重症度等", "軽症重症"] => "sev_pancreatitis",
      ["重症度等", "発症前RankinScale"] => "sev_rankin",
      ["重症度等", "A-DROPスコア"] => "sev_adrop",
      ["重症度等", "他の病院・診療所の病棟からの転院"] => "sev_transfer",
      ["重症度等", "脳卒中の発症時期"] => "sev_stroke_onset",
      ["重症度等", "Child-Pugh分類"] => "sev_child_pugh"
    }.freeze

    LABELS = {
      "pathology" => "病態等分類", "age" => "年齢", "month_age" => "月齢", "weight" => "出生時体重",
      "jcs" => "JCS", "burn_index" => "Burn Index", "gaf" => "GAF", "pregnancy_weeks" => "妊娠週数",
      "delivery_bleeding" => "分娩時出血量", "surgery" => "手術", "proc1" => "手術・処置等1",
      "proc2" => "手術・処置等2", "comorbidity" => "定義副傷病", "sev_age" => "重症度(年齢)",
      "sev_jcs" => "重症度(JCS)", "sev_bilateral" => "一側／両側", "sev_reoperation" => "初回／再手術",
      "sev_eye" => "片眼／両眼", "sev_side" => "片側／両側", "sev_rehab" => "リハビリ",
      "sev_pancreatitis" => "軽症／重症", "sev_rankin" => "発症前Rankin Scale", "sev_adrop" => "A-DROPスコア",
      "sev_transfer" => "他院の病棟からの転院", "sev_stroke_onset" => "脳卒中の発症時期",
      "sev_child_pugh" => "Child-Pugh分類"
    }.freeze

    WILDCARD = "a".freeze
  end
end
