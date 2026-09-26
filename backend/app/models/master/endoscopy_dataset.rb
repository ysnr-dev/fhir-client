module Master
  # 内視鏡の実施入力用データセット。実施入力で登録する手技料・薬剤・器材の
  # 組み合わせに名前を付けたもの。内視鏡オーダー項目マスタからは
  # master_endoscopy_items.dataset_code で参照する
  # (1項目1データセット / 1データセットは複数項目から使い回せる)。
  # 別マスタにしている理由は migration のコメントを参照。
  class EndoscopyDataset < ApplicationRecord
    self.table_name = "master_endoscopy_datasets"

    include DatasetModel
  end
end
