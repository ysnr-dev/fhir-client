# 輸血関連情報カード PDF 生成のオーケストレータ(docs/transfusion-order-design.md §2.9)。
# JAHIS 患者安全ガイド(輸血編)7.1.3-3 の「輸血関連情報カード」。患者 1 人ぶんの血液型(検査結果と申告)・
# 不規則抗体(スクリーニングと同定した特異性)・造血幹細胞移植後の型・輸血歴・副作用歴を 1 枚にまとめる。
# 上流との往復は batch Bundle 1 本。読むだけで副作用は無い。
#   1. GET Patient/{id}
#   2. GET Observation?subject=…&code=…        -- 血液型(LOINC の申告 + 結果項目マスタの JLAC11/結果項目コード)・不規則抗体
#   3. GET Observation?subject=…&category=exam -- 不規則抗体の特異性・移植後の型(手入力)
#   4. GET Procedure?subject=…&category=輸血    -- 実施記録(バッグ・副作用を _revinclude)
#   5. GET 自院 Organization
class TransfusionCardReport
  include Reports::UpstreamBundle

  class NotFound < StandardError; end
  class UpstreamError < StandardError; end

  LAYOUT_PATH = Rails.root.join("lib/report_layouts/transfusion_card.tlf").freeze

  # frontend の fhir/bloodTypeHelpers.ts・transfusionProfileHelpers.ts・transfusionResultHelpers.ts と同じ定義。
  LOINC_SYSTEM = "http://loinc.org".freeze
  ABO_LOINC = "883-9".freeze
  RHD_LOINC = "10331-7".freeze
  BLOOD_TYPE_SOURCE_SYSTEM = "http://fhir-client.local/CodeSystem/blood-type-source".freeze
  RESULT_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/lab-result-item".freeze
  JLAC11_SYSTEM = "http://fhir-client.local/CodeSystem/jlac11".freeze
  ABO_ANALYTE = "K1001".freeze
  RHD_ANALYTE = "K1006".freeze
  ANTIBODY_SCREEN_ITEM_CODE = "160161410".freeze
  PROFILE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-profile".freeze
  IRREGULAR_ANTIBODY_CODE = "irregular-antibody".freeze
  TRANSPLANT_CODE = "transplant-blood-type".freeze
  TRANSFUSION_CATEGORY = "transfusion".freeze
  OBSERVATION_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-observation".freeze
  REACTION_CODE = "reaction".freeze
  LOT_NUMBER_EXT_URL = "http://fhir-client.local/StructureDefinition/transfusion-lot-number".freeze
  SOURCE_LABELS = { "tested" => "検査確定(手入力)", "reported" => "本人・家族の申告", "referred" => "他院からの情報" }.freeze
  RHD_LABELS = { "positive" => "＋", "negative" => "－" }.freeze
  ABO_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-abo".freeze
  RHD_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-rhd".freeze

  Section = Struct.new(:title, :lines, keyword_init: true)
  Line = Struct.new(:label, :value, :note, keyword_init: true)

  def initialize(patient_id, gateway: FhirGateway.new)
    @patient_id = patient_id
    @gateway = gateway
  end

  def generate
    patient, labs, profile, performs, organization = fetch_resources
    Reports::TransfusionCardRenderer.new(
      layout_path: LAYOUT_PATH, patient:, organization:,
      sections: build_sections(labs, profile, performs), printed_at: FacilityClock.now
    ).render
  end

  private

  attr_reader :patient_id, :gateway

  def fetch_resources
    self_organization_id = FacilitySettings.self_organization_id
    subject = CGI.escape("Patient/#{patient_id}")
    entries = [
      { "request" => { "method" => "GET", "url" => "Patient/#{CGI.escape(patient_id)}" } },
      { "request" => { "method" => "GET",
                       "url" => "Observation?subject=#{subject}&code=#{CGI.escape(blood_type_codes.join(','))}" \
                                "&_count=200&_sort=-date" } },
      { "request" => { "method" => "GET",
                       "url" => "Observation?subject=#{subject}&category=exam" \
                                "&code=#{CGI.escape("#{PROFILE_CODE_SYSTEM}|#{IRREGULAR_ANTIBODY_CODE},#{PROFILE_CODE_SYSTEM}|#{TRANSPLANT_CODE}")}" \
                                "&_count=20&_sort=-date" } },
      { "request" => { "method" => "GET",
                       "url" => "Procedure?subject=#{subject}&category=#{CGI.escape("#{ORDER_TYPE_SYSTEM}|#{TRANSFUSION_CATEGORY}")}" \
                                "&_revinclude=MedicationAdministration%3Apart-of&_revinclude=Observation%3Apart-of" \
                                "&_count=200&_sort=-date" } },
      { "request" => { "method" => "GET", "url" => institution_url(self_organization_id) } }
    ]
    bundle = { "resourceType" => "Bundle", "type" => "batch", "entry" => entries }
    upstream = gateway.forward(
      method: :post, path: "/", body: bundle.to_json,
      headers: { "Content-Type" => "application/fhir+json" }
    )
    ensure_success!(upstream, "batch bundle")
    results = Array(JSON.parse(upstream.body)["entry"])

    patient_status = results[0]&.dig("response", "status").to_i
    raise NotFound, "Patient/#{patient_id} not found" if patient_status == 404

    patient = entry_resource!(results[0], "Patient/#{patient_id}")
    raise NotFound, "Patient/#{patient_id} not found" unless patient["resourceType"] == "Patient"

    [
      patient,
      searchset_resources(results[1], "Observation", "blood type observations"),
      searchset_resources(results[2], "Observation", "profile observations"),
      searchset_resources(results[3], nil, "transfusion procedures"),
      find_institution(results[4], self_organization_id)
    ]
  end

  # 血液型と不規則抗体の検索コード。検査結果は施設の結果項目マスタから引く(frontend の bloodTypeLabSearchCodes と同じ)。
  def blood_type_codes
    codes = ["#{LOINC_SYSTEM}|#{ABO_LOINC}", "#{LOINC_SYSTEM}|#{RHD_LOINC}", "#{RESULT_ITEM_SYSTEM}|#{ANTIBODY_SCREEN_ITEM_CODE}"]
    Master::LabResultItem.where("jlac11_code LIKE ? OR jlac11_code LIKE ?", "#{ABO_ANALYTE}%", "#{RHD_ANALYTE}%").find_each do |item|
      codes << "#{RESULT_ITEM_SYSTEM}|#{item.result_item_code}"
      codes << "#{JLAC11_SYSTEM}|#{item.jlac11_code}" if item.jlac11_code.present?
    end
    codes.uniq
  end

  # ---- 内容 ----

  def build_sections(labs, profile, performs)
    [blood_type_section(labs), antibody_section(labs, profile), transplant_section(profile),
     history_section(performs), reaction_section(performs)].compact
  end

  def blood_type_section(labs)
    lines = []
    abo = labs.select { |o| analyte_of(o) == ABO_ANALYTE }
    rhd = labs.select { |o| analyte_of(o) == RHD_ANALYTE }
    lines << Line.new(label: "ABO(検査)", value: lab_type_label(abo) { |text| abo_label(text) })
    lines << Line.new(label: "RhD(検査)", value: lab_type_label(rhd) { |text| rhd_label(text) })
    manual_abo = labs.find { |o| loinc_of(o) == ABO_LOINC }
    manual_rhd = labs.find { |o| loinc_of(o) == RHD_LOINC }
    if manual_abo || manual_rhd
      primary = manual_abo || manual_rhd
      source = SOURCE_LABELS.fetch(primary.dig("method", "coding", 0, "code").to_s, "")
      type = [value_code(manual_abo, ABO_SYSTEM).presence&.then { |c| "#{c}型" },
              value_code(manual_rhd, RHD_SYSTEM).presence&.then { |c| "RhD#{RHD_LABELS.fetch(c, c)}" }].compact.join(" ")
      lines << Line.new(label: "申告", value: [type, source, date_of(primary)].compact_blank.join("　"))
    end
    Section.new(title: "血液型", lines:)
  end

  def antibody_section(labs, profile)
    lines = []
    screen = labs.find { |o| result_item_code_of(o).start_with?(ANTIBODY_SCREEN_ITEM_CODE) }
    lines << Line.new(label: "スクリーニング", value: screen ? [value_text(screen), date_of(screen)].compact_blank.join("　") : "未検査")
    specificity = profile.find { |o| profile_code_of(o) == IRREGULAR_ANTIBODY_CODE }
    if specificity
      lines << Line.new(label: "同定した抗体", value: [value_text(specificity), date_of(specificity)].compact_blank.join("　"),
                        note: note_of(specificity))
    end
    Section.new(title: "不規則抗体", lines:)
  end

  def transplant_section(profile)
    transplant = profile.find { |o| profile_code_of(o) == TRANSPLANT_CODE }
    return nil unless transplant

    Section.new(title: "造血幹細胞移植後の血液型", lines: [
      Line.new(label: "移植日", value: date_of(transplant).presence || "-"),
      Line.new(label: "輸血に使う型", value: value_text(transplant), note: note_of(transplant))
    ])
  end

  def history_section(performs)
    hubs = performs.select { |r| r["resourceType"] == "Procedure" && r["status"] != "entered-in-error" }
    lines = hubs.sort_by { |h| h.dig("performedPeriod", "start").to_s }.reverse.map do |hub|
      bags = performs.select do |r|
        r["resourceType"] == "MedicationAdministration" && r["status"] == "completed" && part_of?(r, hub)
      end
      Line.new(label: date_of_period(hub), value: bags.map { |bag| bag_label(bag) }.join("、").presence || "(製剤なし)")
    end
    Section.new(title: "輸血歴", lines: lines.presence || [Line.new(label: "-", value: "輸血歴なし")])
  end

  def reaction_section(performs)
    reactions = performs.select do |r|
      r["resourceType"] == "Observation" &&
        coding_by_system(r.dig("code", "coding"), OBSERVATION_SYSTEM)&.dig("code") == REACTION_CODE &&
        r.dig("valueCodeableConcept", "coding", 0, "code") == "present"
    end
    lines = reactions.sort_by { |r| r["effectiveDateTime"].to_s }.reverse.map do |reaction|
      symptoms = Array(reaction["component"]).filter_map { |c| c.dig("code", "coding", 0, "display") }.join("、")
      Line.new(label: date_of(reaction), value: [symptoms, note_of(reaction)].compact_blank.join(" / "))
    end
    Section.new(title: "副作用歴", lines: lines.presence || [Line.new(label: "-", value: "副作用の記録なし")])
  end

  # ---- 読み取り ----

  def analyte_of(observation)
    coding_by_system(observation.dig("code", "coding"), JLAC11_SYSTEM)&.dig("code").to_s[0, 5]
  end

  def loinc_of(observation)
    coding_by_system(observation.dig("code", "coding"), LOINC_SYSTEM)&.dig("code").to_s
  end

  def result_item_code_of(observation)
    coding_by_system(observation.dig("code", "coding"), RESULT_ITEM_SYSTEM)&.dig("code").to_s
  end

  def profile_code_of(observation)
    coding_by_system(observation.dig("code", "coding"), PROFILE_CODE_SYSTEM)&.dig("code").to_s
  end

  def value_code(observation, system)
    return "" unless observation

    coding_by_system(observation.dig("valueCodeableConcept", "coding"), system)&.dig("code").to_s
  end

  def value_text(observation)
    concept = observation["valueCodeableConcept"]
    return observation["valueString"].to_s if concept.nil?

    Array(concept["coding"]).find { |c| c["display"].present? }&.dig("display").presence || concept["text"].to_s
  end

  def note_of(observation)
    Array(observation["note"]).filter_map { |n| n["text"] }.join(" ")
  end

  def date_of(resource)
    Reports::PatientMeta.format_date(resource["effectiveDateTime"].to_s[0, 10])
  end

  def date_of_period(hub)
    Reports::PatientMeta.format_date(hub.dig("performedPeriod", "start").to_s[0, 10]).presence || "-"
  end

  def part_of?(resource, hub)
    Array(resource["partOf"]).any? { |ref| ref["reference"] == "Procedure/#{hub['id']}" }
  end

  # 異なる日の 2 検体で同じ型なら確定、1 回なら「1回」、食い違えば「不一致」(frontend の summarizeBloodType と同じ)。
  def lab_type_label(observations)
    return "未検査" if observations.empty?

    readable = observations.map { |o| [yield(value_text(o)), o["effectiveDateTime"].to_s[0, 10]] }.reject { |v, _| v.blank? }
    values = readable.map(&:first).uniq
    dates = readable.map(&:last).uniq.sort.reverse
    status = if values.size > 1 then "不一致"
             elsif dates.size >= 2 then "確定"
             else "1回"
             end
    [values.first.presence || value_text(observations.first), status, dates.map { |d| Reports::PatientMeta.format_date(d) }.join("、")]
      .compact_blank.join("　")
  end

  def abo_label(text)
    value = text.to_s.unicode_normalize(:nfkc).upcase.gsub(/型|TYPE|\s/, "")
    value = "O" if value == "0"
    %w[A B O AB].include?(value) ? "#{value}型" : ""
  end

  def rhd_label(text)
    value = text.to_s.unicode_normalize(:nfkc).upcase.gsub(/\s|RH|D|\(|\)|型/, "")
    return "RhD＋" if %w[+ 陽性 POSITIVE POS].include?(value)
    return "RhD－" if %w[- − 陰性 NEGATIVE NEG].include?(value)

    ""
  end

  def bag_label(bag)
    name = bag.dig("medicationCodeableConcept", "coding", 0, "display").presence || bag.dig("medicationCodeableConcept", "text").to_s
    dose = bag.dig("dosage", "dose")
    amount = dose && dose["value"] ? "#{dose['value']}#{dose['unit']}" : nil
    lot = Array(bag["extension"]).find { |e| e["url"] == LOT_NUMBER_EXT_URL }&.dig("valueString")
    [[name, amount].compact.join(" / "), lot.present? ? "No.#{lot}" : nil].compact.join(" ")
  end
end
