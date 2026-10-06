# 指導医グループ。研修医・学生(trainee)と、その記録・オーダーをカウンターサインする
# 指導医(supervisor)の組。指導医が不在でも同じグループの別の指導医が承認できるように、
# 1 人ずつではなくグループで持つ(docs/countersign-design.md)。
class SupervisorGroup < ApplicationRecord
  has_many :members, -> { order(:role, :id) }, class_name: "SupervisorGroupMember",
                                                dependent: :destroy, inverse_of: :group

  validates :name, presence: true, uniqueness: true

  # その人が研修医として属するグループの指導医(重複なし)。
  def self.supervisors_of(practitioner_fhir_id)
    members_across(practitioner_fhir_id, as: "trainee", pick: "supervisor")
  end

  # その人が指導医として受け持つ研修医(重複なし)。
  def self.trainees_of(practitioner_fhir_id)
    members_across(practitioner_fhir_id, as: "supervisor", pick: "trainee")
  end

  def self.members_across(practitioner_fhir_id, as:, pick:)
    group_ids = SupervisorGroupMember.where(practitioner_fhir_id: practitioner_fhir_id, role: as)
                                     .select(:supervisor_group_id)
    SupervisorGroupMember.where(supervisor_group_id: group_ids, role: pick)
                         .order(:practitioner_fhir_id, :id)
                         .uniq(&:practitioner_fhir_id)
  end
  private_class_method :members_across
end
