# 検体ラベル PDF 生成のオーケストレータ(docs/lab-label-design.md)。
# 上流 FHIR サーバーから検体検査オーダー一式を 2 往復で取得し、検体・採取管ごとの
# グループ(採取管 1 本 = ラベル 1 枚)に畳んで PDF を組む。
#   1. GET /ServiceRequest/{id} -- 中身を見ないと患者参照が分からない
#   2. batch Bundle POST /      -- 明細検索(based-on)+ Patient read + 発行済み Specimen 検索
#
# 採取管 1 本の台帳は上流の Specimen リソース(docs/lab-arrival-design.md §6-1)。
# 発行 = そのオーダー(request)と検体(type)の Specimen を作ること。番号は
# accessionIdentifier に持たせ、再発行では既存の Specimen の番号をそのまま刷る。
# backend 側に残るのは番号の採番(LabLabelNumber)だけ。
class LabLabelReport
  # オーダーが上流に存在しない
  class NotFound < StandardError; end
  # 指定されたオーダーが検体検査ではない(URL 直叩きなど)
  class NotLabOrder < StandardError; end
  # 明細が 1 件もなく、刷るラベルがない
  class NoLabelTarget < StandardError; end
  # 上流が想定外の応答を返した
  class UpstreamError < StandardError; end

  # ラベルのレイアウト(.tlf)。院内で書き換える帳票ではない(様式はバーコードの
  # 読み取りに合わせて固定)ので、report_layouts への登録ではなくリポジトリ同梱の
  # ファイルを直接読む。環境ごとの登録作業が要らず、コードと様式の版が揃う。
  LAYOUT_PATH = Rails.root.join("lib/report_layouts/lab_label.tlf").freeze

  # frontend の fhir/labOrderHelpers.ts・labResultHelpers.ts と同じ system 定義。
  ORDER_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/order-type".freeze
  LAB_ORDER_CODE = "lab".freeze
  ORDER_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/lab-order-item".freeze
  ABBREVIATION_SYSTEM = "http://fhir-client.local/CodeSystem/lab-item-abbreviation".freeze
  JLAC11_SPECIMEN_SYSTEM = "http://fhir-client.local/CodeSystem/jlac11-specimen".freeze
  CONTAINER_SYSTEM = "http://fhir-client.local/CodeSystem/lab-container".freeze
  ITEM_NUMBER_SYSTEM = "http://fhir-client.local/IdSystem/lab-order-item-number".freeze
  # 検体・採取管を拡張で持っていた頃のオーダーの読み出し用。
  SPECIMEN_EXT_URL = "http://fhir-client.local/StructureDefinition/lab-order-specimen".freeze
  CONTAINER_EXT_URL = "http://fhir-client.local/StructureDefinition/lab-order-container".freeze

  # ラベル 1 枚ぶん。オーダー内の同じ検体(= 同じ採取管)の項目をまとめたもの。
  LabelGroup = Struct.new(
    :specimen_code, :specimen_name, :container_code, :container_name, :item_labels,
    keyword_init: true
  )

  def initialize(order_id, gateway: FhirGateway.new)
    @order_id = order_id
    @gateway = gateway
  end

  # PDF のバイト列を返す。
  def generate
    order = fetch_order
    items, patient, specimens = fetch_related_resources(order)
    groups = build_groups(items)
    raise NoLabelTarget, "order #{order_id} has no items" if groups.empty?

    labels = groups.map do |group|
      { group: group, number: ensure_specimen_number(group, order, specimens) }
    end

    Reports::LabLabelRenderer.new(layout_path: LAYOUT_PATH, order:, patient:, labels:).render
  end

  private

  attr_reader :order_id, :gateway

  def fetch_order
    upstream = gateway.forward(method: :get, path: "/ServiceRequest/#{order_id}")
    raise NotFound, "ServiceRequest/#{order_id} not found" if upstream.status == 404
    ensure_success!(upstream, "ServiceRequest/#{order_id}")

    order = JSON.parse(upstream.body)
    raise NotLabOrder, "ServiceRequest/#{order_id} is not a lab order" unless lab_order?(order)

    order
  end

  def lab_order?(order)
    Array(order["category"]).any? do |category|
      Array(category["coding"]).any? do |coding|
        coding["system"] == ORDER_TYPE_SYSTEM && coding["code"] == LAB_ORDER_CODE
      end
    end
  end

  # 明細検索・Patient read・発行済み Specimen 検索を 1 つの batch Bundle で取得する。
  # 明細はヘッダ直下(単独項目・パネル)だけでよい。パネルの構成項目は親と同じ検体で、
  # ラベルにはパネル名を刷るため取得しない。
  def fetch_related_resources(order)
    patient_id = patient_id_from(order)
    entries = [
      { "request" => { "method" => "GET",
                       "url" => "ServiceRequest?based-on=ServiceRequest/#{order_id}&_count=100" } },
      { "request" => { "method" => "GET", "url" => "Patient/#{patient_id}" } },
      { "request" => { "method" => "GET",
                       "url" => "Specimen?request=ServiceRequest/#{order_id}&_count=100" } }
    ]

    bundle = { "resourceType" => "Bundle", "type" => "batch", "entry" => entries }
    upstream = gateway.forward(
      method: :post,
      path: "/",
      body: bundle.to_json,
      headers: { "Content-Type" => "application/fhir+json" }
    )
    ensure_success!(upstream, "batch bundle")
    results = Array(JSON.parse(upstream.body)["entry"])

    items = searchset_resources(results[0], "ServiceRequest", "item search")
    specimens = searchset_resources(results[2], "Specimen", "specimen search")
    [items, entry_resource!(results[1], "Patient/#{patient_id}"), specimens]
  end

  def searchset_resources(entry, resource_type, context)
    Array(entry_resource!(entry, context)["entry"])
      .map { |e| e["resource"] }
      .select { |resource| resource&.dig("resourceType") == resource_type }
  end

  # ラベルの患者取り違えは重大なので、患者が引けない場合は生成を中止する。
  def patient_id_from(order)
    reference = order.dig("subject", "reference").to_s
    patient_id = reference[%r{\APatient/(.+)\z}, 1]
    raise UpstreamError, "ServiceRequest/#{order_id} has no patient subject" if patient_id.blank?

    patient_id
  end

  # ---- 番号の確保(台帳 = 上流の Specimen) ----

  # このグループの管の番号。発行済みの Specimen があればその番号(再発行)、
  # 無ければ採番して Specimen を作る。
  def ensure_specimen_number(group, order, specimens)
    existing = specimens.find { |s| label_specimen?(s) && specimen_type_code(s) == group.specimen_code }
    return accession_number(existing) if existing

    create_label_specimen(group, order)
  end

  # ラベル発行で作った Specimen(番号を持つ)。結果登録が作る Specimen は request を
  # 持たないので request 検索には掛からないが、番号の有無でも判定して取り違えを防ぐ。
  def label_specimen?(specimen)
    specimen.dig("accessionIdentifier", "system") == LabLabelNumber::SYSTEM
  end

  def specimen_type_code(specimen)
    coding_by_system(specimen.dig("type", "coding"), JLAC11_SPECIMEN_SYSTEM)&.dig("code").to_s
  end

  def accession_number(specimen)
    number = specimen.dig("accessionIdentifier", "value").to_s
    # 番号の無い Specimen に番号を刷ることはできない(刷ってもスキャンで引けない)。
    raise UpstreamError, "Specimen/#{specimen['id']} has no label number" if number.blank?

    number
  end

  def create_label_specimen(group, order)
    number = LabLabelNumber.allocate
    headers = { "Content-Type" => "application/fhir+json" }
    # 二重発行(同時クリック)で同じ管の Specimen が 2 つできないよう conditional create
    # にする。検体未設定のグループは type で識別できないため事前検索(batch)だけで守る
    # (稀な二重クリックで番号が 2 つ振られ得るが、どちらのラベルも読めるので実害は小さい)。
    if group.specimen_code.present?
      headers["If-None-Exist"] =
        "request=ServiceRequest/#{order_id}&type=#{group.specimen_code}"
    end

    upstream = gateway.forward(
      method: :post, path: "/Specimen",
      body: build_label_specimen(group, order, number).to_json, headers: headers
    )
    ensure_success!(upstream, "Specimen create")
    # 200 は conditional create が既存に合流した応答(同時発行の負け側)。
    # その場合は既存の番号を採用する(採番済みの number は欠番になるだけ)。
    accession_number(JSON.parse(upstream.body))
  end

  # 発行時点の Specimen。まだ採取していないので status は付けない
  # (到着確認が receivedTime と status: available を書き込む)。
  def build_label_specimen(group, order, number)
    resource = {
      "resourceType" => "Specimen",
      "accessionIdentifier" => { "system" => LabLabelNumber::SYSTEM, "value" => number },
      "subject" => { "reference" => order.dig("subject", "reference") },
      "request" => [{ "reference" => "ServiceRequest/#{order_id}" }]
    }
    if group.specimen_code.present?
      coding = { "system" => JLAC11_SPECIMEN_SYSTEM, "code" => group.specimen_code }
      coding["display"] = group.specimen_name if group.specimen_name.present?
      resource["type"] = { "coding" => [coding] }
      resource["type"]["text"] = group.specimen_name if group.specimen_name.present?
    end
    if group.container_code.present?
      coding = { "system" => CONTAINER_SYSTEM, "code" => group.container_code }
      coding["display"] = group.container_name if group.container_name.present?
      resource["container"] = [{ "type" => { "coding" => [coding] } }]
    end
    resource
  end

  # ---- 明細のグルーピング ----

  # 明細を検体コードでまとめる。frontend の groupBySpecimen と同じ規則で、
  # 伝票の並び(明細番号 identifier)を保ち、検体未設定のグループは最後に置く。
  def build_groups(items)
    groups = {}
    sorted = items.sort_by { |item| item_number(item) }

    sorted.each do |item|
      specimen = specimen_of(item)
      group = groups[specimen[:specimen_code]] ||= LabelGroup.new(
        specimen_code: specimen[:specimen_code],
        specimen_name: specimen[:specimen_name],
        container_code: specimen[:container_code],
        container_name: specimen[:container_name],
        item_labels: []
      )
      group.item_labels << item_label(item)
      # 同じ検体で採取管が食い違うことは無い想定だが、先に入った空を埋める。
      if group.container_code.blank?
        group.container_code = specimen[:container_code]
        group.container_name = specimen[:container_name]
      end
    end

    groups.values.sort_by { |group| group.specimen_code.present? ? [0, group.specimen_code] : [1, ""] }
  end

  def item_number(item)
    value = Array(item["identifier"]).find { |i| i["system"] == ITEM_NUMBER_SYSTEM }&.dig("value")
    value.to_i
  end

  def coding_by_system(codings, system)
    Array(codings).find { |coding| coding["system"] == system }
  end

  # ラベルに刷る項目名。狭いので略称(WBC など)を優先する。
  def item_label(item)
    codings = item.dig("code", "coding")
    abbreviation = coding_by_system(codings, ABBREVIATION_SYSTEM)&.dig("code")
    name = coding_by_system(codings, ORDER_ITEM_SYSTEM)&.dig("display") || item.dig("code", "text")
    abbreviation.presence || name.to_s
  end

  # 明細の検体・採取管。contained Specimen から読み、無ければ拡張(旧形式)を読む。
  def specimen_of(item)
    specimen = contained_specimen_of(item)
    type = coding_by_system(specimen&.dig("type", "coding"), JLAC11_SPECIMEN_SYSTEM) ||
           extension_coding(item, SPECIMEN_EXT_URL)
    container = coding_by_system(specimen&.dig("container", 0, "type", "coding"), CONTAINER_SYSTEM) ||
                extension_coding(item, CONTAINER_EXT_URL)

    {
      specimen_code: type&.dig("code").to_s,
      specimen_name: type&.dig("display").to_s,
      container_code: container&.dig("code").to_s,
      container_name: container&.dig("display").to_s
    }
  end

  def contained_specimen_of(item)
    reference = item.dig("specimen", 0, "reference").to_s
    return nil unless reference.start_with?("#")

    id = reference.delete_prefix("#")
    Array(item["contained"]).find { |r| r["resourceType"] == "Specimen" && r["id"] == id }
  end

  def extension_coding(item, url)
    Array(item["extension"]).find { |ext| ext["url"] == url }&.dig("valueCodeableConcept", "coding", 0)
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
