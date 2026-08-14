module Master
  # 撮影項目マスタと実施入力用データセットの紐付け(多対多)。
  # master_rad_set_items と同じく、FK は張らずコードで持つ。
  class RadItemDataset < ApplicationRecord
    self.table_name = "master_rad_item_datasets"

    validates :item_code, presence: true
    validates :dataset_code, presence: true, uniqueness: { scope: :item_code }
  end
end
