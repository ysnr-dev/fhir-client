require "rails_helper"
require "support/billing_fhir_fixtures"

RSpec.describe Integrations::ReceiptComputer::BillingClaimBuilder do
  let(:patient_id) { "pat-1" }
  let(:date) { "2026-09-20" }

  # 上流 FHIR の読み取りだけを差し替える。組み立ての正しさを見たいので HTTP は挟まない。
  let(:store) { BillingFhirFixtures::FakeStore.new }

  subject(:builder) { described_class.new(store: store) }

  def build = builder.call(patient_fhir_id: patient_id, perform_date: date)

  # 剤区分の割り当ては連携先ごとの話なので、日レセの電文に直したうえで確かめる。
  def orca_classes = Integrations::Orca::MedicalMessage.build(build.items).first

  def prescription_header(id: "rx-1", day: date)
    order_header(order_type: "prescription", id: id, date: day)
  end

  def medication_request(code:, dose:, category: "1", rp: "1", days: nil, as_needed: false, name: "薬",
                         parent: "rx-1", id: nil)
    timing_coding = [
      { "system" => "http://fhir-client.local/CodeSystem/medicine-usage", "code" => "1012040400000000" },
      { "system" => "http://fhir-client.local/CodeSystem/medicine-usage-basic-category", "code" => category }
    ]
    dosage = {
      "timing" => { "code" => { "coding" => timing_coding } },
      "doseAndRate" => [{ "doseQuantity" => { "value" => dose, "unit" => "錠" } }]
    }
    dosage["asNeededBoolean"] = true if as_needed

    request = {
      "resourceType" => "MedicationRequest", "id" => id || "mr-#{code}-#{rp}", "status" => "active",
      "authoredOn" => date,
      "identifier" => [
        { "system" => "http://jpfhir.jp/fhir/core/mhlw/IdSystem/Medication-RPGroupNumber", "value" => rp }
      ],
      "medicationCodeableConcept" => {
        "text" => name,
        "coding" => [{ "system" => "http://fhir-client.local/CodeSystem/medicine-code", "code" => code }]
      },
      "dosageInstruction" => [dosage],
      "basedOn" => [{ "reference" => "ServiceRequest/#{parent}" }]
    }
    if days
      request["dispenseRequest"] = { "expectedSupplyDuration" => { "value" => days, "unit" => "日" } }
    end
    request
  end

  describe "処方" do
    before { store.add(prescription_header) }

    it "groups a RP into one 剤 and carries the 用法コード and 投与日数" do
      store.add(medication_request(code: "610406089", dose: 3, days: 7, name: "A錠"),
                medication_request(code: "620098801", dose: 1, days: 7, name: "B錠"))

      items = build.items

      expect(items.length).to eq(1)
      expect(items.first.category).to eq(:oral)
      # 「回数」は内服では投与日数
      expect(items.first.days).to eq("7")
      expect(items.first.lines.map(&:code)).to eq(%w[610406089 620098801])
      expect(items.first.lines.map(&:kind).uniq).to eq([:medicine])
      expect(items.first.lines.first.unit).to eq("錠")
      expect(items.first.usage_code).to eq("1012040400000000")
    end

    it "splits separate RP numbers into separate 剤" do
      store.add(medication_request(code: "1", dose: 1, rp: "1"), medication_request(code: "2", dose: 1, rp: "2"))

      expect(build.items.length).to eq(2)
    end

    it "keeps two identical RPs apart (a RP is never merged into 回数)" do
      store.add(medication_request(code: "1", dose: 1, rp: "1"), medication_request(code: "1", dose: 1, rp: "2"))

      expect(build.items.length).to eq(2)
    end

    it "uses 頓服 for as-needed even though the 用法マスタ has no such category" do
      store.add(medication_request(code: "1", dose: 1, as_needed: true))

      expect(build.items.first.category).to eq(:as_needed)
      expect(orca_classes.first["Medical_Class"]).to eq("220")
    end

    it "uses 外用 for the topical category" do
      store.add(medication_request(code: "1", dose: 1, category: "2"))

      expect(build.items.first.category).to eq(:topical)
      expect(orca_classes.first["Medical_Class"]).to eq("230")
    end

    it "reports 注射 in a prescription as not sendable rather than dropping it silently" do
      store.add(medication_request(code: "1", dose: 1, category: "3", name: "注射薬"))

      result = build

      expect(result.items).to be_empty
      expect(result.skipped.map(&:name)).to eq(["注射薬"])
    end

    it "reports 一般名処方 as not sendable with the reason" do
      request = medication_request(code: "1", dose: 1, name: "【般】ファモチジン")
      request["medicationCodeableConcept"]["coding"] = [
        { "system" => "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationGeneralOrderCode", "code" => "x" }
      ]
      store.add(request)

      expect(build.skipped.first.reason).to include("一般名処方")
    end

    it "ignores prescriptions that were cancelled" do
      store.add(medication_request(code: "1", dose: 1).merge("status" => "revoked"))

      expect(build.items).to be_empty
      expect(build.skipped).to be_empty
    end

    it "collects by the 投与開始日 (occurrence), not the day the order was written" do
      store.add(prescription_header(id: "rx-2", day: "2026-09-19"),
                medication_request(code: "1", dose: 1, parent: "rx-2"))

      expect(build.items).to be_empty
      expect(store.searches.find { |type, _| type == "ServiceRequest" }.last["occurrence"]).to eq(date)
    end

    it "writes whole-number doses without a decimal point" do
      store.add(medication_request(code: "1", dose: 2.0))

      expect(build.items.first.lines.first.quantity).to eq("2")
    end
  end

  describe "実施入力を持たない種別(検体検査など)" do
    let(:lab_system) { "http://fhir-client.local/CodeSystem/lab-order-item" }

    it "resolves 項目コード to レセ電算コード through the 項目マスタ" do
      Master::LabOrderItem.create!(order_item_code: "L1", name: "末梢血液一般", receipt_code: "160008010")
      store.add(order_header(order_type: "lab"), order_detail(item_code: "L1", system: lab_system, name: "末梢血液一般"))

      items = build.items

      expect(items.length).to eq(1)
      expect(items.first.category).to eq(:lab)
      expect(items.first.lines.first.code).to eq("160008010")
      expect(items.first.lines.first.kind).to eq(:procedure)
      # 検体検査は「検査」の 600
      expect(orca_classes.first["Medical_Class"]).to eq("600")
    end

    it "carries the 点数表の区分番号 when the 診療行為マスタ knows the code" do
      Master::LabOrderItem.create!(order_item_code: "L1", name: "末梢血液一般", receipt_code: "160008010")
      medical_procedure!("160008010", name: "末梢血液一般検査", chapter: "D", section: "005")
      store.add(order_header(order_type: "lab"), order_detail(item_code: "L1", system: lab_system))

      expect(build.items.first.lines.first.section).to eq("D005")
    end

    it "reports items whose 項目マスタ has no レセ電算コード instead of dropping them" do
      Master::LabOrderItem.create!(order_item_code: "L2", name: "セット", receipt_code: nil)
      store.add(order_header(order_type: "lab"), order_detail(item_code: "L2", system: lab_system, name: "生化学セット"))

      result = build

      expect(result.items).to be_empty
      expect(result.skipped.map(&:name)).to eq(["生化学セット"])
      expect(result.skipped.first.reason).to include("レセプト電算コード")
    end

    it "keeps the 剤 for the items that did resolve" do
      Master::LabOrderItem.create!(order_item_code: "L1", name: "ok", receipt_code: "160008010")
      Master::LabOrderItem.create!(order_item_code: "L2", name: "ng", receipt_code: nil)
      store.add(order_header(order_type: "lab"),
                order_detail(item_code: "L1", system: lab_system, name: "ok"),
                order_detail(item_code: "L2", system: lab_system, name: "ng"))

      result = build

      expect(result.items.first.lines.length).to eq(1)
      expect(result.skipped.length).to eq(1)
    end

    it "does not treat a 処方 header (no order-type) as an order" do
      store.add(order_header(order_type: "prescription"))

      expect(build.items).to be_empty
      expect(build.skipped).to be_empty
    end

    it "says nothing about 種別 that have nothing to bill (看護指示・食事・他科依頼)" do
      store.add(order_header(order_type: "nursing", id: "n-1"), order_header(order_type: "meal", id: "m-1"),
                order_header(order_type: "consult", id: "c-1"))

      expect(build.skipped).to be_empty
    end

    it "reports order types whose 送り方 is not implemented yet, even without 明細" do
      store.add(order_header(order_type: "rehab", name: "運動器リハ"))

      expect(build.skipped.first.kind).to eq("リハビリ")
      expect(build.skipped.first.reason).to include("まだ医事会計へ送りません")
    end

    it "ignores a cancelled 伝票" do
      store.add(order_header(order_type: "lab").merge("status" => "revoked"),
                order_detail(item_code: "L1", system: lab_system))

      expect(build.items).to be_empty
      expect(build.skipped).to be_empty
    end
  end

  describe "実施記録を持つ種別" do
    let(:rad_system) { "http://fhir-client.local/CodeSystem/rad-order-item" }

    it "builds one 剤 from the hub: 手技 → 2 件目の手技 → 薬剤 → 材料 → コメント" do
      medical_procedure!("170001210", name: "胸部単純撮影", chapter: "E", section: "001")
      store.add(
        order_header(order_type: "rad"),
        procedure_hub(order_type: "rad", code: "170001210", name: "胸部単純撮影", note: "立位",
                      materials: [{ code: "700010000", name: "フィルム", quantity: 2, unit: "枚" }]),
        child_procedure(order_type: "rad", code: "170000210", name: "電子画像管理加算"),
        administration(code: "620009999", dose: 100, name: "造影剤")
      )

      items = build.items

      expect(items.length).to eq(1)
      item = items.first
      expect(item.category).to eq(:rad)
      expect(item.performed_at).to eq("2026-09-20T10:30:00+09:00")
      expect(item.source_ref).to eq("Procedure/proc-1")
      expect(item.lines.map { |l| [l.kind, l.code, l.quantity] }).to eq([
        [:procedure, "170001210", "1"],
        [:procedure, "170000210", "1"],
        [:medicine, "620009999", "100"],
        [:material, "700010000", "2"],
        [:comment, "810000001", nil]
      ])
      expect(item.lines.first.section).to eq("E001")
      expect(item.lines.last.name).to eq("立位")
      expect(item.lines[3].unit).to eq("枚")
      expect(orca_classes.first["Medical_Class"]).to eq("700")
    end

    it "translates 放射線の器材マスタ into the 特定器材コード" do
      Master::RadMaterial.create!(material_code: "RM1", name: "造影用シリンジ", receipt_material_code: "700090000")
      store.add(order_header(order_type: "rad"),
                procedure_hub(order_type: "rad", code: "170001210",
                              materials: [{ code: "RM1", name: "造影用シリンジ", quantity: 1,
                                            system: BillingFhirFixtures::RAD_MATERIAL }]))

      expect(build.items.first.lines.last.code).to eq("700090000")
    end

    it "reports 器材 that has no 特定器材コード instead of dropping it" do
      Master::RadMaterial.create!(material_code: "RM2", name: "未紐付け")
      store.add(order_header(order_type: "rad"),
                procedure_hub(order_type: "rad", code: "170001210",
                              materials: [{ code: "RM2", name: "未紐付け", system: BillingFhirFixtures::RAD_MATERIAL }]))

      expect(build.skipped.first.reason).to include("特定器材コード")
    end

    it "does not bill an order of the day that has no 実施記録" do
      Master::RadItem.create!(item_code: "R1", name: "胸部", receipt_code: "170001210")
      store.add(order_header(order_type: "rad", name: "胸部XP"),
                order_detail(item_code: "R1", system: rad_system))

      result = build

      expect(result.items).to be_empty
      expect(result.skipped.first.reason).to include("未実施")
    end

    it "does not bill the order twice when it has a 実施記録" do
      Master::RadItem.create!(item_code: "R1", name: "胸部", receipt_code: "170001210")
      store.add(order_header(order_type: "rad"), order_detail(item_code: "R1", system: rad_system),
                procedure_hub(order_type: "rad", code: "170001210"))

      expect(build.items.length).to eq(1)
      expect(build.skipped).to be_empty
    end

    it "bills from the order when its items need no 実施入力 and the 部門 marked the Task done" do
      Master::RadItem.create!(item_code: "R1", name: "胸部", receipt_code: "170001210", requires_perform_input: false)
      store.add(order_header(order_type: "rad"), order_detail(item_code: "R1", system: rad_system),
                task(order: "hdr-1", status: "completed"))

      expect(build.items.first.lines.first.code).to eq("170001210")
    end

    it "waits for the 部門 when its items need no 実施入力 but the Task is still open" do
      Master::RadItem.create!(item_code: "R1", name: "胸部", receipt_code: "170001210", requires_perform_input: false)
      store.add(order_header(order_type: "rad"), order_detail(item_code: "R1", system: rad_system),
                task(order: "hdr-1", status: "accepted"))

      expect(build.items).to be_empty
      expect(build.skipped.first.reason).to include("実施済になっていません")
    end

    it "merges identical 剤 into 回数 (the same 処置 done twice)" do
      store.add(order_header(order_type: "treatment"),
                procedure_hub(order_type: "treatment", code: "140000110", id: "p1", time: "09:00"),
                procedure_hub(order_type: "treatment", code: "140000110", id: "p2", time: "15:00"))

      items = build.items

      expect(items.length).to eq(1)
      expect(items.first.count).to eq("2")
      expect(orca_classes.first["Medical_Class_Number"]).to eq("2")
    end

    it "keeps 手術 and 麻酔 on one hub, letting the 連携先 split them by 章" do
      medical_procedure!("150000010", name: "手術", chapter: "K", section: "001")
      medical_procedure!("150233410", name: "閉鎖循環式全身麻酔５", chapter: "L", section: "008")
      store.add(order_header(order_type: "surgery"),
                procedure_hub(order_type: "surgery", code: "150000010", period_end: "2026-09-20T12:00:00+09:00"),
                child_procedure(order_type: "surgery", code: "150233410"),
                administration(code: "620001111", dose: 10, name: "麻酔薬"))

      expect(build.items.length).to eq(1)
      expect(orca_classes.map { |c| c["Medical_Class"] }).to eq(%w[500 540])
      expect(orca_classes.last["Medication_info"].map { |m| m["Medication_Code"] }).to eq(%w[150233410 620001111])
    end

    it "ignores hubs performed on another day even when the search returned them" do
      store.add(procedure_hub(order_type: "rad", code: "170001210", date: "2026-09-19"))

      expect(build.items).to be_empty
    end

    it "judges the day in Japan time" do
      hub = procedure_hub(order_type: "rad", code: "170001210")
      hub["performedDateTime"] = "2026-09-19T16:00:00Z"
      store.add(hub)

      expect(build.items.length).to eq(1)
    end

    it "reports 子 and 薬剤 whose hub is missing instead of dropping them" do
      store.add(administration(code: "620009999", dose: 1, name: "迷子の薬剤", hub: "gone"))

      expect(build.skipped.first.name).to eq("迷子の薬剤")
      expect(build.skipped.first.reason).to include("親")
    end

    it "does not touch the 麻酔チャート tree" do
      store.add(procedure_hub(order_type: "anesthesia-chart", code: nil))

      expect(build.items).to be_empty
      expect(build.skipped).to be_empty
    end

    it "reports a hub of a 種別 whose 送り方 is not implemented yet" do
      store.add(order_header(order_type: "transfusion", name: "輸血"),
                procedure_hub(order_type: "transfusion", code: nil))

      expect(build.items).to be_empty
      expect(build.skipped.map(&:kind)).to eq(["輸血"])
    end

    it "reports a 実施記録 that was stopped, and does not also call the order 未実施" do
      store.add(order_header(order_type: "injection"),
                procedure_hub(order_type: "injection", code: nil, status: "stopped"),
                administration(code: "620007342", dose: 1))

      result = build

      expect(result.items).to be_empty
      expect(result.skipped.length).to eq(1)
      expect(result.skipped.first.reason).to include("中止")
    end

    it "reports a 実施記録 marked 実施せず" do
      store.add(order_header(order_type: "injection"), procedure_hub(order_type: "injection", code: nil, status: "not-done"))

      expect(build.skipped.first.reason).to include("実施せず")
    end

    it "reports a 手技 recorded without a 診療行為コード" do
      hub = procedure_hub(order_type: "treatment", code: nil)
      hub["code"] = { "text" => "手入力の処置" }
      store.add(hub)

      expect(build.items).to be_empty
      expect(build.skipped.first.reason).to include("診療行為コード")
    end
  end

  describe "注射" do
    def injection(usage_type: nil, route: "IV", method: nil, ma_method: nil, drugs: [%w[620007342 2 袋]])
      store.add(order_header(order_type: "injection"), procedure_hub(order_type: "injection", code: nil))
      drugs.each_with_index do |(code, dose, unit), i|
        store.add(injection_request(id: "mr-#{code}", code: code, usage_type: usage_type, route: route, method: method),
                  administration(code: code, dose: dose.to_i, unit: unit, name: "薬#{i}", route: route,
                                 method: ma_method || method, request: "mr-#{code}"))
      end
      build
    end

    it "builds one 剤 of 薬剤 per 施用 and carries 経路・手技・用法種別 for the 連携先" do
      result = injection(usage_type: "drip", drugs: [%w[620007342 2 袋], %w[620001234 1 A]])

      item = result.items.first
      expect(result.items.length).to eq(1)
      expect(item.category).to eq(:injection)
      expect(item.lines.map { |l| [l.kind, l.code, l.quantity, l.unit] })
        .to eq([[:medicine, "620007342", "2", "袋"], [:medicine, "620001234", "1", "A"]])
      expect(item.route).to eq("IV")
      expect(item.usage_type).to eq("drip")
      expect(result.skipped).to be_empty
      expect(orca_classes.first["Medical_Class"]).to eq("330")
      expect(orca_classes.first["Medication_info"].map { |m| m["Medication_Code"] }).to eq(%w[620007342 620001234])
    end

    it "sends a ワンショット 静注 as 320" do
      injection(usage_type: "one-shot", method: "30")

      expect(orca_classes.first["Medical_Class"]).to eq("320")
    end

    it "sends 中心静脈 as 350 even when dripped" do
      injection(usage_type: "drip", method: "31")

      expect(orca_classes.first["Medical_Class"]).to eq("350")
    end

    it "sends 皮下・筋肉内 as 310" do
      injection(route: "IM", method: "33")

      expect(orca_classes.first["Medical_Class"]).to eq("310")
    end

    it "sends other 手技 (関節腔内 など) as 340" do
      injection(route: "OTHER", method: "3D")

      expect(orca_classes.first["Medical_Class"]).to eq("340")
    end

    it "falls back to the 投与経路 when the 手技 is not recorded" do
      injection(route: "SC")

      expect(orca_classes.first["Medical_Class"]).to eq("310")
    end

    it "reads the 手技 from the 実施記録 when the オーダー has none" do
      injection(route: "IV", ma_method: "31")

      expect(orca_classes.first["Medical_Class"]).to eq("350")
    end

    it "reads the 用法種別 from an order of another day (連日の注射) through the store" do
      store.add(procedure_hub(order_type: "injection", code: nil, order: "hdr-yesterday"),
                injection_request(id: "mr-old", usage_type: "drip", parent: "hdr-yesterday"),
                administration(code: "620007342", dose: 1, route: "IV", request: "mr-old"))

      expect(orca_classes.first["Medical_Class"]).to eq("330")
    end

    it "merges two identical 施用 into 回数 2" do
      store.add(order_header(order_type: "injection"),
                procedure_hub(order_type: "injection", code: nil, id: "p1", time: "09:00"),
                procedure_hub(order_type: "injection", code: nil, id: "p2", time: "21:00"),
                administration(code: "620007342", dose: 1, hub: "p1", id: "ma1", route: "IV", method: "30"),
                administration(code: "620007342", dose: 1, hub: "p2", id: "ma2", route: "IV", method: "30"))

      expect(build.items.length).to eq(1)
      expect(orca_classes.first["Medical_Class_Number"]).to eq("2")
      expect(orca_classes.first["Medical_Class"]).to eq("320")
    end

    it "does not bill an 注射 order of the day that has no 実施記録" do
      store.add(order_header(order_type: "injection", name: "点滴"),
                injection_request(id: "mr-1", usage_type: "drip"))

      result = build

      expect(result.items).to be_empty
      expect(result.skipped.first.reason).to include("未実施")
    end
  end
end
