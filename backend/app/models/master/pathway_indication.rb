module Master
  # パスの対象病名。病名マスタの管理番号で参照し、名称と ICD10 は表示用に写す。
  class PathwayIndication < ApplicationRecord
    self.table_name = "master_pathway_indications"

    validates :pathway_code, presence: true
    validates :management_number, presence: true
    validates :name, presence: true

    scope :in_display_order, -> { order(Arel.sql("display_order NULLS LAST")).order(:id) }
  end
end
