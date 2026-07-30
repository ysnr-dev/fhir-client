module Reports
  # 帳票出力エンドポイントのプレーン JSON ベース。ApplicationController からは
  # 意図的に分離する(FHIR リソースではないので OperationOutcome を使わない)。
  # 認証は既存の /fhir プロキシと同水準(なし)。同じデータは /fhir 経由で
  # 読めるため、ここだけ守っても攻撃面は変わらない。
  class BaseController < ActionController::API
    rescue_from QuestionnaireResponseReport::NotFound do
      render json: { error: "questionnaire_response_not_found" }, status: :not_found
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

    rescue_from QuestionnaireResponseReport::UpstreamError,
                Faraday::ConnectionFailed, Faraday::TimeoutError do
      render json: { error: "upstream_unreachable" }, status: :bad_gateway
    end

    rescue_from FhirTokenProvider::TokenError do
      render json: { error: "upstream_authentication_failed" }, status: :bad_gateway
    end
  end
end
