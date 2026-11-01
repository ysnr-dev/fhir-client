# 病理検体ラベル PDF 生成のオーケストレータ(docs/patho-order-design.md §4.10)。
# JAHIS 患者安全ガイド(病理編)7.1.3 の「患者ID・患者名・ユニークID付きの容器総数が明記された検体ラベル」。
# 1 ページ = 容器 1 つ。容器の数は検体明細ごとの容器数(拡張 patho-container-count)の和で、
# ラベルには「容器 k/N」をオーダー通しの番号で刷る。上流との往復は最大 2 回。
#   1. GET /ServiceRequest?_id={id} -- オーダー + 患者(_include)+ 明細・発行済みの容器(_revinclude)
#   2. batch Bundle POST /          -- まだ発行していない容器の Specimen 作成と、減った容器の取り下げ
#
# 容器 1 つの台帳は上流の Specimen(検体検査のラベルと同じ作り。docs/lab-arrival-design.md §6-1)。
# 番号(ユニーク ID)も検体検査と同じ accessionIdentifier の採番(LABEL_NUMBER_SYSTEM)を使い、
# 院内で 1 つの通し番号にする。病理の容器は identifier(PATHO_CONTAINER_SYSTEM)に
# 「検体明細の id:明細内の容器の順番」を持ち、これで容器を見分ける(採取で容器数が変わったら
# 増えた分を作り、減った分は entered-in-error にする。番号は容器ごとに固定)。
class PathoLabelReport
  include Reports::UpstreamBundle

  class NotFound < StandardError; end
  # 指定されたオーダーが病理検査ではない(URL 直叩きなど)
  class NotPathoOrder < StandardError; end
  # 検体が 1 件もなく、刷るラベルがない
  class NoLabelTarget < StandardError; end
  class UpstreamError < StandardError; end

  # 検体検査のラベルと同じく、バーコードの読み取りに合わせた固定様式なので同梱する。
  LAYOUT_PATH = Rails.root.join("lib/report_layouts/patho_label.tlf").freeze

  # frontend の fhir/pathoOrderHelpers.ts と同じ system 定義。
  LABEL_NUMBER_SYSTEM = LabLabelReport::LABEL_NUMBER_SYSTEM
  PATHO_CONTAINER_SYSTEM = "http://fhir-client.local/IdSystem/patho-container".freeze
  PATHO_ORDER_CODE = "pathology".freeze
  ITEM_NUMBER_SYSTEM = "http://fhir-client.local/IdSystem/patho-order-item-number".freeze
  EXAM_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/jahis-patho-exam-category".freeze
  SPECIMEN_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/jahis-patho-specimen-type".freeze
  ORGAN_SYSTEM = "http://fhir-client.local/CodeSystem/jahis-patho-organ".freeze
  COLLECTION_METHOD_SYSTEM = "http://fhir-client.local/CodeSystem/jahis-patho-collection-method".freeze
  CONTAINER_COUNT_EXT_URL = "http://fhir-client.local/StructureDefinition/patho-container-count".freeze

  # ラベル 1 枚(容器 1 つ)ぶん。
  Label = Struct.new(
    :item_id, :specimen_number, :container_index, :container_number, :container_total,
    :organ, :detail, :collected, :number,
    keyword_init: true
  )

  def initialize(order_id, gateway: FhirGateway.new)
    @order_id = order_id
    @gateway = gateway
  end

  def generate
    order, patient, items, specimens = fetch_order_resources
    labels = build_labels(order, items)
    raise NoLabelTarget, "order #{order_id} has no specimens" if labels.empty?

    assign_numbers(labels, order, specimens)
    Reports::PathoLabelRenderer.new(layout_path: LAYOUT_PATH, order:, patient:, labels:).render
  end

  private

  attr_reader :order_id, :gateway

  def fetch_order_resources
    query = "_id=#{CGI.escape(order_id)}" \
            "&_include=ServiceRequest%3Asubject" \
            "&_revinclude=ServiceRequest%3Abased-on" \
            "&_revinclude=Specimen%3Arequest"
    upstream = gateway.forward(method: :get, path: "/ServiceRequest", query: query)
    ensure_success!(upstream, "ServiceRequest?_id=#{order_id}")
    resources = Array(JSON.parse(upstream.body)["entry"]).filter_map { |e| e["resource"] }

    order = resources.find { |r| r["resourceType"] == "ServiceRequest" && r["id"] == order_id }
    raise NotFound, "ServiceRequest/#{order_id} not found" unless order
    raise NotPathoOrder, "ServiceRequest/#{order_id} is not a pathology order" unless patho_order?(order)

    order_reference = "ServiceRequest/#{order_id}"
    items = resources.select do |r|
      r["resourceType"] == "ServiceRequest" && references?(r["basedOn"], order_reference) &&
        contained_specimen_of(r)
    end
    specimens = resources.select do |r|
      r["resourceType"] == "Specimen" && references?(r["request"], order_reference) && container_key(r)
    end
    [order, included_patient(resources, order), items, specimens]
  end

  def patho_order?(order)
    Array(order["category"]).any? do |category|
      Array(category["coding"]).any? do |coding|
        coding["system"] == ORDER_TYPE_SYSTEM && coding["code"] == PATHO_ORDER_CODE
      end
    end
  end

  def references?(references, reference)
    Array(references).any? { |r| r["reference"] == reference }
  end

  # ---- ラベルの組み立て ----

  # 検体明細を検体番号の順に並べ、明細ごとの容器数だけラベルを作る。容器番号はオーダー通し。
  def build_labels(order, items)
    exam = coding_by_system(order.dig("code", "coding"), EXAM_CATEGORY_SYSTEM)&.dig("display") ||
           order.dig("code", "text")
    sorted = items.sort_by { |item| identifier_value(item, ITEM_NUMBER_SYSTEM).to_i }
    labels = sorted.each_with_index.flat_map do |item, index|
      specimen = contained_specimen_of(item)
      count = container_count(specimen)
      (1..count).map do |container_index|
        Label.new(
          item_id: item["id"],
          specimen_number: identifier_value(item, ITEM_NUMBER_SYSTEM).presence || (index + 1).to_s,
          container_index: container_index,
          organ: organ_label(specimen),
          detail: detail_label(exam, specimen),
          collected: specimen.dig("collection", "collectedDateTime").to_s
        )
      end
    end
    labels.each_with_index do |label, index|
      label.container_number = index + 1
      label.container_total = labels.length
    end
    labels
  end

  def container_count(specimen)
    value = Array(specimen["extension"]).find { |e| e["url"] == CONTAINER_COUNT_EXT_URL }&.dig("valueInteger")
    value.to_i.positive? ? value.to_i : 1
  end

  # 「右 胃前庭部」。オーダー側が bodySite.text に左右込みの表示を持たせている。
  def organ_label(specimen)
    body_site = specimen.dig("collection", "bodySite")
    body_site&.dig("text").presence ||
      coding_by_system(body_site&.dig("coding"), ORGAN_SYSTEM)&.dig("display").to_s
  end

  # 「組織診・生検・EMR・3個」。
  def detail_label(exam, specimen)
    type = coding_by_system(specimen.dig("type", "coding"), SPECIMEN_TYPE_SYSTEM)&.dig("display")
    method = coding_by_system(specimen.dig("collection", "method", "coding"), COLLECTION_METHOD_SYSTEM)&.dig("display")
    pieces = specimen.dig("collection", "quantity", "value")
    [exam, type, method, pieces ? "#{pieces.to_i}個" : nil].compact_blank.join("・")
  end

  def contained_specimen_of(item)
    reference = item.dig("specimen", 0, "reference").to_s
    return nil unless reference.start_with?("#")

    id = reference.delete_prefix("#")
    Array(item["contained"]).find { |r| r["resourceType"] == "Specimen" && r["id"] == id }
  end

  # ---- 番号の確保(台帳 = 上流の Specimen) ----

  def key_of(item_id, container_index)
    "#{item_id}:#{container_index}"
  end

  def container_key(specimen)
    Array(specimen["identifier"]).find { |i| i["system"] == PATHO_CONTAINER_SYSTEM }&.dig("value").presence
  end

  # 発行済みの容器はその番号を使う(取り下げていたら戻す)。無い容器はまとめて作る。
  # いまの容器に当たらない発行済みの容器(採取で容器数を減らした・検体を外した)は取り下げる。
  def assign_numbers(labels, order, specimens)
    existing = specimens.index_by { |specimen| container_key(specimen) }
    wanted = labels.map { |label| key_of(label.item_id, label.container_index) }

    entries = []
    pending = []
    labels.zip(wanted).each do |label, key|
      specimen = existing[key]
      if specimen
        label.number = accession_number(specimen)
        entries << revive_entry(specimen) if specimen["status"] == "entered-in-error"
      else
        pending << label
        entries << create_entry(label, order, key)
      end
    end
    existing.each do |key, specimen|
      next if wanted.include?(key) || specimen["status"] == "entered-in-error"

      entries << retire_entry(specimen)
    end
    return if entries.empty?

    results = post_batch(entries)
    created = entries.each_with_index.filter_map do |entry, index|
      results[index] if entry.dig("request", "method") == "POST"
    end
    pending.zip(created).each do |label, result|
      label.number = accession_number(entry_resource!(result, "Specimen create"))
    end
    entries.each_with_index do |entry, index|
      entry_resource!(results[index], "Specimen update") if entry.dig("request", "method") == "PUT"
    end
  end

  def accession_number(specimen)
    number = specimen.dig("accessionIdentifier", "value").to_s
    raise UpstreamError, "Specimen/#{specimen['id']} has no label number" if number.blank?

    number
  end

  # 二重発行(同時クリック)で同じ容器の Specimen が 2 つできないよう conditional create にする。
  # 番号は送らず、上流が作成時に採番する。
  def create_entry(label, order, key)
    resource = {
      "resourceType" => "Specimen",
      "identifier" => [{ "system" => PATHO_CONTAINER_SYSTEM, "value" => key }],
      "accessionIdentifier" => { "system" => LABEL_NUMBER_SYSTEM },
      "subject" => { "reference" => order.dig("subject", "reference") },
      # オーダー(ワークリストが _revinclude で引く)と、どの検体の容器か(検体明細)。
      "request" => [
        { "reference" => "ServiceRequest/#{order_id}" },
        { "reference" => "ServiceRequest/#{label.item_id}" }
      ]
    }
    {
      "resource" => resource,
      "request" => {
        "method" => "POST", "url" => "Specimen",
        "ifNoneExist" => "identifier=#{CGI.escape(PATHO_CONTAINER_SYSTEM)}%7C#{CGI.escape(key)}"
      }
    }
  end

  def retire_entry(specimen)
    { "resource" => specimen.merge("status" => "entered-in-error"),
      "request" => { "method" => "PUT", "url" => "Specimen/#{specimen['id']}" } }
  end

  def revive_entry(specimen)
    { "resource" => specimen.except("status"),
      "request" => { "method" => "PUT", "url" => "Specimen/#{specimen['id']}" } }
  end

  def post_batch(entries)
    bundle = { "resourceType" => "Bundle", "type" => "batch", "entry" => entries }
    upstream = gateway.forward(
      method: :post, path: "/", body: bundle.to_json,
      headers: { "Content-Type" => "application/fhir+json" }
    )
    ensure_success!(upstream, "Specimen batch")
    Array(JSON.parse(upstream.body)["entry"])
  end
end
