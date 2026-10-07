# 患者フォルダに登録した患者 1 人。同じ患者を別々のフォルダに入れてよいが、同じフォルダには 1 回だけ。
class PatientFolderMember < ApplicationRecord
  belongs_to :patient_folder

  validates :patient_id, presence: true, uniqueness: { scope: :patient_folder_id, message: "はすでにこのフォルダに登録されています" }
  validates :note, length: { maximum: 200 }
end
