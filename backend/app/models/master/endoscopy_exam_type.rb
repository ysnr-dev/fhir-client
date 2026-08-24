module Master
  # 内視鏡の検査種別(上部消化管内視鏡・下部消化管内視鏡・ERCP など)。
  #
  # 生理検査(Master::PhysioExamType)と同じく施設が自由に定義できるマスタで、
  # 内視鏡オーダー項目マスタからは master_endoscopy_items.exam_type_code でコード
  # 参照する(FK は張らない)。加えて JED(Japan Endoscopy Database)の検査種別
  # 4区分との対応(jed_exam_category)を持つ。将来のレポート・JED 出力で、施設採番の
  # 種別コードから JED の区分を機械的に判別するための軸。
  class EndoscopyExamType < ApplicationRecord
    self.table_name = "master_endoscopy_exam_types"

    # JED の検査種別区分。JED 対象外の種別(気管支鏡 など)は blank。
    JED_EXAM_CATEGORIES = %w[upper_gi small_intestine lower_gi ercp].freeze

    validates :exam_type_code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :jed_exam_category, inclusion: { in: JED_EXAM_CATEGORIES }, allow_blank: true
    validate :valid_period_is_ordered

    # 今日使える検査種別(オーダー画面・項目マスタの選択肢に出す対象)。
    scope :active_on, lambda { |date = Date.current|
      where("valid_from IS NULL OR valid_from <= ?", date)
        .where("valid_to IS NULL OR valid_to >= ?", date)
    }

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
