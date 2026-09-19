# 取り込んだ DICOM の 1 インスタンス。実体(.dcm のバイト列)は Active Storage、
# 上流の ImagingStudy はこの行の集まりから ImagingStudyBuilder が組み立てる
# (docs/imaging-design.md)。
class DicomInstance < ApplicationRecord
  UID_FORMAT = /\A[0-9]+(\.[0-9]+)*\z/
  UID_MAX_LENGTH = 64

  has_one_attached :file

  # 取込元(他院)の患者名・患者番号。検索には使わない。
  encrypts :source_patient_id
  encrypts :source_patient_name

  validates :patient_id, presence: true
  validates :sop_instance_uid, :study_instance_uid, :series_instance_uid, :sop_class_uid,
            presence: true, length: { maximum: UID_MAX_LENGTH }, format: { with: UID_FORMAT }
  validates :sop_instance_uid, uniqueness: true

  scope :of_study, ->(patient_id, study_uid) {
    where(patient_id: patient_id, study_instance_uid: study_uid)
  }
  # シリーズ番号 → インスタンス番号の順。番号の無いものは後ろに寄せ、UID で安定させる。
  scope :in_display_order, -> {
    order(Arel.sql("series_number NULLS LAST, series_instance_uid, instance_number NULLS LAST, sop_instance_uid"))
  }

  def self.valid_uid?(value)
    value.is_a?(String) && value.length <= UID_MAX_LENGTH && UID_FORMAT.match?(value)
  end
end
