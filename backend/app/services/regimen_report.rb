# 化学療法の帳票(実施計画書・患者向けスケジュール表)のオーケストレータ
# (docs/chemo-regimen-design.md §8.25)。適用 1 件(ヘッダの ServiceRequest)を起点に、
# 上流から 2 往復で読む。
#   batch Bundle POST / -- ヘッダ(患者を _include)+ 自院 Organization
#   GET /ServiceRequest  -- 日オーダー(requisition = 適用の uuid。明細と進捗 Task を _revinclude)
# 算出基準・治療目的・制吐リスクはレジメンマスタ(backend DB)から添える。
#
# 副作用は無い(読むだけ)。
class RegimenReport
  include Reports::UpstreamBundle

  class NotFound < StandardError; end
  class NotRegimenOrder < StandardError; end
  class NoDayOrders < StandardError; end
  class CycleNotFound < StandardError; end
  class TooManyOrders < StandardError; end
  class UpstreamError < StandardError; end

  # 同梱レイアウト(docs/report-mappings/regimen-01.md)。マスタ(report_layouts)には登録しない。
  PLAN_LAYOUT_PATH = Rails.root.join("lib/report_layouts/regimen_plan.tlf").freeze
  SCHEDULE_LAYOUT_PATH = Rails.root.join("lib/report_layouts/regimen_schedule.tlf").freeze

  # frontend の fhir/regimenOrderHelpers.ts / taskHelpers.ts と同じ定義。
  REGIMEN_ORDER_TYPE = "chemo-regimen".freeze
  REGIMEN_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/regimen".freeze
  REGIMEN_EXT_URL = "http://fhir-client.local/StructureDefinition/regimen".freeze
  REGIMEN_ORDER_EXT_URL = InjectionReport::REGIMEN_ORDER_EXT_URL
  REGIMEN_DOSE_EXT_URL = "http://fhir-client.local/StructureDefinition/regimen-dose".freeze
  REGIMEN_INSTANCE_SYSTEM = PrescriptionReport::REGIMEN_INSTANCE_SYSTEM
  TASK_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/task-code".freeze
  # 日オーダーの進捗。注射は注射の Task、内服は調剤の Task(どちらも無ければ依頼済)。
  PROGRESS_TASK_CODES = { injection: "injection", prescription: "rx-dispense" }.freeze
  INJECTION_CODE = InjectionReport::INJECTION_CODE
  USAGE_TYPE_EXT_URL = InjectionReport::USAGE_TYPE_EXT_URL
  MEDICINE_CODE_SYSTEM = PrescriptionReport::MEDICINE_CODE_SYSTEM
  RP_NUMBER_SYSTEM = PrescriptionReport::RP_NUMBER_SYSTEM
  ORDER_IN_RP_SYSTEM = PrescriptionReport::ORDER_IN_RP_SYSTEM
  ORDER_DEPARTMENT_EXT_URL = PrescriptionReport::ORDER_DEPARTMENT_EXT_URL
  # 日オーダーは 1 適用で多くても数十件。上限に届いたら黙って切らずに止める。
  DAY_ORDER_LIMIT = 500

  Application = Struct.new(
    :id, :code, :name, :status, :start_date, :cycle_days, :treatment_days, :planned_cycles,
    :bsa, :height, :weight, :setting, :problem, :comment, :department, :requester, keyword_init: true
  )
  # 日オーダー 1 件(注射 1 件 or 処方 1 件)。kind は :injection / :prescription。
  # height / weight / bsa はそのクールの投与量に使った体格(焼いていない日オーダーは nil)。
  DayOrder = Struct.new(
    :id, :kind, :date, :cycle, :day, :status, :reduction, :height, :weight, :bsa, :steps, keyword_init: true
  )
  # RP 1 つ = レジメンの投与ステップ 1 つ。notes は用法コメントの見出し以外(点滴時間・器材・注意)。
  # supply_days は内服の投与日数(注射は nil)。
  Step = Struct.new(:rp_number, :name, :usage_type, :usage, :notes, :supply_days, :drugs, keyword_init: true)
  Drug = Struct.new(:name, :role, :basis, :ratio, :dose, :unit, :packs, :pack_unit, :bsa, keyword_init: true)

  def initialize(order_id, gateway: FhirGateway.new)
    @order_id = order_id
    @gateway = gateway
  end

  # 実施計画書(1 クールぶん)。cycle が無ければ登録済みの最後のクール。
  def generate_plan(cycle: nil)
    header, patient, organization, orders = load
    cycles = orders.map(&:cycle).uniq.sort
    target = cycle.present? ? cycle.to_i : cycles.last
    raise CycleNotFound, "cycle #{cycle} is not registered" unless cycles.include?(target)

    Reports::RegimenPlanRenderer.new(
      layout_path: PLAN_LAYOUT_PATH,
      application: header, patient:, organization:, master: master_regimen(header),
      cycle: target, orders: orders.select { |o| o.cycle == target },
      cycle_start: cycle_starts(orders)[target], printed_on: FacilityClock.today
    ).render
  end

  # 患者向けのスケジュール表(登録済みのクール全部。1 ページ = 1 か月)。
  def generate_schedule
    header, patient, organization, orders = load
    Reports::RegimenScheduleRenderer.new(
      layout_path: SCHEDULE_LAYOUT_PATH,
      application: header, patient:, organization:,
      orders: orders.reject { |o| o.status == "cancelled" },
      cycle_starts: cycle_starts(orders), printed_on: FacilityClock.today
    ).render
  end

  private

  attr_reader :order_id, :gateway

  def load
    header_resource, patient, organization = fetch_header
    application = build_application(header_resource)
    orders = fetch_day_orders(header_resource, application)
    raise NoDayOrders, "regimen #{order_id} has no day orders" if orders.empty?

    [application, patient, organization, orders]
  end

  # クールの Day 1。日オーダーの日付 − (Day − 1) から逆算する(frontend の cycleStartDates と同じ。
  # 移動していても矛盾しない)。同じクールで食い違えば早い方。
  def cycle_starts(orders)
    orders.each_with_object({}) do |o, starts|
      start = Date.parse(o.date) - (o.day - 1)
      starts[o.cycle] = start if starts[o.cycle].nil? || start < starts[o.cycle]
    end
  end

  def master_regimen(application)
    Master::Regimen.find_by(regimen_code: application.code)
  end

  def fetch_header
    self_organization_id = FacilitySettings.self_organization_id
    entries = [
      { "request" => { "method" => "GET",
                       "url" => "ServiceRequest?_id=#{CGI.escape(order_id)}&_include=ServiceRequest%3Asubject" } },
      { "request" => { "method" => "GET", "url" => institution_url(self_organization_id) } }
    ]
    bundle = { "resourceType" => "Bundle", "type" => "batch", "entry" => entries }
    upstream = gateway.forward(
      method: :post, path: "/", body: bundle.to_json,
      headers: { "Content-Type" => "application/fhir+json" }
    )
    ensure_success!(upstream, "batch bundle")
    results = Array(JSON.parse(upstream.body)["entry"])

    resources = searchset_resources(results[0], nil, "ServiceRequest?_id=#{order_id}")
    header = resources.find { |r| r["resourceType"] == "ServiceRequest" && r["id"] == order_id }
    raise NotFound, "ServiceRequest/#{order_id} not found" unless header
    raise NotRegimenOrder, "ServiceRequest/#{order_id} is not a regimen order" unless regimen_header?(header)

    [header, included_patient(resources, header), find_institution(results[1], self_organization_id)]
  end

  def regimen_header?(sr)
    Array(sr["category"]).any? do |category|
      Array(category["coding"]).any? { |c| c["system"] == ORDER_TYPE_SYSTEM && c["code"] == REGIMEN_ORDER_TYPE }
    end
  end

  def build_application(sr)
    ext = Array(sr["extension"]).find { |e| e["url"] == REGIMEN_EXT_URL }
    coding = coding_by_system(sr.dig("code", "coding"), REGIMEN_CODE_SYSTEM)
    Application.new(
      id: sr["id"],
      code: coding&.dig("code").to_s,
      name: coding&.dig("display").presence || sr.dig("code", "text").to_s,
      status: sr["status"].to_s,
      start_date: Reports::OrderDates.order_day(sr),
      cycle_days: part(ext, "cycleDays", "valueInteger").to_i,
      treatment_days: part(ext, "treatmentDays", "valueInteger").to_i,
      planned_cycles: part(ext, "plannedCycles", "valueInteger"),
      bsa: part(ext, "bsa", "valueDecimal"),
      height: part(ext, "height", "valueDecimal"),
      weight: part(ext, "weight", "valueDecimal"),
      setting: Array(sr["category"]).filter_map do |c|
        coding_by_system(c["coding"], PrescriptionReport::SETTING_SYSTEM)&.dig("display")
      end.first.to_s,
      problem: sr.dig("reasonReference", 0, "display").to_s,
      comment: sr.dig("note", 0, "text").to_s,
      department: Array(sr["extension"]).find { |e| e["url"] == ORDER_DEPARTMENT_EXT_URL }
                                        &.dig("valueReference", "display").to_s,
      requester: sr.dig("requester", "display").to_s
    )
  end

  def fetch_day_orders(header, application)
    instance_id = identifier_value(header, REGIMEN_INSTANCE_SYSTEM)
    raise NoDayOrders, "regimen #{order_id} has no instance id" if instance_id.blank?

    query = URI.encode_www_form(
      [["requisition", "#{REGIMEN_INSTANCE_SYSTEM}|#{instance_id}"], ["based-on:missing", "true"],
       ["_sort", "occurrence"], ["_count", DAY_ORDER_LIMIT.to_s],
       ["_revinclude", "MedicationRequest:based-on"], ["_revinclude", "Task:focus"]]
    )
    upstream = gateway.forward(method: :get, path: "/ServiceRequest", query:)
    ensure_success!(upstream, "regimen day orders")
    bundle = JSON.parse(upstream.body)
    if Array(bundle["link"]).any? { |l| l["relation"] == "next" }
      raise TooManyOrders, "regimen #{order_id} has more than #{DAY_ORDER_LIMIT} day orders"
    end

    resources = Array(bundle["entry"]).filter_map { |e| e["resource"] }
    subject = header.dig("subject", "reference")
    requests = resources.select do |r|
      r["resourceType"] == "ServiceRequest" && r.dig("subject", "reference") == subject &&
        regimen_part(r, "regimen", "valueReference")&.dig("reference") == "ServiceRequest/#{application.id}"
    end
    mrs = resources.select { |r| r["resourceType"] == "MedicationRequest" }
    tasks = resources.select { |r| r["resourceType"] == "Task" }
    lookup = DrugLookup.new(application.code)
    requests.filter_map { |sr| build_day_order(sr, mrs, tasks, lookup) }
            .sort_by { |o| [o.date, o.kind == :injection ? 0 : 1] }
  end

  def build_day_order(sr, mrs, tasks, lookup)
    cycle = regimen_part(sr, "cycle", "valueInteger")
    day = regimen_part(sr, "day", "valueInteger")
    date = Reports::OrderDates.order_day(sr)
    return nil if cycle.nil? || day.nil? || date.blank?

    kind = injection?(sr) ? :injection : :prescription
    own = mrs.select { |mr| Array(mr["basedOn"]).any? { |ref| ref["reference"] == "ServiceRequest/#{sr['id']}" } }
    DayOrder.new(
      id: sr["id"], kind:, date:, cycle: cycle.to_i, day: day.to_i,
      status: progress_status(sr, tasks, kind),
      reduction: regimen_part(sr, "reduction", "valueString").to_s,
      height: regimen_part(sr, "height", "valueDecimal"),
      weight: regimen_part(sr, "weight", "valueDecimal"),
      bsa: regimen_part(sr, "bsa", "valueDecimal"),
      steps: build_steps(own, kind, lookup)
    )
  end

  def injection?(sr)
    Array(sr["category"]).any? do |category|
      Array(category["coding"]).any? { |c| c["system"] == ORDER_TYPE_SYSTEM && c["code"] == INJECTION_CODE }
    end
  end

  def progress_status(sr, tasks, kind)
    code = PROGRESS_TASK_CODES.fetch(kind)
    task = tasks.find do |t|
      t.dig("focus", "reference") == "ServiceRequest/#{sr['id']}" &&
        Array(t.dig("code", "coding")).any? { |c| c["system"] == TASK_CODE_SYSTEM && c["code"] == code }
    end
    task ? task["status"].to_s : "requested"
  end

  def build_steps(mrs, kind, lookup)
    groups = mrs.group_by { |mr| identifier_value(mr, RP_NUMBER_SYSTEM).to_i }
    groups.sort.map do |rp_number, items|
      items = items.sort_by { |mr| identifier_value(mr, ORDER_IN_RP_SYSTEM).to_i }
      dosage = items.first.dig("dosageInstruction", 0) || {}
      name, notes = split_step_comment(dosage.dig("additionalInstruction", 0, "text").to_s)
      Step.new(
        rp_number:, name:, notes:,
        usage_type: kind == :injection ? injection_usage_type(dosage) : "内服",
        usage: kind == :injection ? dosage["text"].to_s : dosage.dig("timing", "code", "text").to_s,
        supply_days: kind == :injection ? nil : items.first.dig("dispenseRequest", "expectedSupplyDuration", "value")&.to_i,
        drugs: items.map { |mr| build_drug(mr, name, lookup) }
      )
    end
  end

  def injection_usage_type(dosage)
    ext = Array(dosage["extension"]).find { |e| e["url"] == USAGE_TYPE_EXT_URL }
    ext&.dig("valueCodeableConcept", "coding", 0, "display").to_s
  end

  # 用法コメントは [見出し, 点滴時間, 器材, 注意] を「 / 」で並べたもの(frontend の stepComment)。
  # 見出しが無いと点滴時間・器材が先頭に来るので、それは見出しにしない(dayOrderStepNames と同じ判定)。
  def split_step_comment(comment)
    parts = comment.split(" / ").map(&:strip).compact_blank
    return ["", []] if parts.empty?
    return ["", parts] if parts.first.start_with?("器材:", "点滴時間")

    [parts.first, parts.drop(1)]
  end

  def build_drug(mr, step_name, lookup)
    dose_ext = Array(mr["extension"]).find { |e| e["url"] == REGIMEN_DOSE_EXT_URL }
    dose = mr.dig("dosageInstruction", 0, "doseAndRate", 0, "doseQuantity") || {}
    medicine_code = coding_by_system(mr.dig("medicationCodeableConcept", "coding"), MEDICINE_CODE_SYSTEM)&.dig("code")
    master = lookup.find(part(dose_ext, "drug", "valueInteger"), medicine_code, step_name)
    dose_unit = dose["unit"].to_s
    packs = part(dose_ext, "packs", "valueDecimal")
    Drug.new(
      name: medicine_name(mr, [MEDICINE_CODE_SYSTEM]),
      role: master ? DrugLookup::ROLE_LABELS[master.drug_role].to_s : "",
      basis: master ? DrugLookup.basis_label(master) : "",
      ratio: part(dose_ext, "ratio", "valueDecimal"),
      dose: dose["value"], unit: dose_unit,
      # 製剤数で保存した薬剤(換算を持たない)は投与量の欄がそのまま製剤数なので重ねない。
      packs: master&.resolved_unit_name.present? && dose_unit != master.resolved_unit_name ? packs : nil,
      pack_unit: master&.resolved_unit_name.to_s,
      bsa: part(dose_ext, "bsa", "valueDecimal")
    )
  end

  def regimen_part(sr, url, key)
    ext = Array(sr["extension"]).find { |e| e["url"] == REGIMEN_ORDER_EXT_URL }
    part(ext, url, key)
  end

  def part(ext, url, key)
    Array(ext&.dig("extension")).find { |e| e["url"] == url }&.dig(key)
  end

  # 日オーダーの薬剤 → レジメンマスタの薬剤。マスタの子は保存のたびに作り直されて id が変わるので
  # (§2 の丸ごと置換)、id で引けなければ同じ医薬品コード、それが複数ならステップ名で絞る。
  class DrugLookup
    ROLE_LABELS = {
      "anticancer" => "抗がん剤", "fluid" => "補液", "antiemetic" => "制吐剤",
      "premedication" => "前投薬", "supportive" => "支持療法", "other" => "その他"
    }.freeze

    def initialize(regimen_code)
      @drugs = regimen_code.present? ? Master::RegimenDrug.with_names.where(regimen_code:).to_a : []
      step_ids = @drugs.map(&:step_id).uniq
      @step_names = Master::RegimenStep.where(id: step_ids).pluck(:id, :name).to_h
    end

    def find(drug_id, medicine_code, step_name)
      by_id = @drugs.find { |d| d.id == drug_id.to_i } if drug_id
      return by_id if by_id && by_id.medicine_code == medicine_code

      candidates = @drugs.select { |d| d.medicine_code == medicine_code }
      return candidates.first if candidates.size <= 1

      candidates.find { |d| @step_names[d.step_id].to_s == step_name } || candidates.first
    end

    # 「85 mg/m²」「AUC 5」「250 mL」(frontend の doseBasisLabel と同じ)。
    def self.basis_label(drug)
      value = Reports::RegimenNumber.format(drug.dose_value)
      return "" if value.blank?

      unit = drug.dose_unit.to_s
      case drug.dose_basis
      when "auc" then "AUC #{value}"
      when "bsa" then "#{value} #{unit.presence || 'mg'}/m²"
      when "weight" then "#{value} #{unit.presence || 'mg'}/kg"
      when "fixed" then "#{value} #{unit.presence || 'mg'}/body"
      else "#{value} #{unit}".strip
      end
    end
  end
end
