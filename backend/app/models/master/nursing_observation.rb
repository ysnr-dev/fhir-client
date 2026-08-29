module Master
  # MEDIS 看護実践用語標準マスター(看護観察編)。取込で洗い替える読み取り専用。
  class NursingObservation < ApplicationRecord
    self.table_name = "master_nursing_observations"

    # 1=今版削除 / 2=既削除。7 は管理番号の移行元(移行先あり)で、これも無効。
    DELETED_CHANGE_CATEGORIES = %w[1 2 7].freeze

    def self.active_row?(change_category, successor)
      !DELETED_CHANGE_CATEGORIES.include?(change_category) && successor.blank?
    end
    RESULT_COLUMNS = (1..18).map { |n| :"result_#{n}" }.freeze
    SEARCH_CATEGORY_COLUMNS = (1..8).map { |n| :"search_category_#{n}" }.freeze

    scope :active, -> { where(active: true) }

    # 列挙型の選択肢(空でない結果列)。
    def results
      RESULT_COLUMNS.map { |column| self[column] }.reject(&:blank?)
    end
  end
end
