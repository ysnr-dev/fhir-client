class FhirProxyController < ApplicationController
  # 上流 FHIR サーバーへの中継はログイン必須(ADMIN_TOKEN 未設定なら従来どおり
  # 認証なし)。ここで返す 401 はこのアプリ自身のセッション失効を意味する
  # (上流の 401 は FhirGateway 側で 502 に読み替えられる)。
  include UserAuthentication

  before_action :authorize_user!
  before_action :verify_user_csrf!

  # Task はオーダーの進捗(放射線検査の受付・実施など、部門ワークリストのステータス)を
  # 持つ。オーダー本体の ServiceRequest とは別リソースなので個別に許可する。
  # Procedure と MedicationAdministration は放射線検査の実施記録(実施した手技・
  # 使用した器材と造影剤)。実施登録は transaction Bundle で行うが、登録後の
  # 読み出しはリソース単位で来るのでここにも要る。
  # Location は診察室・撮影室のマスタで、予約枠(Schedule.actor)の主体になる。
  # Schedule / Slot は予約枠そのもの(枠表とその中の時間枠)、Appointment は
  # その枠を患者が押さえた予約。
  ALLOWED_RESOURCE_TYPES = %w[
    Patient MedicationRequest ServiceRequest DiagnosticReport Observation Specimen Condition
    AllergyIntolerance Questionnaire QuestionnaireResponse Binary Organization Practitioner
    PractitionerRole Composition Task Procedure MedicationAdministration
    Location Schedule Slot Appointment
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
