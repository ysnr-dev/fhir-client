class FhirProxyController < ApplicationController
  # 上流 FHIR サーバーへの中継はログイン必須(ADMIN_TOKEN 未設定なら従来どおり
  # 認証なし)。ここで返す 401 はこのアプリ自身のセッション失効を意味する
  # (上流の 401 は FhirGateway 側で 502 に読み替えられる)。
  include UserAuthentication

  before_action :authorize_user!
  before_action :verify_user_csrf!

  ALLOWED_RESOURCE_TYPES = %w[
    Patient MedicationRequest ServiceRequest DiagnosticReport Observation Specimen Condition
    AllergyIntolerance Questionnaire QuestionnaireResponse Binary Organization Practitioner
    PractitionerRole
  ].freeze
  FHIR_CONTENT_TYPE = "application/fhir+json".freeze

  FORWARD_REQUEST_HEADERS = %w[Content-Type Accept If-Match If-None-Match Prefer].freeze
  FORWARD_RESPONSE_HEADERS = %w[content-type etag location last-modified].freeze

  def relay
    path = params[:fhir_path].to_s
    resource_type = path.split("/").first

    unless bundle_post?(path) || resource_type == "metadata" || ALLOWED_RESOURCE_TYPES.include?(resource_type)
      return render_outcome(:not_found, "not-supported", "Resource type not supported: #{resource_type}")
    end

    upstream = FhirGateway.new.forward(
      method: request.method_symbol,
      path: "/#{path}",
      query: request.query_string,
      body: request.raw_post.presence,
      headers: forwarded_request_headers
    )

    forward_response_headers(upstream)
    render body: upstream.body, status: upstream.status,
           content_type: upstream.headers["content-type"] || FHIR_CONTENT_TYPE
  rescue Faraday::ConnectionFailed, Faraday::TimeoutError => e
    render_outcome(:bad_gateway, "transient", "FHIR server unreachable: #{e.class}")
  rescue FhirTokenProvider::TokenError
    # Do not leak token endpoint details to the browser.
    render_outcome(:bad_gateway, "security", "FHIR server token acquisition failed")
  end

  private

  # transaction/batch Bundle を root (/fhir) へ POST するリクエスト。
  def bundle_post?(path)
    path.blank? && request.post?
  end

  def forwarded_request_headers
    FORWARD_REQUEST_HEADERS.each_with_object({}) do |name, headers|
      value = request.headers[name]
      headers[name] = value if value.present?
    end
  end

  def forward_response_headers(upstream)
    FORWARD_RESPONSE_HEADERS.each do |name|
      value = upstream.headers[name]
      response.set_header(name.split("-").map(&:capitalize).join("-"), value) if value.present?
    end
  end

  def render_outcome(status, code, diagnostics)
    render json: {
      resourceType: "OperationOutcome",
      issue: [{ severity: "error", code: code, diagnostics: diagnostics }]
    }, status: status, content_type: FHIR_CONTENT_TYPE
  end
end
