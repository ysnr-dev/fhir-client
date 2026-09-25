# 患者ごとにマルチチャートで最初に開くチャート(ピン留め)。患者につき 1 つで、利用者の間で共有する。
# 別のチャートをピン留めすると置き換わる(前のピンは外れる)。
class PatientChartPin < ApplicationRecord
  belongs_to :chart_definition

  validates :patient_id, presence: true, uniqueness: true
end
