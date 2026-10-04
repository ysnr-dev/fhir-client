# 処方箋 PDF 生成のオーケストレータ(docs/prescription-report-design.md)。
# 上流 FHIR サーバーから処方オーダー一式を 1 往復で取得し、RP ごとのグループに
# 畳んで PDF を組む。
#   batch Bundle POST / -- オーダー検索(患者を _include、明細を _revinclude)+ 自院 Organization
#
# 検体ラベル(LabLabelReport)と同じ作りだが、採番のような副作用は無い(何度呼んでも
# 読むだけ)。進捗 Task にも触らない -- 発行 = 受付の遷移は frontend が行い、この
# エンドポイントは再発行にもそのまま使う(検体ラベルと同じ設計判断)。
class PrescriptionReport
  include Reports::UpstreamBundle

  # オーダーが上流に存在しない
  class NotFound < StandardError; end
  # 指定されたオーダーが処方ではない(URL 直叩きなど)
  class NotPrescriptionOrder < StandardError; end
  # 明細が 1 件もなく、刷る処方内容がない
  class NoMedication < StandardError; end
  # 処方区分「持参」。継続した持参薬を院内処方に起こしたもので、調剤しないので処方箋も刷らない
  # (docs/brought-medication-design.md §4)
  class BroughtMedication < StandardError; end
  # 上流が想定外の応答を返した
  class UpstreamError < StandardError; end

  # 処方箋のレイアウト(.tlf)。国の様式(院外)と院内の定型なので、検体ラベルと同じく
  # report_layouts への登録ではなくリポジトリ同梱のファイルを直接読む
  # (docs/report-mappings/lab-label-01.md と同じ理由)。
  # lines_per_page / max_cols(半角換算)は各レイアウトの処方欄の寸法と対
  # (docs/report-mappings/prescription-01.md)。
  LAYOUTS = {
    external: {
      path: Rails.root.join("lib/report_layouts/prescription_external.tlf").freeze,
      lines_per_page: 13,
      max_cols: 68
    },
    internal: {
      path: Rails.root.join("lib/report_layouts/prescription_internal.tlf").freeze,
      lines_per_page: 27,
      max_cols: 82
    }
  }.freeze

  # frontend の fhir/prescriptionHelpers.ts と同じ system 定義。
  SETTING_SYSTEM = "http://fhir-client.local/CodeSystem/prescription-setting".freeze
  PRESCRIPTION_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/prescription-category".freeze
  BROUGHT_CATEGORY = "brought".freeze
  PRESCRIPTION_ORDER_TYPE = "prescription".freeze
  RP_NUMBER_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/IdSystem/Medication-RPGroupNumber".freeze
  ORDER_IN_RP_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/IdSystem/MedicationAdministrationIndex".freeze
  MEDICINE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-code".freeze
  GENERAL_ORDER_CODE_SYSTEM =
    "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationGeneralOrderCode".freeze
  USAGE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-usage".freeze
  # JAMI 補足用法コード(8 桁)。I/W/D/C は RP 単位の投与スケジュール、V は薬剤ごとの不均等投与。
  SUPPLEMENTARY_USAGE_SYSTEM = "urn:oid:1.2.392.200250.2.2.20.22".freeze
  ORDER_DEPARTMENT_EXT_URL = "http://fhir-client.local/StructureDefinition/order-department".freeze

  # RP 1 つぶん。同じ RP 番号の明細(MedicationRequest)をまとめたもの。
  RpGroup = Struct.new(
    :rp_number, :usage_name, :supplement, :dose_days, :dose_count, :usage_comment, :medicines,
    keyword_init: true
  )
  MedicineLine = Struct.new(:order_in_rp, :name, :dose, :unit, :comment, :uneven, keyword_init: true)

  def initialize(order_id, gateway: FhirGateway.new)
    @order_id = order_id
    @gateway = gateway
  end

  # PDF のバイト列を返す。
  def generate
    order, patient, medication_requests, organization = fetch_order_resources
    if category_code(order, PRESCRIPTION_CATEGORY_SYSTEM) == BROUGHT_CATEGORY
      raise BroughtMedication, "order #{order_id} is a brought medication order"
    end

    rps = build_rps(medication_requests)
    raise NoMedication, "order #{order_id} has no medication requests" if rps.empty?

    layout = LAYOUTS.fetch(external?(order) ? :external : :internal)
    Reports::PrescriptionRenderer.new(
      layout_path: layout[:path],
      order:, patient:, organization:, rps:,
      lines_per_page: layout[:lines_per_page],
      max_cols: layout[:max_cols]
    ).render
  end

  private

  attr_reader :order_id, :gateway

  # frontend の isPrescriptionServiceRequest と同じ判定(order-type|prescription)。
  def prescription_order?(order)
    category_code(order, ORDER_TYPE_SYSTEM) == PRESCRIPTION_ORDER_TYPE
  end

  # 院外処方(外来 かつ 処方区分「院外」)だけが国の様式。院内・入院すべてと、
  # 区分が読めないオーダーは簡易様式に倒す(不明なものを保険請求の様式で刷る方が事故)。
  def external?(order)
    setting = category_code(order, SETTING_SYSTEM)
    category = category_code(order, PRESCRIPTION_CATEGORY_SYSTEM)
    setting == "outpatient" && category == "external"
  end

  # category の並び順には依存せず、system で引く。
  def category_code(order, system)
    Array(order["category"]).each do |category|
      coding = coding_by_system(category["coding"], system)
      return coding["code"] if coding
    end
    nil
  end

  # オーダー・患者・明細・自院 Organization を 1 つの batch Bundle で取得する。
  # 患者はオーダーの subject を _include、明細は basedOn がオーダーを指す
  # MedicationRequest を _revinclude で添えてもらう。
  def fetch_order_resources
    self_organization_id = FacilitySettings.self_organization_id
    entries = [
      { "request" => { "method" => "GET",
                       "url" => "ServiceRequest?_id=#{CGI.escape(order_id)}" \
                                "&_include=ServiceRequest%3Asubject" \
                                "&_revinclude=MedicationRequest%3Abased-on" } },
      { "request" => { "method" => "GET", "url" => institution_url(self_organization_id) } }
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

    resources = searchset_resources(results[0], nil, "ServiceRequest?_id=#{order_id}")
    order = resources.find { |r| r["resourceType"] == "ServiceRequest" && r["id"] == order_id }
    raise NotFound, "ServiceRequest/#{order_id} not found" unless order
    unless prescription_order?(order)
      raise NotPrescriptionOrder, "ServiceRequest/#{order_id} is not a prescription order"
    end

    medication_requests = resources.select do |r|
      r["resourceType"] == "MedicationRequest" &&
        Array(r["basedOn"]).any? { |ref| ref["reference"] == "ServiceRequest/#{order_id}" }
    end
    [order, included_patient(resources, order), medication_requests,
     find_institution(results[1], self_organization_id)]
  end

  # ---- 明細のグルーピング ----

  # 明細を RP 番号でまとめる。frontend の groupByRp(prescriptionHelpers.ts)と同じ
  # 規則で、RP 番号・RP 内番号の昇順に並べる。用法・日数・回数は RP 内で共通なので
  # 最初の明細から取る。
  def build_rps(medication_requests)
    groups = {}
    medication_requests.each do |mr|
      rp_number = identifier_value(mr, RP_NUMBER_SYSTEM).to_i
      dosage = mr.dig("dosageInstruction", 0) || {}
      group = groups[rp_number] ||= RpGroup.new(
        rp_number: rp_number,
        usage_name: coding_by_system(dosage.dig("timing", "code", "coding"),
                                     USAGE_CODE_SYSTEM)&.dig("display").to_s,
        dose_days: mr.dig("dispenseRequest", "expectedSupplyDuration", "value"),
        supplement: supplement_label(dosage),
        dose_count: dosage.dig("timing", "repeat", "count"),
        usage_comment: usage_comment(dosage),
        medicines: []
      )
      group.medicines << MedicineLine.new(
        order_in_rp: identifier_value(mr, ORDER_IN_RP_SYSTEM).to_i,
        # 一般名処方(【般】〜)は一般名処方コードだけを持つので優先して引き、銘柄はレセ電コードの display。
        name: medicine_name(mr, [GENERAL_ORDER_CODE_SYSTEM, MEDICINE_CODE_SYSTEM]),
        dose: dosage.dig("doseAndRate", 0, "doseQuantity", "value"),
        unit: dosage.dig("doseAndRate", 0, "doseQuantity", "unit").to_s,
        comment: mr.dig("note", 0, "text").to_s,
        uneven: supplementary_displays(dosage).select { |code, _| code.start_with?("V") }
                                              .sort_by(&:first).map(&:last).join("・")
      )
    end

    groups.values.sort_by(&:rp_number).each do |group|
      group.medicines.sort_by!(&:order_in_rp)
    end
  end

  # 用法コメントは coding を持たない additionalInstruction(補足用法は coding を持つ)。
  def usage_comment(dosage)
    Array(dosage["additionalInstruction"]).find { |ai| Array(ai["coding"]).empty? }&.dig("text").to_s
  end

  # 補足用法コードと表示の組。表示は登録時に frontend(supplementaryUsage.ts)が入れたもの。
  def supplementary_displays(dosage)
    Array(dosage["additionalInstruction"]).flat_map { |ai| Array(ai["coding"]) }
                                          .select { |c| c["system"] == SUPPLEMENTARY_USAGE_SYSTEM && c["code"].present? }
                                          .map { |c| [c["code"], c["display"].to_s] }
  end

  # RP の補足用法(I/W/D/C)の表示。日付指定は 1 コード 6 日までなので、同じ月の続きは
  # 1 つにまとめる(「毎月1日・…・18日」「毎月22日・25日」→「毎月1日・…・25日」)。
  def supplement_label(dosage)
    labels = []
    supplementary_displays(dosage).reject { |code, _| code.start_with?("V") }.each do |code, display|
      month = display[/\A(毎月|\d+月)/] if code.start_with?("D")
      if month && labels.last.to_s[/\A(毎月|\d+月)/] == month
        labels[-1] = "#{labels.last}・#{display.delete_prefix(month)}"
      else
        labels << display
      end
    end
    labels.join("、")
  end
end
