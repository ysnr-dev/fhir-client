# SMART on FHIR の EHR launch の起動 URL を組み立てる(docs/smart-app-launch-design.md §3.1)。
#
# 上流の管理 API(POST /admin/launch_contexts)に、開いている患者・受診とログイン中の医療者を
# 名乗って launch トークンを発行してもらい、アプリの launch_url に `iss` と `launch` を添える。
# iss はブラウザから見た上流の URL(FhirConnectionSettings.public_base_url)で、アプリは
# この値を issuer と照合するので末尾のスラッシュを落として渡す。
class SmartLaunchIssuer
  Result = Struct.new(:launch_url, :display, :expires_in, keyword_init: true)

  # 上流が発行を拒んだ(404 / 422 / 5xx など)。status と上流のボディを持つ。
  class Upstream < StandardError
    attr_reader :status, :body

    def initialize(status, body)
      @status = status
      @body = body
      super("upstream returned HTTP #{status}")
    end
  end

  ISSUED_BY = "fhir-client".freeze

  def initialize(gateway: FhirAdminGateway.new, config: FhirConnectionSettings.effective)
    @gateway = gateway
    @config = config
  end

  def call(app:, patient_id:, practitioner_id:, encounter_id: nil, app_context: nil)
    body = {
      client_id: app.client_id,
      patient_id: patient_id,
      encounter_id: encounter_id.presence,
      practitioner_id: practitioner_id,
      need_patient_banner: !app.embed?,
      issued_by: ISSUED_BY,
      app_context: app_context.presence
    }.compact
    response = @gateway.request(:post, "/admin/launch_contexts", body: body.to_json)
    raise Upstream.new(response.status, response.body.to_s) unless response.status == 201

    issued = JSON.parse(response.body)
    Result.new(
      launch_url: with_launch_params(app.launch_url, launch: issued.fetch("launch")),
      display: app.display,
      expires_in: issued["expires_in"]
    )
  end

  private

  def issuer
    @config.public_base_url.to_s.chomp("/")
  end

  def with_launch_params(launch_url, launch:)
    uri = URI.parse(launch_url)
    query = Rack::Utils.parse_query(uri.query).merge("iss" => issuer, "launch" => launch)
    uri.query = Rack::Utils.build_query(query)
    uri.to_s
  end
end
