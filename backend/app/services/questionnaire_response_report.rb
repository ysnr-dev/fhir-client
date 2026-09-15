# QuestionnaireResponse の PDF 帳票生成のオーケストレータ。
# 上流 FHIR サーバーから必要なリソース一式を取得し、canonical に紐付く
# ReportLayout で PDF を組む。上流との往復は最大 2 回。
#   1. GET /QuestionnaireResponse?_id={id} -- QR + 患者と元 Questionnaire(_include)
#   2. batch Bundle POST /                 -- シェーマ画像 Binary read ×N(画像が無ければ走らない)
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
    response, resources = fetch_questionnaire_response
    canonical = response["questionnaire"].to_s

    layout = ReportLayout.for_canonical(canonical)
    raise LayoutNotRegistered, "layout not registered for #{canonical}" unless layout

    questionnaire = included_questionnaire(resources, canonical)
    patient = included_patient(resources, response)
    images = fetch_images(collect_binary_ids(response["item"]).uniq)

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

  # QR と、_include で添えた患者・元 Questionnaire を返す。
  def fetch_questionnaire_response
    query = "_id=#{CGI.escape(response_id)}" \
            "&_include=QuestionnaireResponse%3Asubject" \
            "&_include=QuestionnaireResponse%3Aquestionnaire"
    upstream = gateway.forward(method: :get, path: "/QuestionnaireResponse", query: query)
    ensure_success!(upstream, "QuestionnaireResponse?_id=#{response_id}")
    resources = Array(JSON.parse(upstream.body)["entry"]).filter_map { |e| e["resource"] }

    response = resources.find do |r|
      r["resourceType"] == "QuestionnaireResponse" && r["id"] == response_id
    end
    raise NotFound, "QuestionnaireResponse/#{response_id} not found" unless response

    [response, resources]
  end

  # canonical に版があればその版、無ければ url の一致する版の中から id 順の先頭を使う
  # (_include は版の無い canonical に対して全版を返す)。
  def included_questionnaire(resources, canonical)
    url, version = canonical.split("|", 2)
    raise QuestionnaireNotFound, "QuestionnaireResponse has no canonical reference" if url.blank?

    questionnaire = resources
      .select { |r| r["resourceType"] == "Questionnaire" && r["url"] == url }
      .select { |r| version.blank? || r["version"] == version }
      .min_by { |r| r["id"].to_s }
    raise QuestionnaireNotFound, "Questionnaire not found for #{canonical}" unless questionnaire

    questionnaire
  end

  # 帳票の患者取り違えは重大なので、患者が引けない場合は生成を中止する。
  def included_patient(resources, response)
    reference = response.dig("subject", "reference").to_s
    patient_id = reference[%r{\APatient/(.+)\z}, 1]
    raise UpstreamError, "QuestionnaireResponse has no patient subject" if patient_id.blank?

    patient = resources.find { |r| r["resourceType"] == "Patient" && r["id"] == patient_id }
    raise UpstreamError, "Patient/#{patient_id} was not included for QuestionnaireResponse" unless patient

    patient
  end

  # シェーマ画像の Binary read ×N を 1 つの batch Bundle で取得する。
  # batch-response の entry はリクエストと同順で返る。
  def fetch_images(binary_ids)
    return {} if binary_ids.empty?

    entries = binary_ids.map { |id| { "request" => { "method" => "GET", "url" => "Binary/#{id}" } } }
    bundle = { "resourceType" => "Bundle", "type" => "batch", "entry" => entries }
    upstream = gateway.forward(
      method: :post,
      path: "/",
      body: bundle.to_json,
      headers: { "Content-Type" => "application/fhir+json" }
    )
    ensure_success!(upstream, "batch bundle")
    images_from(Array(JSON.parse(upstream.body)["entry"]), binary_ids)
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
