module Master
  # JJ1017 の代表的頻用コード集(別表F)。放射線オーダー項目マスタの初期データを
  # 一括生成する種にする。取込で全件洗い替えするため画面からは編集しない。
  class RadJj1017FrequentCode < ApplicationRecord
    self.table_name = "master_rad_jj1017_frequent_codes"

    # 別表F のシート区分。
    CATEGORIES = %w[rad_exam ultrasound radiotherapy].freeze

    validates :category, inclusion: { in: CATEGORIES }
    validates :jj1017_code, presence: true,
                            length: { is: Jj1017Code::CODE_LENGTH },
                            uniqueness: { scope: :category }
    validates :name, presence: true

    before_save :set_search_columns

    # 32桁コードを要素コードの Hash に分解する。
    def elements
      Jj1017Code.decompose(jj1017_code)
    end

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
    end
  end
end
