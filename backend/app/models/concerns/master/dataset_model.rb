module Master
  # 実施入力用データセットの共通定義。実施入力で登録する手技料・薬剤・器材の
  # 組み合わせに名前を付けたもので、オーダー項目マスタからは master_*_items.dataset_code で
  # 参照する(1項目1データセット / 1データセットは複数項目から使い回せる)。
  module DatasetModel
    extend ActiveSupport::Concern

    included do
      validates :dataset_code, presence: true, uniqueness: true
      validates :name, presence: true
      validate :valid_period_is_ordered

      # 今日使えるデータセット(実施入力に展開する対象)。
      scope :active_on, lambda { |date = Date.current|
        where("valid_from IS NULL OR valid_from <= ?", date)
          .where("valid_to IS NULL OR valid_to >= ?", date)
      }

      before_save :set_search_columns
    end

    private

    def valid_period_is_ordered
      return if valid_from.blank? || valid_to.blank? || valid_from <= valid_to

      errors.add(:valid_to, "は運用開始日以降の日付にしてください")
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
