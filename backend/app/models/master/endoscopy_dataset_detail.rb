module Master
  # 内視鏡の実施入力用データセットの明細。定義の本体は DatasetDetailModel
  # (生理検査・処置と同型)。止血クリップ等の特定保険医療材料が実在するので、
  # 算定コードを直接参照する構成が活きる。
  class EndoscopyDatasetDetail < ApplicationRecord
    self.table_name = "master_endoscopy_dataset_details"
    include Master::DatasetDetailModel
  end
end
