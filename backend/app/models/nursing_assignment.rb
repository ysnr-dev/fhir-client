# 看護の業務分担 1 件。その日・その勤務帯に患者 1 人を受け持つ看護師。
# 患者 1 人に勤務帯ごと 1 人まで(同じ日・勤務帯で別の病棟から割り付けたら置き換える)。
class NursingAssignment < ApplicationRecord
  # 三交代の勤務帯。区切りの時刻は画面側(fhir/nursingScheduleHelpers.ts の SHIFT_OPTIONS)が持つ。
  SHIFTS = %w[day evening night].freeze

  validates :ward_id, :assigned_on, :patient_id, :practitioner_id, presence: true
  validates :shift, inclusion: { in: SHIFTS }
  validates :patient_id, uniqueness: { scope: %i[assigned_on shift], message: "はこの勤務帯にすでに割り付けられています" }
end
