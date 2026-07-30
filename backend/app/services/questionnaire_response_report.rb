# QuestionnaireResponse の PDF 帳票生成のオーケストレータ。
# 上流 FHIR サーバーから必要なリソース一式(QR → 元 Questionnaire → Patient →
# シェーマ画像 Binary)を取得し、canonical に紐付く ReportLayout で PDF を組む。
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

    questionnaire = fetch_questionnaire(canonical)
    patient = fetch_patient(response)
    images = fetch_annotation_images(response)

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

  def fetch_questionnaire(canonical)
    url, version = canonical.split("|", 2)
    raise QuestionnaireNotFound, "QuestionnaireResponse has no canonical reference" if url.blank?

    query = "url=#{CGI.escape(url)}"
    query += "&version=#{CGI.escape(version)}" if version.present?

    upstream = gateway.forward(method: :get, path: "/Questionnaire", query: query)
    ensure_success!(upstream, "Questionnaire?#{query}")

    bundle = JSON.parse(upstream.body)
    questionnaire = Array(bundle["entry"])
      .map { |entry| entry["resource"] }
      .find { |resource| resource&.dig("resourceType") == "Questionnaire" }
    raise QuestionnaireNotFound, "Questionnaire not found for #{canonical}" unless questionnaire

    questionnaire
  end

  # 帳票の患者取り違えは重大なので、患者が引けない場合は生成を中止する。
  def fetch_patient(response)
    reference = response.dig("subject", "reference").to_s
    patient_id = reference[%r{\APatient/(.+)\z}, 1]
    raise UpstreamError, "QuestionnaireResponse has no patient subject" if patient_id.blank?

    upstream = gateway.forward(method: :get, path: "/Patient/#{patient_id}")
    ensure_success!(upstream, "Patient/#{patient_id}")

    JSON.parse(upstream.body)
  end

  # QR item ツリーから描き込み画像(annotated-image 拡張)の Binary を集める。
  def fetch_annotation_images(response)
    collect_binary_ids(response["item"]).uniq.each_with_object({}) do |binary_id, images|
      upstream = gateway.forward(
        method: :get,
        path: "/Binary/#{binary_id}",
        headers: { "Accept" => "image/*" }
      )
      ensure_success!(upstream, "Binary/#{binary_id}")
      images[binary_id] = upstream.body
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

  def ensure_success!(upstream, context)
    return if (200..299).cover?(upstream.status)

    raise UpstreamError, "upstream returned #{upstream.status} for #{context}"
  end
end
