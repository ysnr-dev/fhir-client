module Master
  # 生理検査の実施入力用データセット。実施入力で登録する手技料・薬剤・器材の
  # 組み合わせに名前を付けたもの。生理検査項目マスタからは
  # master_physio_items.dataset_code で参照する
  # (1項目1データセット / 1データセットは複数項目から使い回せる)。
  # 別マスタにしている理由は migration のコメントを参照。
  class PhysioDataset < ApplicationRecord
    self.table_name = "master_physio_datasets"

    include DatasetModel
  end
end
