# 細菌検査の検体ラベル PDF 生成のオーケストレータ(docs/micro-order-design.md §7.6)。
# 1 ページ = 容器 1 つ。容器は検体の容器 1 つと、検体と別の容器で出す検査項目
# (血液培養のボトル。マスタの separate_container)1 項目ずつ。上流との往復は最大 2 回。
#   1. GET /ServiceRequest?_id={id} -- オーダー + 患者(_include)+ 明細・発行済みの容器(_revinclude)
#   2. batch Bundle POST /          -- まだ発行していない容器の Specimen 作成と、外れた容器の取り下げ
#
# 容器 1 つの台帳は上流の Specimen(検体検査・病理と同じ作り。docs/lab-arrival-design.md §6-1)。
# 番号も同じ accessionIdentifier の採番(LABEL_NUMBER_SYSTEM)で、院内で 1 つの通し番号にする。
# 細菌検査の容器は identifier(MICRO_CONTAINER_SYSTEM)に、検体の容器なら検体グループ明細の id、
# ボトルならその検査項目明細の id を持ち、これで容器を見分ける(項目を外したら取り下げ、
# 戻したら復帰。番号は容器ごとに固定)。
class MicroLabelReport
  include Reports::UpstreamBundle

  class NotFound < StandardError; end
  # 指定されたオーダーが細菌検査ではない(URL 直叩きなど)
  class NotMicroOrder < StandardError; end
  # 検体が無く、刷るラベルがない
  class NoLabelTarget < StandardError; end
  class UpstreamError < StandardError; end

  # 検体検査・病理のラベルと同じく、バーコードの読み取りに合わせた固定様式なので同梱する。
  LAYOUT_PATH = Rails.root.join("lib/report_layouts/micro_label.tlf").freeze

  # frontend の fhir/microOrderHelpers.ts と同じ system 定義。
  LABEL_NUMBER_SYSTEM = LabLabelReport::LABEL_NUMBER_SYSTEM
  MICRO_CONTAINER_SYSTEM = "http://fhir-client.local/IdSystem/micro-container".freeze
  MICRO_ORDER_CODE = "micro".freeze
  ITEM_NUMBER_SYSTEM = "http://fhir-client.local/IdSystem/micro-order-item-number".freeze
  ORDER_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/micro-order-item".freeze
  SPECIMEN_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/janis-specimen-type".freeze
  COLLECTION_METHOD_SYSTEM = "http://fhir-client.local/CodeSystem/micro-collection-method".freeze

  # ラベル 1 枚(容器 1 つ)ぶん。
  # key は台帳の容器の識別子、bottle は別容器の検査項目(検体の容器なら nil)。
  Label = Struct.new(
    :key, :group_id, :type, :specimen, :detail, :bottle, :planned, :collected, :container_number, :container_total, :number,
    keyword_init: true
  )

  def initialize(order_id, gateway: FhirGateway.new)
    @order_id = order_id
    @gateway = gateway
  end

  def generate
    order, patient, groups, items, specimens = fetch_order_resources
    labels = build_labels(groups, items)
    raise NoLabelTarget, "order #{order_id} has no specimens" if labels.empty?

    assign_numbers(labels, order, specimens)
    Reports::MicroLabelRenderer.new(layout_path: LAYOUT_PATH, order:, patient:, labels:).render
  end

  private

  attr_reader :order_id, :gateway

  # 検査項目は検体グループ明細の下にぶら下がるので :iterate で辿る。
  def fetch_order_resources
    query = "_id=#{CGI.escape(order_id)}" \
            "&_include=ServiceRequest%3Asubject" \
            "&_revinclude%3Aiterate=ServiceRequest%3Abased-on" \
            "&_revinclude=Specimen%3Arequest"
    upstream = gateway.forward(method: :get, path: "/ServiceRequest", query: query)
    ensure_success!(upstream, "ServiceRequest?_id=#{order_id}")
    resources = Array(JSON.parse(upstream.body)["entry"]).filter_map { |e| e["resource"] }

    order = resources.find { |r| r["resourceType"] == "ServiceRequest" && r["id"] == order_id }
    raise NotFound, "ServiceRequest/#{order_id} not found" unless order
    raise NotMicroOrder, "ServiceRequest/#{order_id} is not a micro order" unless micro_order?(order)

    order_reference = "ServiceRequest/#{order_id}"
    groups = resources.select do |r|
      r["resourceType"] == "ServiceRequest" && references?(r["basedOn"], order_reference) &&
        contained_specimen_of(r)
    end
    group_references = groups.map { |group| "ServiceRequest/#{group['id']}" }
    items = resources.select do |r|
      r["resourceType"] == "ServiceRequest" &&
        Array(r["basedOn"]).any? { |based_on| group_references.include?(based_on["reference"]) }
    end
    specimens = resources.select do |r|
      r["resourceType"] == "Specimen" && references?(r["request"], order_reference) && container_key(r)
    end
    [order, included_patient(resources, order), groups, items, specimens]
  end

  def micro_order?(order)
    Array(order["category"]).any? do |category|
      Array(category["coding"]).any? do |coding|
        coding["system"] == ORDER_TYPE_SYSTEM && coding["code"] == MICRO_ORDER_CODE
      end
    end
  end

  def references?(references, reference)
    Array(references).any? { |r| r["reference"] == reference }
  end

  def contained_specimen_of(request)
    reference = request.dig("specimen", 0, "reference").to_s
    return nil unless reference.start_with?("#")

    id = reference.delete_prefix("#")
    Array(request["contained"]).find { |r| r["resourceType"] == "Specimen" && r["id"] == id }
  end

  # ---- ラベルの組み立て ----

  # 検体ごとに、検体の容器(別容器でない項目があるとき。項目が無い検体も容器は要る)と
  # 別容器の項目を明細の順に並べる。容器番号はオーダー通し。
  def build_labels(groups, items)
    masters = Master::MicroOrderItem.where(item_code: items.filter_map { |item| item_code(item) })
                                    .index_by(&:item_code)
    labels = groups.sort_by { |group| item_number(group) }.flat_map do |group|
      specimen = contained_specimen_of(group)
      own = items.select { |item| references?(item["basedOn"], "ServiceRequest/#{group['id']}") }
                 .sort_by { |item| item_number(item) }
      bottles, shared = own.partition { |item| masters[item_code(item)]&.separate_container }

      base = {
        group_id: group["id"], type: specimen["type"], specimen: specimen_label(specimen),
        planned: group["occurrenceDateTime"].to_s,
        # 採取を記録していれば(docs/micro-order-design.md §7.7)、その日時を刷る。
        collected: specimen.dig("collection", "collectedDateTime").to_s
      }
      result = []
      if shared.any? || bottles.empty?
        names = shared.map { |item| item_short_name(item, masters) }.join("/")
        result << Label.new(**base, key: group["id"], detail: [method_name(specimen), names].compact_blank.join(" "))
      end
      bottles.each do |item|
        result << Label.new(**base, key: item["id"], bottle: item, detail: item_name(item))
      end
      result
    end
    labels.each_with_index do |label, index|
      label.container_number = index + 1
      label.container_total = labels.length
    end
    labels
  end

  def item_number(request)
    identifier_value(request, ITEM_NUMBER_SYSTEM).to_i
  end

  def item_code(item)
    coding_by_system(item.dig("code", "coding"), ORDER_ITEM_SYSTEM)&.dig("code")
  end

  def item_name(item)
    coding_by_system(item.dig("code", "coding"), ORDER_ITEM_SYSTEM)&.dig("display") || item.dig("code", "text").to_s
  end

  # ラベルは狭いので、項目はマスタの略称(塗抹・培養など)で並べる。
  def item_short_name(item, masters)
    masters[item_code(item)]&.short_name.presence || item_name(item)
  end

  # 「喀出痰 右 耳」。オーダー側が bodySite.text に左右込みの部位の表示を持たせている。
  def specimen_label(specimen)
    type = coding_by_system(specimen.dig("type", "coding"), SPECIMEN_TYPE_SYSTEM)&.dig("display") ||
           specimen.dig("type", "text")
    [type.presence || "検体未設定", specimen.dig("collection", "bodySite", "text")].compact_blank.join(" ")
  end

  def method_name(specimen)
    coding_by_system(specimen.dig("collection", "method", "coding"), COLLECTION_METHOD_SYSTEM)&.dig("display")
  end

  # ---- 番号の確保(台帳 = 上流の Specimen) ----

  def container_key(specimen)
    Array(specimen["identifier"]).find { |i| i["system"] == MICRO_CONTAINER_SYSTEM }&.dig("value").presence
  end

  # 発行済みの容器はその番号を使う(取り下げていたら戻す)。無い容器はまとめて作る。
  # いまの容器に当たらない発行済みの容器(項目・検体を外した)は取り下げる。
  def assign_numbers(labels, order, specimens)
    existing = specimens.index_by { |specimen| container_key(specimen) }
    wanted = labels.map(&:key)

    entries = []
    pending = []
    labels.each do |label|
      specimen = existing[label.key]
      if specimen
        label.number = accession_number(specimen)
        entries << revive_entry(specimen) if specimen["status"] == "entered-in-error"
      else
        pending << label
        entries << create_entry(label, order)
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
  # 番号は送らず、上流が作成時に採番する。検体の種別(type)と、ボトルなら項目名(container)を
  # 写しておき、到着確認の画面がオーダーを読み直さなくても何の容器かを出せるようにする。
  def create_entry(label, order)
    resource = {
      "resourceType" => "Specimen",
      "identifier" => [{ "system" => MICRO_CONTAINER_SYSTEM, "value" => label.key }],
      "accessionIdentifier" => { "system" => LABEL_NUMBER_SYSTEM },
      "subject" => { "reference" => order.dig("subject", "reference") },
      # オーダー(部門一覧が _revinclude で引く)と、どの検体の容器か(検体グループ明細)。
      "request" => [
        { "reference" => "ServiceRequest/#{order_id}" },
        { "reference" => "ServiceRequest/#{label.group_id}" }
      ]
    }
    resource["type"] = label.type if label.type
    resource["container"] = [{ "description" => item_name(label.bottle) }] if label.bottle
    {
      "resource" => resource,
      "request" => {
        "method" => "POST", "url" => "Specimen",
        "ifNoneExist" => "identifier=#{CGI.escape(MICRO_CONTAINER_SYSTEM)}%7C#{CGI.escape(label.key)}"
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
