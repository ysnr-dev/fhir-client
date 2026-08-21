module Reports
  # 帳票出力エンドポイントのプレーン JSON ベース。ApplicationController からは
  # 意図的に分離する(FHIR リソースではないので OperationOutcome を使わない)。
  # 認証は /fhir プロキシと同水準(ログインセッション。ADMIN_TOKEN 未設定なら
  # 従来どおりなし)。同じデータが /fhir 経由で読めるため、水準を揃えておく。
  class BaseController < ActionController::API
    include UserAuthentication

    before_action :authorize_user!
    before_action :verify_user_csrf!

    rescue_from QuestionnaireResponseReport::NotFound do
      render json: { error: "questionnaire_response_not_found" }, status: :not_found
    end

    rescue_from LabLabelReport::NotFound do
      render json: { error: "order_not_found" }, status: :not_found
    end

    rescue_from LabLabelReport::NotLabOrder do
      render json: { error: "not_lab_order" }, status: :unprocessable_content
    end

    rescue_from LabLabelReport::NoLabelTarget do
      render json: { error: "no_label_target" }, status: :unprocessable_content
    end

    rescue_from PrescriptionReport::NotFound do
      render json: { error: "order_not_found" }, status: :not_found
    end

    rescue_from PrescriptionReport::NotPrescriptionOrder do
      render json: { error: "not_prescription_order" }, status: :unprocessable_content
    end

    rescue_from PrescriptionReport::NoMedication do
      render json: { error: "no_prescription_content" }, status: :unprocessable_content
    end

    rescue_from QuestionnaireResponseReport::LayoutNotRegistered do
      render json: { error: "layout_not_registered" }, status: :not_found
    end

    rescue_from QuestionnaireResponseReport::QuestionnaireNotFound do
      render json: { error: "questionnaire_not_found" }, status: :unprocessable_content
    end

    rescue_from Reports::ItemIdMapper::IdCollision do |exception|
      render json: { error: exception.message }, status: :unprocessable_content
    end

    rescue_from QuestionnaireResponseReport::UpstreamError, LabLabelReport::UpstreamError,
                PrescriptionReport::UpstreamError,
                Faraday::ConnectionFailed, Faraday::TimeoutError do
      render json: { error: "upstream_unreachable" }, status: :bad_gateway
    end

    rescue_from FhirTokenProvider::TokenError do
      render json: { error: "upstream_authentication_failed" }, status: :bad_gateway
    end
  end
end
