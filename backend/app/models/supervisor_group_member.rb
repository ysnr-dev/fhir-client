# 指導医グループの構成員 1 人。指導医(supervisor)か研修医・学生(trainee)。
class SupervisorGroupMember < ApplicationRecord
  ROLES = %w[supervisor trainee].freeze

  belongs_to :group, class_name: "SupervisorGroup", foreign_key: :supervisor_group_id, inverse_of: :members

  validates :practitioner_fhir_id, presence: true, uniqueness: { scope: :supervisor_group_id }
  validates :role, inclusion: { in: ROLES }

  def as_json(options = nil)
    super({ only: %i[id supervisor_group_id practitioner_fhir_id display_name role] }.merge(options || {}))
  end
end
