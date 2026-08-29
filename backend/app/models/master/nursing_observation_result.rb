module Master
  # 看護観察編の観察結果テーブル。列挙型の選択肢をグループコードでまとめたもの。
  class NursingObservationResult < ApplicationRecord
    self.table_name = "master_nursing_observation_results"
  end
end
