# QuestionnaireResponse の PDF 帳票生成のオーケストレータ。
# 上流 FHIR サーバーから必要なリソース一式を 2 往復で取得し、canonical に紐付く
# ReportLayout で PDF を組む。
#   1. GET /QuestionnaireResponse/{id} -- 中身を見ないと canonical・患者・画像が分からない
#   2. batch Bundle POST / -- 元 Questionnaire 検索 + Patient read + シェーマ画像 Binary read ×N
# 以前は Binary を 1 枚ずつ直列 GET していたため 3+N 往復かかっていた。
class QuestionnaireResponseReport
  # QR が上流に存在しない
  class NotFound < StandardError; end
  # canonical に対応するレイアウトが未登録
  class LayoutNotRegistered < StandardError; end
  # QR が参照する canonical で元テンプレートを引き当てられない
  class QuestionnaireNotFound < StandardError; end
  # 上流が患者・画像などで想定外の応答を返した
  class UpstreamError < StandardError; end

  ANNOTATED_IMAGE_EXT_URL = Reports::ThinreportsRenderer::ANNOTATED_IMAGE_EXT_URL

  def initialize(response_id, gateway: FhirGateway.new)
    @response_id = response_id
    @gateway = gateway
  end

  # PDF のバイト列を返す。
  def generate
    response = fetch_questionnaire_response
    canonical = response["questionnaire"].to_s

    layout = ReportLayout.for_canonical(canonical)
    raise LayoutNotRegistered, "layout not registered for #{canonical}" unless layout

    questionnaire, patient, images = fetch_related_resources(response, canonical)

    Reports::ThinreportsRenderer.new(
      layout: layout,
      questionnaire: questionnaire,
      response: response,
      patient: patient,
      images: images
    ).render
  end

  private

  attr_reader :response_id, :gateway

  def fetch_questionnaire_response
    upstream = gateway.forward(method: :get, path: "/QuestionnaireResponse/#{response_id}")
    raise NotFound, "QuestionnaireResponse/#{response_id} not found" if upstream.status == 404
    ensure_success!(upstream, "QuestionnaireResponse/#{response_id}")

    JSON.parse(upstream.body)
  end

  # Questionnaire 検索・Patient read・Binary read ×N を 1 つの batch Bundle で取得する。
  # batch-response の entry はリクエストと同順で返る。
  def fetch_related_resources(response, canonical)
    questionnaire_query = build_questionnaire_query(canonical)
    patient_id = patient_id_from(response)
    binary_ids = collect_binary_ids(response["item"]).uniq

    entries = [
      { "request" => { "method" => "GET", "url" => "Questionnaire?#{questionnaire_query}" } },
      { "request" => { "method" => "GET", "url" => "Patient/#{patient_id}" } }
    ]
    entries += binary_ids.map { |id| { "request" => { "method" => "GET", "url" => "Binary/#{id}" } } }

    bundle = { "resourceType" => "Bundle", "type" => "batch", "entry" => entries }
    upstream = gateway.forward(
      method: :post,
      path: "/",
      body: bundle.to_json,
      headers: { "Content-Type" => "application/fhir+json" }
    )
    ensure_success!(upstream, "batch bundle")
    results = Array(JSON.parse(upstream.body)["entry"])

    [
      questionnaire_from(results[0], canonical, questionnaire_query),
      patient_from(results[1], patient_id),
      images_from(results.drop(2), binary_ids)
    ]
  end

  def build_questionnaire_query(canonical)
    url, version = canonical.split("|", 2)
    raise QuestionnaireNotFound, "QuestionnaireResponse has no canonical reference" if url.blank?

    query = "url=#{CGI.escape(url)}"
    query += "&version=#{CGI.escape(version)}" if version.present?
    query
  end

  # 帳票の患者取り違えは重大なので、患者が引けない場合は生成を中止する。
  def patient_id_from(response)
    reference = response.dig("subject", "reference").to_s
    patient_id = reference[%r{\APatient/(.+)\z}, 1]
    raise UpstreamError, "QuestionnaireResponse has no patient subject" if patient_id.blank?

    patient_id
  end

  def questionnaire_from(entry, canonical, query)
    bundle = entry_resource!(entry, "Questionnaire?#{query}")
    questionnaire = Array(bundle["entry"])
      .map { |e| e["resource"] }
      .find { |resource| resource&.dig("resourceType") == "Questionnaire" }
    raise QuestionnaireNotFound, "Questionnaire not found for #{canonical}" unless questionnaire

    questionnaire
  end

  def patient_from(entry, patient_id)
    entry_resource!(entry, "Patient/#{patient_id}")
  end

  # batch 経由の Binary は FHIR JSON(data: base64)で返るためデコードして生バイトに戻す。
  def images_from(entries, binary_ids)
    binary_ids.each_with_index.each_with_object({}) do |(binary_id, index), images|
      binary = entry_resource!(entries[index], "Binary/#{binary_id}")
      images[binary_id] = Base64.decode64(binary["data"].to_s)
    end
  end

  def collect_binary_ids(items, acc = [])
    Array(items).each do |item|
      url = Array(item["extension"])
        .find { |ext| ext["url"] == ANNOTATED_IMAGE_EXT_URL }
        &.dig("valueAttachment", "url")
      acc << Regexp.last_match(1) if url&.match(%r{\ABinary/(.+)\z})
      collect_binary_ids(item["item"], acc)
    end
    acc
  end

  # batch-response の各 entry を検証してリソース本体を返す。
  def entry_resource!(entry, context)
    status = entry&.dig("response", "status").to_i
    resource = entry&.dig("resource")
    raise UpstreamError, "upstream returned #{status} for #{context} (in batch)" unless (200..299).cover?(status) && resource

    resource
  end

  def ensure_success!(upstream, context)
    return if (200..299).cover?(upstream.status)

    raise UpstreamError, "upstream returned #{upstream.status} for #{context}"
  end
end
