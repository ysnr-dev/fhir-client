module Master
  # 放射線オーダー項目。医師がオーダー画面で選ぶ単位の検査項目で、
  # セットの構成は master_rad_set_items が持つ。
  # JJ1017 の各要素はコードで master_rad_jj1017_codes に緩く紐づく。
  class RadItem < ApplicationRecord
    self.table_name = "master_rad_items"

    KINDS = %w[single set].freeze

    # JJ1017 の要素名 → この表の列名。要素の追加・改称を Jj1017Code 側だけで
    # 完結させるため、列名は規則(要素名 + _code)から導く。
    def self.element_column(element)
      :"#{element}_code"
    end

    ELEMENT_COLUMNS = Jj1017Code::ELEMENT_NAMES.to_h { |name| [name, element_column(name)] }.freeze

    validates :item_code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :kind, inclusion: { in: KINDS }
    validate :element_codes_are_valid
    validate :valid_period_is_ordered

    before_save :set_jj1017_code
    before_save :set_search_columns

    def set?
      kind == "set"
    end

    # 要素コードの Hash(未指定の要素は含まない)。
    def element_codes
      ELEMENT_COLUMNS.filter_map do |element, column|
        value = self[column]
        [element, value] if value.present?
      end.to_h
    end

    private

    # 要素から32桁コードを組み立てて保存する。セットは撮影そのものではないので
    # 要素を持たず、コードも作らない。
    def set_jj1017_code
      if set?
        self.jj1017_code = nil
      else
        self.jj1017_code = Jj1017Code.compose(element_codes, generic_extension: generic_extension_code)
      end
    end

    def element_codes_are_valid
      ELEMENT_COLUMNS.each do |element, column|
        value = self[column]
        next if value.blank? || Jj1017Code.valid_code_format?(element, value)

        label = Jj1017Code::ELEMENTS.fetch(element)[:label]
        errors.add(column, "(#{label})は#{Jj1017Code.length_of(element)}桁で入力してください")
      end

      return if generic_extension_code.blank?
      return if generic_extension_code.length == Jj1017Code::GENERIC_EXTENSION_LENGTH

      errors.add(:generic_extension_code, "は#{Jj1017Code::GENERIC_EXTENSION_LENGTH}桁で入力してください")
    end

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
