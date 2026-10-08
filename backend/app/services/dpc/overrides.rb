module Dpc
  # 人の上書き。branches は分岐の値、accepted は実施したことにするコード(点数表コード・4 桁の
  # 薬剤コード)、rejected は実施記録・候補から外すコード。
  Overrides = Struct.new(:mdc6, :branches, :accepted, :rejected, keyword_init: true) do
    def branches = self[:branches] || {}
    def accepted = self[:accepted] || []
    def rejected = self[:rejected] || []
  end
end
