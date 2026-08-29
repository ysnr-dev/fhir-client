module Master
  # 術式の種別(分類)。医科点数表 第2章第10部 手術 第1節の「款 → 区分」のように
  # 入れ子になる分類を、parent_code の自己参照 1 テーブルで表す。
  # 術式マスタからは master_surgery_items.category_code でコード参照する(FK は張らない)。
  class SurgeryCategory < ApplicationRecord
    self.table_name = "master_surgery_categories"

    # 親をたどる回数の上限。循環は検証で弾いているが、データ移行などで壊れた行が
    # 入っても無限ループにしないための歯止め。
    MAX_DEPTH = 10

    validates :category_code, presence: true, uniqueness: true
    validates :name, presence: true
    validate :valid_period_is_ordered
    validate :parent_exists
    validate :parent_is_not_circular

    # 今日使える分類(オーダー画面・術式マスタの選択肢に出す対象)。
    scope :active_on, lambda { |date = Date.current|
      where("valid_from IS NULL OR valid_from <= ?", date)
        .where("valid_to IS NULL OR valid_to >= ?", date)
    }

    before_save :set_search_columns

    # 指定コードとその配下すべての分類コード。上位の分類で絞り込んだときに、
    # 下にぶら下がる分類の術式もまとめて出すために使う。
    def self.subtree_codes(code)
      return [] if code.blank?

      sql = sanitize_sql_array([<<~SQL, { code: code, max_depth: MAX_DEPTH }])
        WITH RECURSIVE tree(category_code, depth) AS (
          SELECT category_code, 1 FROM master_surgery_categories WHERE category_code = :code
          UNION ALL
          SELECT c.category_code, tree.depth + 1
            FROM master_surgery_categories c
            JOIN tree ON c.parent_code = tree.category_code
           WHERE tree.depth < :max_depth
        )
        SELECT category_code FROM tree
      SQL
      connection.select_values(sql)
    end

    # 最上位からこの分類までの名称("腹部 > 胃、食道、腸、他")。
    def path_name(separator = " > ")
      names = [name]
      code = parent_code
      MAX_DEPTH.times do
        break if code.blank?

        parent = self.class.find_by(category_code: code)
        break if parent.nil?

        names.unshift(parent.name)
        code = parent.parent_code
      end
      names.join(separator)
    end

    private

    def valid_period_is_ordered
      return if valid_from.blank? || valid_to.blank? || valid_from <= valid_to

      errors.add(:valid_to, "は有効開始日以降の日付にしてください")
    end

    def parent_exists
      return if parent_code.blank?

      if parent_code == category_code
        errors.add(:parent_code, "に自分自身は指定できません")
      elsif !self.class.exists?(category_code: parent_code)
        errors.add(:parent_code, "の分類がありません")
      end
    end

    # 自分の子孫を親に指定すると輪ができて一覧が組み立てられなくなるので弾く。
    def parent_is_not_circular
      return if parent_code.blank? || category_code.blank?
      return if errors[:parent_code].any?

      errors.add(:parent_code, "に配下の分類は指定できません") if
        self.class.subtree_codes(category_code).include?(parent_code)
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
