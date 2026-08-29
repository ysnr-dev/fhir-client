module Master
  # MEDIS 看護実践用語標準マスター(看護行為編)。取込で洗い替える読み取り専用。
  class NursingAct < ApplicationRecord
    self.table_name = "master_nursing_acts"

    # 変更区分のうち削除を表すもの(1=今版削除 / 2=既削除)。移行先管理番号を持つ行
    # (別の用語へ統合された)も含めて、取込時に active=false にする。
    DELETED_CHANGE_CATEGORIES = %w[1 2].freeze

    def self.active_row?(change_category, successor)
      !DELETED_CHANGE_CATEGORIES.include?(change_category) && successor.blank?
    end

    scope :active, -> { where(active: true) }
  end
end
