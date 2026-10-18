# カルテの「アプリ」タブ: 起動できるアプリの一覧と、EHR launch の起動
# (docs/smart-app-launch-design.md §3.1)。登録・編集は Admin::SmartAppsController。
class SmartAppsController < ActionController::API
  include UserAuthentication

  before_action :authorize_user!
  before_action :verify_user_csrf!

  # GET /smart_apps
  def index
    apps = SmartApp.enabled.ordered
    render json: { items: apps.map { |app| { id: app.id, name: app.name, display: app.display } } }
  end

  # POST /smart_apps/:id/launch  {patient_id, encounter_id?}
  #
  # 上流に名乗る医療者はログイン中の利用者。administrator と認証なしモードには
  # 紐づく Practitioner が無いので起動できない(アプリの fhirUser が決まらない)。
  def launch
    practitioner_id = current_user&.practitioner_fhir_id
    return render json: { error: "practitioner_required" }, status: :forbidden if practitioner_id.blank?

    patient_id = params[:patient_id].to_s.strip
    return render json: { error: "patient_id is required" }, status: :bad_request if patient_id.blank?

    app = SmartApp.enabled.find_by(id: params[:id])
    return render json: { error: "not_found" }, status: :not_found unless app

    result = SmartLaunchIssuer.new.call(
      app: app, patient_id: patient_id, practitioner_id: practitioner_id,
      encounter_id: params[:encounter_id].to_s.strip.presence
    )
    render json: { launch_url: result.launch_url, display: result.display, expires_in: result.expires_in }
  rescue FhirAdminGateway::NotConfigured
    render json: { error: "接続設定で FHIR 管理トークンを設定してください（上流の FHIR_ADMIN_TOKEN と同じ値）" },
           status: :service_unavailable
  rescue SmartLaunchIssuer::Upstream => e
    render_upstream_failure(e)
  rescue Faraday::ConnectionFailed, Faraday::TimeoutError => e
    render json: { error: "FHIR サーバーに接続できませんでした (#{e.class})" }, status: :bad_gateway
  end

  private

  # 上流の 404 / 422(クライアントの削除・launch 未登録・患者不在)は原因が伝わるよう
  # ボディを透過して 422 に、401 / 403 / 5xx は UpstreamAdminRelay と同じく 502 に読み替える
  # (401 をそのまま返すと SPA が自分のセッション切れと誤認する)。
  def render_upstream_failure(error)
    case error.status
    when 404, 422
      body = JSON.parse(error.body) rescue {}
      errors = Array(body["errors"]).presence || [body["error_description"] || body["error"]].compact
      render json: { errors: errors.presence || ["FHIR サーバーが起動を拒否しました"] }, status: :unprocessable_content
    when 401, 403
      render json: { error: "FHIR サーバーが管理トークンを拒否しました。接続設定の FHIR 管理トークンを確認してください。" },
             status: :bad_gateway
    when 503
      render json: { error: "FHIR サーバー側で管理APIが無効です (FHIR_ADMIN_TOKEN が未設定)" }, status: :bad_gateway
    else
      render json: { error: "FHIR サーバーが起動要求を拒否しました (HTTP #{error.status})" }, status: :bad_gateway
    end
  end
end
