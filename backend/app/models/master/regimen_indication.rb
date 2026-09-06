module Master
  # レジメンの適応疾患。病名マスタの管理番号で参照し、名称と ICD10 は表示用に写す。
  class RegimenIndication < ApplicationRecord
    self.table_name = "master_regimen_indications"

    validates :regimen_code, presence: true
    validates :management_number, presence: true
    validates :name, presence: true

    scope :in_display_order, -> { order(Arel.sql("display_order NULLS LAST")).order(:id) }
  end
end
