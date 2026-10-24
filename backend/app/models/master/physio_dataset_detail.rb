module Master
  # 生理検査の実施入力用データセットの明細。定義の本体は DatasetDetailModel
  # (内視鏡・処置と同型)。生理検査で個別算定できる特定器材はほとんど無い。
  class PhysioDatasetDetail < ApplicationRecord
    self.table_name = "master_physio_dataset_details"
    include Master::DatasetDetailModel
  end
end
