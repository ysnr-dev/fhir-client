module Master
  # 検体検査オーダー項目。医師がオーダー画面で選ぶ単位の検査項目で、
  # パネルの構成は master_lab_panel_items が持つ。
  # 検体・採取管はコードで master_lab_specimens / master_lab_containers に緩く紐づく。
  class LabOrderItem < ApplicationRecord
    self.table_name = "master_lab_order_items"

    KINDS = %w[single panel].freeze
    JLAC_CODE_SYSTEMS = %w[jlac10 jlac11].freeze
    EXECUTION_TYPES = %w[in_house outsourced].freeze

    validates :order_item_code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :kind, inclusion: { in: KINDS }
    validates :jlac_code_system, inclusion: { in: JLAC_CODE_SYSTEMS }, allow_blank: true
    validates :execution_type, inclusion: { in: EXECUTION_TYPES }, allow_blank: true
    validate :valid_period_is_ordered

    before_save :set_search_columns

    private

    def valid_period_is_ordered
      return if valid_from.blank? || valid_to.blank? || valid_from <= valid_to

      errors.add(:valid_to, "は有効開始日以降の日付にしてください")
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_short_name = SearchNormalizer.normalize(short_name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
