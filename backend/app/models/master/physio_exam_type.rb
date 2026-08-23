module Master
  # 生理検査の検査種別(心電図・超音波検査・呼吸機能検査 など)。
  #
  # 放射線検査では JJ1017 の「種別(モダリティ)」がこの役割を担っていたが、
  # 生理検査は JJ1017 に収載されておらず標準コード体系が無いので、施設が自由に
  # 定義できるマスタとして持つ。生理検査項目マスタからは
  # master_physio_items.exam_type_code でコード参照する(FK は張らない)。
  class PhysioExamType < ApplicationRecord
    self.table_name = "master_physio_exam_types"

    validates :exam_type_code, presence: true, uniqueness: true
    validates :name, presence: true
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
