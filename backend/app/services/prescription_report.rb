# 処方箋 PDF 生成のオーケストレータ(docs/prescription-report-design.md)。
# 上流 FHIR サーバーから処方オーダー一式を 1 往復で取得し、RP ごとのグループに
# 畳んで PDF を組む。
#   batch Bundle POST / -- オーダー検索(患者を _include、明細を _revinclude)+ 自院 Organization
#
# 検体ラベル(LabLabelReport)と同じ作りだが、採番のような副作用は無い(何度呼んでも
# 読むだけ)。進捗 Task にも触らない -- 発行 = 受付の遷移は frontend が行い、この
# エンドポイントは再発行にもそのまま使う(検体ラベルと同じ設計判断)。
class PrescriptionReport
  # オーダーが上流に存在しない
  class NotFound < StandardError; end
  # 指定されたオーダーが処方ではない(URL 直叩きなど)
  class NotPrescriptionOrder < StandardError; end
  # 明細が 1 件もなく、刷る処方内容がない
  class NoMedication < StandardError; end
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
  ORDER_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/order-type".freeze
  SETTING_SYSTEM = "http://fhir-client.local/CodeSystem/prescription-setting".freeze
  PRESCRIPTION_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/prescription-category".freeze
  RP_NUMBER_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/IdSystem/Medication-RPGroupNumber".freeze
  ORDER_IN_RP_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/IdSystem/MedicationAdministrationIndex".freeze
  MEDICINE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-code".freeze
  GENERAL_ORDER_CODE_SYSTEM =
    "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationGeneralOrderCode".freeze
  USAGE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-usage".freeze
  ORDER_DEPARTMENT_EXT_URL = "http://fhir-client.local/StructureDefinition/order-department".freeze
  # 保険医療機関コード(自院 Organization の identifier)。
  INSTITUTION_NO_SYSTEM =
    "http://jpfhir.jp/fhir/core/IdSystem/insurance-medical-institution-no".freeze

  # RP 1 つぶん。同じ RP 番号の明細(MedicationRequest)をまとめたもの。
  RpGroup = Struct.new(
    :rp_number, :usage_name, :dose_days, :dose_count, :usage_comment, :medicines,
    keyword_init: true
  )
  MedicineLine = Struct.new(:order_in_rp, :name, :dose, :unit, :comment, keyword_init: true)

  def initialize(order_id, gateway: FhirGateway.new)
    @order_id = order_id
    @gateway = gateway
  end

  # PDF のバイト列を返す。
  def generate
    order, patient, medication_requests, organization = fetch_order_resources
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

  # 処方はオーダー種別(order-type)を持たない(注射より前から存在するための規約。
  # frontend の isPrescriptionServiceRequest と同じ判定)。
  def prescription_order?(order)
    Array(order["category"]).none? do |category|
      Array(category["coding"]).any? { |coding| coding["system"] == ORDER_TYPE_SYSTEM }
    end
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

  # 自院 Organization の取得 URL。自院が設定済み(管理 > 施設設定)ならそれを
  # read する。未設定の環境では保険医療機関番号の system だけで検索
  # する(Organization 検索に type は無く、未知のパラメータでは全件が返るため
  # identifier で引くしかない)。この検索は「番号を持つ最初の 1 件」を自院と
  # みなすので、連携先医療機関に番号を登録していると取り違えうる。自院設定を
  # 入れればその曖昧さは消える。
  def institution_url(self_organization_id)
    return "Organization/#{self_organization_id}" if self_organization_id

    "Organization?identifier=#{CGI.escape(INSTITUTION_NO_SYSTEM)}%7C&_count=10"
  end

  # 処方箋の患者取り違えは重大なので、患者が引けない場合は生成を中止する
  # (検体ラベルと同じ判断)。_include で届いた Patient のうち、オーダーの subject と
  # id が一致するものだけを使う。
  def included_patient(resources, order)
    reference = order.dig("subject", "reference").to_s
    patient_id = reference[%r{\APatient/(.+)\z}, 1]
    raise UpstreamError, "ServiceRequest/#{order_id} has no patient subject" if patient_id.blank?

    patient = resources.find { |r| r["resourceType"] == "Patient" && r["id"] == patient_id }
    raise UpstreamError, "Patient/#{patient_id} was not included for ServiceRequest/#{order_id}" unless patient

    patient
  end

  # 自院の Organization。取得できなくても発行は止めない(医療機関欄が空欄になる
  # だけで、処方内容は読める)。自院設定済みなら read の応答をそのまま使い、
  # 未設定なら検索結果から identifier を実際に持つ 1 件を選ぶ(上流が未知の
  # パラメータを無視して全件を返す場合への防御)。
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
        dose_count: dosage.dig("timing", "repeat", "count"),
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

    groups.values.sort_by(&:rp_number).each do |group|
      group.medicines.sort_by!(&:order_in_rp)
    end
  end

  def identifier_value(mr, system)
    Array(mr["identifier"]).find { |i| i["system"] == system }&.dig("value").to_s
  end

  # 薬品名。一般名処方(【般】〜)は一般名処方コードだけを持つので優先して引き、
  # 銘柄はレセ電コードの display、どちらも無ければ text に落ちる。
  def medicine_name(mr)
    codings = mr.dig("medicationCodeableConcept", "coding")
    coding = coding_by_system(codings, GENERAL_ORDER_CODE_SYSTEM) ||
             coding_by_system(codings, MEDICINE_CODE_SYSTEM)
    coding&.dig("display").presence || mr.dig("medicationCodeableConcept", "text").to_s
  end

  def coding_by_system(codings, system)
    Array(codings).find { |coding| coding["system"] == system }
  end

  # resource_type が nil なら型を問わず返す(_include / _revinclude で型が混ざる検索)。
  def searchset_resources(entry, resource_type, context)
    Array(entry_resource!(entry, context)["entry"])
      .filter_map { |e| e["resource"] }
      .select { |resource| resource_type.nil? || resource["resourceType"] == resource_type }
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
