module Master
  # JJ1017 の部品コード(手技・部位・体位・撮影方向など)。要素名(element)で
  # どの別表のコードかを区別し、1テーブルにまとめて持つ。
  # 桁数・使用可能文字・施設拡張の範囲は Master::Jj1017Code が定義する。
  class RadJj1017Code < ApplicationRecord
    self.table_name = "master_rad_jj1017_codes"

    OFFICIAL = "official".freeze
    LOCAL = "local".freeze
    SOURCES = [OFFICIAL, LOCAL].freeze

    validates :element, inclusion: { in: Jj1017Code::ELEMENT_NAMES }
    validates :code, presence: true, uniqueness: { scope: :element }
    validates :name, presence: true
    validates :source, inclusion: { in: SOURCES }
    validate :code_format_is_valid
    validate :code_is_within_extension_range, if: -> { source == LOCAL }

    before_save :set_search_columns

    scope :official, -> { where(source: OFFICIAL) }
    scope :local, -> { where(source: LOCAL) }

    def official?
      source == OFFICIAL
    end

    private

    def code_format_is_valid
      return if element.blank? || !Jj1017Code.element?(element) || code.blank?
      return if Jj1017Code.valid_code_format?(element, code)

      errors.add(:code, "は#{Jj1017Code.length_of(element)}桁の数字・英大文字(I と O を除く)で入力してください")
    end

    # 施設拡張コードは、指針が施設用に空けている範囲にしか作らせない。
    # 標準コードとの重複自体は (element, code) の一意制約が弾くが、JJ1017 側が
    # 将来のコードを追加する帯に踏み込むと、後の版で衝突するため事前に止める。
    def code_is_within_extension_range
      return if element.blank? || !Jj1017Code.element?(element) || code.blank?
      return unless Jj1017Code.valid_code_format?(element, code)

      spec = Jj1017Code::ELEMENTS.fetch(element)
      unless Jj1017Code.extension_allowed?(element)
        return errors.add(:code, "は#{spec[:label]}では施設拡張が認められていません")
      end

      if Jj1017Code.reserved_prefix?(element, code)
        return errors.add(:code, "の先頭「#{code[0]}」は JJ1017 が標準コードに割り当て済み・予約済みの範囲です")
      end

      return if Jj1017Code.valid_extension_code?(element, code)

      errors.add(:code, "は施設拡張の範囲(#{spec[:extension_label]})で入力してください")
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize([name, common_name, name_english].compact.join)
    end
  end
end
