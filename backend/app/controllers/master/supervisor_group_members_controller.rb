module Master
  # 指導医グループの構成員。追加・役割の変更・削除だけで、一覧はグループ側が返す。
  class SupervisorGroupMembersController < BaseController
    before_action :set_record, only: %i[update destroy]

    private

    def model_class = SupervisorGroupMember

    def record_params
      params.permit(:supervisor_group_id, :practitioner_fhir_id, :display_name, :role)
    end
  end
end
