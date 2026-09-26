module Master
  # 放射線検査の実施入力用データセット。実施入力で登録する手技料・造影剤・器材の
  # 組み合わせに名前を付けたもの。撮影項目マスタからは master_rad_items.dataset_code で
  # 参照する(1項目1データセット / 1データセットは複数項目から使い回せる)。
  # 別マスタにしている理由は migration のコメントを参照。
  class RadDataset < ApplicationRecord
    self.table_name = "master_rad_datasets"

    include DatasetModel
  end
end
