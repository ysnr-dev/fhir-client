module Master
  # 処置の実施入力用データセット。実施入力で登録する手技料・薬剤・器材の
  # 組み合わせに名前を付けたもの。処置オーダー項目マスタからは
  # master_treatment_items.dataset_code で参照する
  # (1項目1データセット / 1データセットは複数項目から使い回せる)。
  # 別マスタにしている理由は migration のコメントを参照。
  class TreatmentDataset < ApplicationRecord
    self.table_name = "master_treatment_datasets"

    include DatasetModel
  end
end
