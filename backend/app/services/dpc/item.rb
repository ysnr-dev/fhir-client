module Dpc
  # 実施した手術・処置(点数表コード)と薬剤。
  # source: performed(実施記録) / form1(様式1 の手術情報)
  Item = Struct.new(:code, :name, :date, :source, :ref, :medicine, keyword_init: true) do
    def medicine? = !medicine.nil?
  end
end
