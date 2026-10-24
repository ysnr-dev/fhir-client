module Master
  # 処置の実施入力用データセットの明細。定義の本体は DatasetDetailModel
  # (生理検査・内視鏡と同型)。
  class TreatmentDatasetDetail < ApplicationRecord
    self.table_name = "master_treatment_dataset_details"
    include Master::DatasetDetailModel
  end
end
