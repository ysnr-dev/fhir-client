module Master
  # 検体検査の結果項目(施設マスタ)。検査結果として返ってくる単位で、
  # データ型・単位・選択肢など結果値を表現するための属性を持つ。
  # オーダー項目(LabOrderItem)との対応は LabOrderItemResult が持つ。
  # JLAC11 / JLAC10 / LOINC は任意の属性で、Observation.code に併記する。
  class LabResultItem < ApplicationRecord
    self.table_name = "master_lab_result_items"

    DATA_TYPES = %w[PQ CD CO ST].freeze

    validates :result_item_code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :data_type, inclusion: { in: DATA_TYPES }
    validate :valid_period_is_ordered

    before_save :set_search_columns

    # 材料名(master_lab_specimens.name)を添えた JSON。対応表(LabOrderItemResult)に入れ子で
    # 返すときに使う。一覧 API は JOIN で添えるが、入れ子には JOIN が効かないのでまとめて引く。
    def self.as_json_with_specimen_names(items)
      codes = items.map(&:specimen_code).compact.uniq
      names = codes.empty? ? {} : Master::LabSpecimen.where(specimen_code: codes).pluck(:specimen_code, :name).to_h
      items.map { |item| item.as_json.merge("specimen_name" => names[item.specimen_code]) }
    end

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
