module Imaging
  # 取り込んだ DICOM(docs/imaging-design.md)のプレーン JSON / バイナリ エンドポイント。
  # 実体はこの backend の Active Storage にあり、上流には ImagingStudy だけを置く。
  # 認証は /fhir プロキシと同水準(ログインセッション。ADMIN_TOKEN 未設定ならなし)。
  class BaseController < ActionController::API
    include UserAuthentication

    before_action :authorize_user!
    before_action :verify_user_csrf!

    rescue_from ActiveRecord::RecordNotFound do
      render json: { error: "not_found" }, status: :not_found
    end

    rescue_from ImagingStudyPublisher::UpstreamError, Faraday::ConnectionFailed, Faraday::TimeoutError do
      render json: { error: "upstream_unreachable" }, status: :bad_gateway
    end

    rescue_from FhirTokenProvider::TokenError do
      render json: { error: "upstream_authentication_failed" }, status: :bad_gateway
    end

    private

    def patient_id!
      value = (params[:patient].presence || params[:patient_id].presence).to_s
      raise ActiveRecord::RecordNotFound if value.blank?

      value
    end
  end
end
