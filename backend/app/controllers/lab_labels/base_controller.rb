module LabLabels
  # 検体ラベルの台帳(発行・到着状況)のプレーン JSON ベース(docs/lab-arrival-design.md §3)。
  # FHIR リソースではないので ApplicationController とは分ける(master と同じ考え方)。
  # 認証は /fhir・/reports と同水準(ログインセッション。ADMIN_TOKEN 未設定なら認証なし)。
  class BaseController < ActionController::API
    include UserAuthentication

    before_action :authorize_user!
    before_action :verify_user_csrf!

    rescue_from ActiveRecord::RecordNotFound do
      render json: { error: "unknown_number" }, status: :not_found
    end

    private

    def record_json(record)
      {
        label_number: record.label_number,
        order_fhir_id: record.order_fhir_id,
        specimen_code: record.specimen_code,
        container_code: record.container_code,
        issued_at: record.created_at.iso8601,
        arrived_at: record.arrived_at&.iso8601,
        arrived_by: record.arrived_by
      }
    end
  end
end
