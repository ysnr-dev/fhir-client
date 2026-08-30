# 注射の帳票(注射箋・注射ラベル)のオーケストレータ(docs/injection-order-design.md §5.4)。
# 処方箋(PrescriptionReport)と同じ作りで、上流から注射オーダー 1 日ぶんを 2 往復で
# 取得し、RP ごとに畳んでレンダラへ渡す。
#   1. GET /ServiceRequest/{id}
#   2. batch Bundle POST /  -- 明細(_revinclude)+ Patient read + 自院 Organization
#
# 副作用は無い(何度呼んでも読むだけ)。進捗 Task にも触らない -- 発行 = 受付の遷移は
# frontend の注射一覧が行い、再発行にもそのまま使う(処方箋と同じ設計判断)。
class InjectionReport
  class NotFound < StandardError; end
  class NotInjectionOrder < StandardError; end
  class NoMedication < StandardError; end
  class UpstreamError < StandardError; end

  # 同梱レイアウト。処方箋と同じくマスタ(report_layouts)には登録しない。
  # lines_per_page / max_cols は注射箋の内容欄の寸法と対(docs/report-mappings/injection-01.md)。
  ORDER_LAYOUT = {
    path: Rails.root.join("lib/report_layouts/injection_order.tlf").freeze,
    lines_per_page: 23,
    max_cols: 82
  }.freeze
  LABEL_LAYOUT_PATH = Rails.root.join("lib/report_layouts/injection_label.tlf").freeze

  # frontend の fhir/injectionHelpers.ts / prescriptionHelpers.ts と同じ system 定義。
  ORDER_TYPE_SYSTEM = PrescriptionReport::ORDER_TYPE_SYSTEM
  SETTING_SYSTEM = PrescriptionReport::SETTING_SYSTEM
  INJECTION_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/injection-category".freeze
  RP_NUMBER_SYSTEM = PrescriptionReport::RP_NUMBER_SYSTEM
  ORDER_IN_RP_SYSTEM = PrescriptionReport::ORDER_IN_RP_SYSTEM
  MEDICINE_CODE_SYSTEM = PrescriptionReport::MEDICINE_CODE_SYSTEM
  ORDER_DEPARTMENT_EXT_URL = PrescriptionReport::ORDER_DEPARTMENT_EXT_URL
  ORDER_WARD_EXT_URL = "http://fhir-client.local/StructureDefinition/order-ward".freeze
  USAGE_TYPE_EXT_URL = "http://fhir-client.local/StructureDefinition/injection-usage-type".freeze
  LINE_EXT_URL = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_MedicationDosage_Line".freeze
  SERIES_START_EXT_URL = "http://fhir-client.local/StructureDefinition/injection-series-start".freeze
  SERIES_SCHEDULE_EXT_URL = "http://fhir-client.local/StructureDefinition/injection-series-schedule".freeze
  INSTITUTION_NO_SYSTEM = PrescriptionReport::INSTITUTION_NO_SYSTEM
  INJECTION_CODE = "injection".freeze

  # RP 1 つぶん(混注のまとまり)。用法は RP 内で共通なので最初の明細から取る。
  RpGroup = Struct.new(
    :rp_number, :usage_type, :route, :site, :method, :line, :rate, :start_times, :usage_comment,
    :medicines, keyword_init: true
  )
  MedicineLine = Struct.new(:order_in_rp, :name, :dose, :unit, :comment, keyword_init: true)

  def initialize(order_id, gateway: FhirGateway.new)
    @order_id = order_id
    @gateway = gateway
  end

  # 注射箋(A5、1 オーダー 1 枚。内容が多ければ続紙)。
  def generate_order
    order, patient, organization, rps = load
    Reports::InjectionRenderer.new(
      layout_path: ORDER_LAYOUT[:path],
      order:, patient:, organization:, rps:,
      lines_per_page: ORDER_LAYOUT[:lines_per_page],
      max_cols: ORDER_LAYOUT[:max_cols]
    ).render
  end

  # 注射ラベル(1 ページ = RP 1 つ。混注したボトル・シリンジに貼る)。
  def generate_labels
    order, patient, _organization, rps = load
    Reports::InjectionLabelRenderer.new(
      layout_path: LABEL_LAYOUT_PATH, order:, patient:, rps:
    ).render
  end

  private

  attr_reader :order_id, :gateway

  def load
    order = fetch_order
    medication_requests, patient, organization = fetch_related_resources(order)
    rps = build_rps(medication_requests)
    raise NoMedication, "order #{order_id} has no medication requests" if rps.empty?

    [order, patient, organization, rps]
  end

  def fetch_order
    upstream = gateway.forward(method: :get, path: "/ServiceRequest/#{order_id}")
    raise NotFound, "ServiceRequest/#{order_id} not found" if upstream.status == 404
    ensure_success!(upstream, "ServiceRequest/#{order_id}")

    order = JSON.parse(upstream.body)
    unless injection_order?(order)
      raise NotInjectionOrder, "ServiceRequest/#{order_id} is not an injection order"
    end

    order
  end

  # frontend の isInjectionServiceRequest と同じ判定(order-type|injection)。
  def injection_order?(order)
    Array(order["category"]).any? do |category|
      Array(category["coding"]).any? do |coding|
        coding["system"] == ORDER_TYPE_SYSTEM && coding["code"] == INJECTION_CODE
      end
    end
  end

  # 明細・Patient read・自院 Organization を 1 つの batch Bundle で取得する。
  # 明細は _revinclude で取る(based-on 検索は上流に無い。処方箋と同じ注意)。
  def fetch_related_resources(order)
    patient_id = patient_id_from(order)
    self_organization_id = FacilitySettings.self_organization_id
    entries = [
      { "request" => { "method" => "GET",
                       "url" => "ServiceRequest?_id=#{order_id}" \
                                "&_revinclude=MedicationRequest%3Abased-on&_count=100" } },
      { "request" => { "method" => "GET", "url" => "Patient/#{patient_id}" } },
      { "request" => { "method" => "GET", "url" => institution_url(self_organization_id) } }
    ]
    bundle = { "resourceType" => "Bundle", "type" => "batch", "entry" => entries }
    upstream = gateway.forward(
      method: :post, path: "/", body: bundle.to_json,
      headers: { "Content-Type" => "application/fhir+json" }
    )
    ensure_success!(upstream, "batch bundle")
    results = Array(JSON.parse(upstream.body)["entry"])

    medication_requests = searchset_resources(results[0], "MedicationRequest", "detail search")
    patient = entry_resource!(results[1], "Patient/#{patient_id}")
    [medication_requests, patient, find_institution(results[2], self_organization_id)]
  end

  def institution_url(self_organization_id)
    return "Organization/#{self_organization_id}" if self_organization_id

    "Organization?identifier=#{CGI.escape(INSTITUTION_NO_SYSTEM)}%7C&_count=10"
  end

  # 患者取り違えは重大なので、患者が引けない場合は生成を中止する(処方箋と同じ)。
  def patient_id_from(order)
    reference = order.dig("subject", "reference").to_s
    patient_id = reference[%r{\APatient/(.+)\z}, 1]
    raise UpstreamError, "ServiceRequest/#{order_id} has no patient subject" if patient_id.blank?

    patient_id
  end

  # 自院。取れなくても発行は止めない(医療機関名が空欄になるだけ)。
  def find_institution(entry, self_organization_id)
    if self_organization_id
      organization = begin
        entry_resource!(entry, "Organization/#{self_organization_id}")
      rescue UpstreamError
        return nil
      end
      return organization["resourceType"] == "Organization" ? organization : nil
    end
    resources = begin
      searchset_resources(entry, "Organization", "institution search")
    rescue UpstreamError
      return nil
    end
    resources.find do |organization|
      Array(organization["identifier"]).any? { |i| i["system"] == INSTITUTION_NO_SYSTEM }
    end
  end

  # ---- 明細のグルーピング(frontend の groupInjectionByRp と同じ規則) ----

  def build_rps(medication_requests)
    groups = {}
    medication_requests.each do |mr|
      rp_number = identifier_value(mr, RP_NUMBER_SYSTEM).to_i
      dosage = mr.dig("dosageInstruction", 0) || {}
      group = groups[rp_number] ||= RpGroup.new(
        rp_number: rp_number,
        usage_type: extension_display(dosage["extension"], USAGE_TYPE_EXT_URL),
        route: concept_display(dosage["route"]),
        site: concept_display(dosage["site"]),
        method: concept_display(dosage["method"]),
        line: extension_display(dosage["extension"], LINE_EXT_URL),
        rate: dosage.dig("doseAndRate", 0, "rateQuantity", "value"),
        start_times: Array(dosage.dig("timing", "event")).map { |t| t.to_s[11, 5] }.compact,
        usage_comment: dosage.dig("additionalInstruction", 0, "text").to_s,
        medicines: []
      )
      group.medicines << MedicineLine.new(
        order_in_rp: identifier_value(mr, ORDER_IN_RP_SYSTEM).to_i,
        name: medicine_name(mr),
        dose: dosage.dig("doseAndRate", 0, "doseQuantity", "value"),
        unit: dosage.dig("doseAndRate", 0, "doseQuantity", "unit").to_s,
        comment: mr.dig("note", 0, "text").to_s
      )
    end
    groups.values.sort_by(&:rp_number).each { |group| group.medicines.sort_by!(&:order_in_rp) }
  end

  def identifier_value(mr, system)
    Array(mr["identifier"]).find { |i| i["system"] == system }&.dig("value").to_s
  end

  def medicine_name(mr)
    coding = coding_by_system(mr.dig("medicationCodeableConcept", "coding"), MEDICINE_CODE_SYSTEM)
    coding&.dig("display").presence || mr.dig("medicationCodeableConcept", "text").to_s
  end

  def concept_display(concept)
    return "" unless concept

    concept.dig("coding", 0, "display").presence || concept["text"].to_s
  end

  def extension_display(extensions, url)
    ext = Array(extensions).find { |e| e["url"] == url }
    concept_display(ext&.dig("valueCodeableConcept"))
  end

  def coding_by_system(codings, system)
    Array(codings).find { |coding| coding["system"] == system }
  end

  def searchset_resources(entry, resource_type, context)
    Array(entry_resource!(entry, context)["entry"])
      .map { |e| e["resource"] }
      .select { |resource| resource&.dig("resourceType") == resource_type }
  end

  def entry_resource!(entry, context)
    status = entry&.dig("response", "status").to_i
    resource = entry&.dig("resource")
    unless (200..299).cover?(status) && resource
      raise UpstreamError, "upstream returned #{status} for #{context} (in batch)"
    end

    resource
  end

  def ensure_success!(upstream, context)
    return if (200..299).cover?(upstream.status)

    raise UpstreamError, "upstream returned #{upstream.status} for #{context}"
  end
end
