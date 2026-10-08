module Dpc
  # 薬剤の属性(医薬品マスタ)。dosage_form は 1 内用 / 4 注射 / 6 外用。
  Medicine = Struct.new(:code, :name, :generic_name, :basic_name, :dosage_form, :yj_code, keyword_init: true)
end
