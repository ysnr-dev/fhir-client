module Master
  # レセプト電算のコメントマスター(c_ALL*.csv)の写し。医事会計へ送るコメントのコードと
  # 形式(パターン)を引くために使う。手動メンテはしない(配布ファイルの全置換)。
  #
  # パターンはコメントコードの 2〜3 桁目と同じで、値の入れ方を表す:
  #   10 フリー(810000001)/ 20 選択式(コードだけ)/ 30・31 文字を続ける / 40・42 数値 /
  #   50〜53 年月日・時刻・時間 / 80 系 / 90。
  class Comment < ApplicationRecord
    self.table_name = "master_comments"

    NOT_ABOLISHED = "99999999".freeze

    validates :comment_code, presence: true, uniqueness: true

    scope :active, -> { where(abolished_on: [nil, "", NOT_ABOLISHED]) }

    before_save :set_search_columns

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
