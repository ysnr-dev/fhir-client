# 処方箋 PDF 生成のオーケストレータ(docs/prescription-report-design.md)。
# 上流 FHIR サーバーから処方オーダー一式を 1 往復で取得し、RP ごとのグループに
# 畳んで PDF を組む。
#   batch Bundle POST / -- オーダー検索(患者を _include、明細を _revinclude)+ 自院 Organization
# オーダーは 1 件でも複数でもよく(一括発行)、複数なら渡された順に 1 つの PDF へ並べる。
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
  # external_qr は様式第2号を左半分に置いた A4 横で、右半分に JAHIS の QR コードを刷る
  # (施設設定 prescription_print.external_qr で切り替える)。
  LAYOUTS = {
    external: {
      path: Rails.root.join("lib/report_layouts/prescription_external.tlf").freeze,
      lines_per_page: 13,
      max_cols: 68
    },
    external_qr: {
      path: Rails.root.join("lib/report_layouts/prescription_external_qr.tlf").freeze,
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
  # 化学療法レジメンの適用 1 件の uuid。日オーダーは requisition に持つ(frontend の fhir/orderHeader.ts)。
  REGIMEN_INSTANCE_SYSTEM = "http://fhir-client.local/Identifier/regimen-instance".freeze
  # 後発品変更不可(frontend の prescriptionHelpers.ts と同じ定義)。変更可否は JP Core のコード
  # (0 = 変更可)、医療上必要か患者希望かは reason のローカルコードで区別する。
  SUBSTITUTION_PROHIBITED_SYSTEM =
    "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationSubstitutionProhibittedCategory".freeze
  SUBSTITUTION_BLOCK_REASON_SYSTEM =
    "http://fhir-client.local/CodeSystem/substitution-not-allowed-reason".freeze
  # 調剤指示(JP Core instructionForDispense 拡張、JAMI 調剤方法コード)。表示は選択肢の並び順。
  DISPENSE_INSTRUCTION_EXT_URL =
    "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_MedicationRequest_DispenseRequest_InstructionForDispense".freeze
  DISPENSE_INSTRUCTION_SYSTEM = "http://jami.jp/CodeSystem/DrugDispensePreparationMethod".freeze
  # JP Core の力価区分。「2 原薬量」の量は力価で、印刷では単位の後ろに「(力価)」を添える。
  DOSE_STRENGTH_TYPE_SYSTEMS = [
    "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationIngredientStrengthStrengthType",
    # JP Core に無いこの system の力価の印は読むだけ(書き込みには使わない)。
    "http://jpfhir.jp/fhir/core/CodeSystem/JP_MedicationIngredientStrengthStrengthType_CS"
  ].freeze

  # 用量が力価(原薬量)で指示されているか。
  def self.potency?(dosage)
    Array(dosage&.dig("doseAndRate", 0, "type", "coding")).any? do |coding|
      DOSE_STRENGTH_TYPE_SYSTEMS.include?(coding["system"]) && coding["code"] == "2"
    end
  end
  DISPENSE_INSTRUCTION_LABELS = { "OP" => "一包化", "C" => "粉砕", "SP" => "別包化", "MX" => "混合" }.freeze
  MEDICAL_NECESSITY = "medical-necessity".freeze
  PATIENT_REQUEST = "patient-request".freeze

  # RP 1 つぶん。同じ RP 番号の明細(MedicationRequest)をまとめたもの。
  # usage_code: 用法コード(16 桁)。usage_category_code: 用法の基本区分コード(1 内服 / 2 外用 / 3 注射 / 4 注入)。
  # supplement_codes: 補足用法(I/W/D/C)の [コード, 表示] の配列。dispense_codes: 調剤指示のコード(OP/C/SP/MX)。
  # いずれも QR コードの記録に使う(紙には supplement / dispense_instruction の表示を刷る)。
  RpGroup = Struct.new(
    :rp_number, :usage_name, :supplement, :dose_days, :dose_count, :usage_comment, :dispense_instruction,
    :medicines, :usage_code, :usage_category_code, :supplement_codes, :dispense_codes,
    keyword_init: true
  ) do
    def supplement_codes = self[:supplement_codes] || []
    def dispense_codes = self[:dispense_codes] || []
  end
  # substitution_block: 後発品変更不可(MEDICAL_NECESSITY / PATIENT_REQUEST)。変更可なら nil。
  # potency: 用量が力価(原薬量)。
  # dose: 量 1 つで扱うときの量(日数を持つ内服は 1 日量)。dose_text: 1 回量と 1 日量の併記(「1回1錠（1日3錠）」)。
  # code / general: 薬品コードと、それが一般名処方コードか(QR コードの記録用)。single: 1 回量。
  # uneven_codes: 不均等(V)の [コード, 表示] の配列。
  MedicineLine = Struct.new(:order_in_rp, :name, :dose, :unit, :potency, :comment, :uneven, :substitution_block,
                            :dose_text, :code, :general, :single, :uneven_codes, keyword_init: true) do
    def uneven_codes = self[:uneven_codes] || []
  end

  # 1 回の検索で引くオーダー数。
  SEARCH_SLICE = 100

  # order_ids は 1 件の id でも配列でもよい。
  def initialize(order_ids, gateway: FhirGateway.new)
    @order_ids = Array(order_ids).uniq
    @gateway = gateway
  end

  # PDF のバイト列を返す。1 件でも刷れないオーダーがあれば全体を止める(一部だけ刷ると
  # 発行済にしたオーダーと紙が食い違う)。
  def generate
    resources, organization = fetch_resources
    prescriptions = order_ids.map { |order_id| build_prescription(order_id, resources, organization) }
    Reports::PrescriptionRenderer.render(prescriptions)
  end

  private

  attr_reader :order_ids, :gateway

  # オーダー 1 件ぶんの PrescriptionRenderer の引数。
  def build_prescription(order_id, resources, organization)
    order = resources.find { |r| r["resourceType"] == "ServiceRequest" && r["id"] == order_id }
    raise NotFound, "ServiceRequest/#{order_id} not found" unless order
    unless prescription_order?(order)
      raise NotPrescriptionOrder, "ServiceRequest/#{order_id} is not a prescription order"
    end

    patient = included_patient(resources, order)
    if category_code(order, PRESCRIPTION_CATEGORY_SYSTEM) == BROUGHT_CATEGORY
      raise BroughtMedication, "order #{order_id} is a brought medication order"
    end

    medication_requests = resources.select do |r|
      r["resourceType"] == "MedicationRequest" &&
        Array(r["basedOn"]).any? { |ref| ref["reference"] == "ServiceRequest/#{order_id}" }
    end
    rps = build_rps(medication_requests)
    raise NoMedication, "order #{order_id} has no medication requests" if rps.empty?

    layout = LAYOUTS.fetch(layout_key(order))
    {
      layout_path: layout[:path],
      order:, patient:, organization:, rps:,
      lines_per_page: layout[:lines_per_page],
      max_cols: layout[:max_cols]
    }
  end

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

  # 院外は施設設定で QR コード付き(A4 横)に切り替わる。
  def layout_key(order)
    return :internal unless external?(order)

    FacilitySettings.prescription_print["external_qr"] ? :external_qr : :external
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
  def fetch_resources
    self_organization_id = FacilitySettings.self_organization_id
    searches = order_ids.each_slice(SEARCH_SLICE).map do |ids|
      { "request" => { "method" => "GET",
                       "url" => "ServiceRequest?_id=#{ids.map { |id| CGI.escape(id) }.join(',')}" \
                                "&_count=#{SEARCH_SLICE}" \
                                "&_include=ServiceRequest%3Asubject" \
                                "&_revinclude=MedicationRequest%3Abased-on" } }
    end
    entries = searches + [
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

    resources = results.first(searches.size).flat_map do |entry|
      searchset_resources(entry, nil, "ServiceRequest?_id=#{order_ids.join(',')}")
    end
    [resources, find_institution(results[searches.size], self_organization_id)]
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
      usage_coding = coding_by_system(dosage.dig("timing", "code", "coding"), USAGE_CODE_SYSTEM)
      group = groups[rp_number] ||= RpGroup.new(
        rp_number: rp_number,
        usage_name: usage_coding&.dig("display").to_s,
        usage_code: usage_coding&.dig("code").to_s,
        usage_category_code: coding_by_system(dosage.dig("timing", "code", "coding"),
                                              PrescriptionDose::USAGE_CATEGORY_SYSTEM)&.dig("code").to_s,
        dose_days: mr.dig("dispenseRequest", "expectedSupplyDuration", "value"),
        supplement: supplement_label(dosage),
        supplement_codes: supplementary_displays(dosage).reject { |code, _| code.start_with?("V") },
        dose_count: dosage.dig("timing", "repeat", "count"),
        usage_comment: usage_comment(dosage),
        dispense_instruction: dispense_instruction(mr),
        dispense_codes: dispense_codes(mr),
        medicines: []
      )
      amounts = PrescriptionDose.of(dosage)
      general = coding_by_system(mr.dig("medicationCodeableConcept", "coding"), GENERAL_ORDER_CODE_SYSTEM)
      uneven_codes = supplementary_displays(dosage).select { |code, _| code.start_with?("V") }.sort_by(&:first)
      group.medicines << MedicineLine.new(
        order_in_rp: identifier_value(mr, ORDER_IN_RP_SYSTEM).to_i,
        # 一般名処方(【般】〜)は一般名処方コードだけを持つので優先して引き、銘柄はレセ電コードの display。
        name: medicine_name(mr, [GENERAL_ORDER_CODE_SYSTEM, MEDICINE_CODE_SYSTEM]),
        code: (general || coding_by_system(mr.dig("medicationCodeableConcept", "coding"), MEDICINE_CODE_SYSTEM))
                &.dig("code").to_s,
        general: general.present?,
        dose: amounts.ordered,
        single: amounts.single,
        unit: amounts.unit.to_s,
        dose_text: amounts.text,
        potency: self.class.potency?(dosage),
        comment: mr.dig("note", 0, "text").to_s,
        uneven: uneven_codes.map(&:last).join("・"),
        uneven_codes: uneven_codes,
        substitution_block: substitution_block(mr)
      )
    end

    groups.values.sort_by(&:rp_number).each do |group|
      group.medicines.sort_by!(&:order_in_rp)
    end
  end

  # 「一包化・粉砕」のような表示。RP 内の明細は同じ値を持つので、最初の明細から取る。
  def dispense_instruction(medication_request)
    DISPENSE_INSTRUCTION_LABELS.slice(*dispense_codes(medication_request)).values.join("・")
  end

  # 調剤指示のコード(選択肢の並び順)。
  def dispense_codes(medication_request)
    codes = Array(medication_request.dig("dispenseRequest", "extension")).filter_map do |ext|
      next unless ext["url"] == DISPENSE_INSTRUCTION_EXT_URL

      coding_by_system(ext.dig("valueCodeableConcept", "coding"), DISPENSE_INSTRUCTION_SYSTEM)&.dig("code")
    end
    DISPENSE_INSTRUCTION_LABELS.keys & codes
  end

  def substitution_block(medication_request)
    substitution = medication_request["substitution"] || {}
    allowed = coding_by_system(substitution.dig("allowedCodeableConcept", "coding"),
                               SUBSTITUTION_PROHIBITED_SYSTEM)&.dig("code")
    return nil if allowed.blank? || allowed == "0"

    reason = coding_by_system(substitution.dig("reason", "coding"), SUBSTITUTION_BLOCK_REASON_SYSTEM)&.dig("code")
    reason == PATIENT_REQUEST ? PATIENT_REQUEST : MEDICAL_NECESSITY
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
