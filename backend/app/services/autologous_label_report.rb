# 自己血の採血ラベル PDF 生成のオーケストレータ(docs/transfusion-order-design.md §2.9)。
# JAHIS 患者安全ガイド(輸血編)7.7.3-1 の「患者 ID・氏名・血液型・自己血製剤番号・採血日・使用予定日・
# 有効期限・患者署名欄」を 1 枚に刷る。採血記録 1 件(ハブの Procedure)= ラベル 1 枚。
# 上流との往復は 1 回(採血記録 + 患者 + 元のオーダー + 採った血)。読むだけで副作用は無い。
class AutologousLabelReport
  include Reports::UpstreamBundle

  class NotFound < StandardError; end
  class UpstreamError < StandardError; end

  # 検体ラベルと同じく固定様式なので同梱する。
  LAYOUT_PATH = Rails.root.join("lib/report_layouts/autologous_label.tlf").freeze

  # frontend の fhir/autologousHelpers.ts・transfusionDispenseHelpers.ts と同じ定義。
  CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/procedure-category".freeze
  COLLECTION_CODE = "autologous-collection".freeze
  PRODUCT_NUMBER_SYSTEM = "http://fhir-client.local/IdSystem/blood-product-number".freeze
  EXPIRY_EXT_URL = "http://fhir-client.local/StructureDefinition/transfusion-expiry".freeze
  ABO_EXT_URL = "http://fhir-client.local/StructureDefinition/transfusion-abo".freeze
  RHD_EXT_URL = "http://fhir-client.local/StructureDefinition/transfusion-rhd".freeze

  def initialize(procedure_id, gateway: FhirGateway.new)
    @procedure_id = procedure_id
    @gateway = gateway
  end

  def generate
    hub, patient, order, unit = fetch_resources
    Reports::AutologousLabelRenderer.new(layout_path: LAYOUT_PATH, hub:, patient:, order:, unit:).render
  end

  private

  attr_reader :procedure_id, :gateway

  def fetch_resources
    query = "_id=#{CGI.escape(procedure_id)}" \
            "&_include=Procedure%3Asubject" \
            "&_include=Procedure%3Abased-on" \
            "&_revinclude=MedicationDispense%3Apart-of"
    upstream = gateway.forward(method: :get, path: "/Procedure", query: query)
    ensure_success!(upstream, "Procedure?_id=#{procedure_id}")
    resources = Array(JSON.parse(upstream.body)["entry"]).filter_map { |e| e["resource"] }

    hub = resources.find { |r| r["resourceType"] == "Procedure" && r["id"] == procedure_id }
    raise NotFound, "Procedure/#{procedure_id} not found" unless hub && collection?(hub)

    unit = resources.find do |r|
      r["resourceType"] == "MedicationDispense" &&
        Array(r["partOf"]).any? { |ref| ref["reference"] == "Procedure/#{procedure_id}" }
    end
    raise NotFound, "Procedure/#{procedure_id} has no collected unit" unless unit

    order = resources.find { |r| r["resourceType"] == "ServiceRequest" }
    [hub, included_patient(resources, hub), order, unit]
  end

  def collection?(hub)
    coding_by_system(hub.dig("category", "coding"), CATEGORY_SYSTEM)&.dig("code") == COLLECTION_CODE
  end
end
