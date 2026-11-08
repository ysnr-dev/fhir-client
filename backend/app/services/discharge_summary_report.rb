# 退院時サマリー 1 件(Composition)の PDF のオーケストレータ。
# 上流からサマリー・患者・対象の入院・自院 Organization を batch Bundle 1 本で取得し、
# 入院の情報・記録の情報・セクションの本文を畳んでレンダラへ渡す。読むだけで副作用は無い。
#   batch Bundle POST / -- Composition 検索(患者と入院を _include)+ 自院 Organization
#
# 表示の規則は画面の内容表示(frontend の ClinicalNoteDetailPanel・fhir/encounterHelpers.ts)と同じ。
# セクションの本文は保存済みの text.div(選んだ病名・処方などは表示名が焼き付けてある)を平文にして刷る。
class DischargeSummaryReport
  include Reports::UpstreamBundle

  class NotFound < StandardError; end
  class NotDischargeSummary < StandardError; end
  class Draft < StandardError; end
  class UpstreamError < StandardError; end

  # 同梱レイアウト(A4 縦、全幅の list 1 本)。マスタ(report_layouts)には登録しない。
  LAYOUT_PATH = Rails.root.join("lib/report_layouts/discharge_summary.tlf").freeze

  # frontend の fhir/clinicalNoteHelpers.ts・encounterHelpers.ts と同じ定義。
  LOINC_SYSTEM = "http://loinc.org".freeze
  DISCHARGE_SUMMARY_CODE = "18842-5".freeze
  ORDER_DEPARTMENT_EXT_URL = PrescriptionReport::ORDER_DEPARTMENT_EXT_URL
  PARTICIPATION_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ParticipationType".freeze
  ATTENDING_CODE = "ATND".freeze
  DISCHARGE_DISPOSITION_SYSTEM = "http://terminology.hl7.org/CodeSystem/discharge-disposition".freeze
  DISCHARGE_DISPOSITIONS = {
    "home" => "自宅", "other-hcf" => "転院", "snf" => "施設入所", "hosp" => "院内転科",
    "aadvice" => "自己退院", "exp" => "死亡", "oth" => "その他"
  }.freeze
  STATUS_LABELS = { "final" => "確定", "amended" => "修正済み" }.freeze

  Admission = Struct.new(:admitted, :discharged, :stay_days, :department, :attending, :disposition,
                         keyword_init: true)
  Record = Struct.new(:recorded_at, :status, :author, :attester, :attested_at, :department, keyword_init: true)
  Section = Struct.new(:title, :paragraphs, keyword_init: true)

  def initialize(composition_id, gateway: FhirGateway.new)
    @composition_id = composition_id
    @gateway = gateway
  end

  def generate
    composition, patient, encounter, organization = fetch_resources
    Reports::DischargeSummaryRenderer.new(
      layout_path: LAYOUT_PATH, patient:, organization:,
      admission: build_admission(encounter), record: build_record(composition),
      sections: build_sections(composition), printed_at: FacilityClock.now
    ).render
  end

  private

  attr_reader :composition_id, :gateway

  def fetch_resources
    self_organization_id = FacilitySettings.self_organization_id
    entries = [
      { "request" => { "method" => "GET",
                       "url" => "Composition?_id=#{CGI.escape(composition_id)}" \
                                "&_include=Composition%3Asubject" \
                                "&_include=Composition%3Aencounter" } },
      { "request" => { "method" => "GET", "url" => institution_url(self_organization_id) } }
    ]
    bundle = { "resourceType" => "Bundle", "type" => "batch", "entry" => entries }
    upstream = gateway.forward(
      method: :post, path: "/", body: bundle.to_json,
      headers: { "Content-Type" => "application/fhir+json" }
    )
    ensure_success!(upstream, "batch bundle")
    results = Array(JSON.parse(upstream.body)["entry"])

    resources = searchset_resources(results[0], nil, "Composition?_id=#{composition_id}")
    composition = resources.find { |r| r["resourceType"] == "Composition" && r["id"] == composition_id }
    raise NotFound, "Composition/#{composition_id} not found" unless composition
    raise NotDischargeSummary, "Composition/#{composition_id} is not a discharge summary" unless summary?(composition)
    # 下書きは記録になる前のものなので刷らない(誤って渡ると確定した文書に見える)。
    raise Draft, "Composition/#{composition_id} is a draft" if composition["status"] == "preliminary"
    raise NotFound, "Composition/#{composition_id} was entered in error" if composition["status"] == "entered-in-error"

    [composition, included_patient(resources, composition), included_encounter(resources, composition),
     find_institution(results[1], self_organization_id)]
  end

  def summary?(composition)
    Array(composition.dig("type", "coding")).any? do |coding|
      coding["system"] == LOINC_SYSTEM && coding["code"] == DISCHARGE_SUMMARY_CODE
    end
  end

  # 入院が引けなくても内容は読めるので、入院の欄を空にして刷る。
  def included_encounter(resources, composition)
    encounter_id = composition.dig("encounter", "reference").to_s[%r{\AEncounter/(.+)\z}, 1]
    resources.find { |r| r["resourceType"] == "Encounter" && r["id"] == encounter_id }
  end

  def build_admission(encounter)
    return Admission.new if encounter.nil?

    admitted = encounter.dig("period", "start").to_s[0, 10]
    discharged = encounter.dig("period", "end").to_s[0, 10]
    Admission.new(
      admitted: Reports::PatientMeta.format_date(admitted),
      discharged: Reports::PatientMeta.format_date(discharged),
      stay_days: stay_days(admitted, discharged),
      department: encounter.dig("serviceProvider", "display").to_s,
      attending: attending_name(encounter),
      disposition: disposition_label(encounter)
    )
  end

  # 入院日を 1 日目と数える(画面の在院日数と同じ)。入院中なら今日まで。
  def stay_days(admitted, discharged)
    return nil if admitted.blank?

    (Date.parse(discharged.presence || FacilityClock.today.iso8601) - Date.parse(admitted)).to_i + 1
  rescue ArgumentError
    nil
  end

  def attending_name(encounter)
    participant = Array(encounter["participant"]).find do |p|
      Array(p["type"]).any? do |type|
        Array(type["coding"]).any? { |c| c["system"] == PARTICIPATION_TYPE_SYSTEM && c["code"] == ATTENDING_CODE }
      end
    end
    participant&.dig("individual", "display").to_s
  end

  def disposition_label(encounter)
    concept = encounter.dig("hospitalization", "dischargeDisposition")
    return "" unless concept

    code = coding_by_system(concept["coding"], DISCHARGE_DISPOSITION_SYSTEM)&.dig("code")
    DISCHARGE_DISPOSITIONS[code] || concept["text"].to_s
  end

  # 誰がいつ内容に責任を負ったか(legal の attester。無ければ先頭)を出す。
  def build_record(composition)
    attesters = Array(composition["attester"])
    attester = attesters.find { |a| a["mode"] == "legal" } || attesters.first
    Record.new(
      recorded_at: datetime_label(composition["date"]),
      status: STATUS_LABELS.fetch(composition["status"].to_s, composition["status"].to_s),
      author: Array(composition["author"]).filter_map { |author| author["display"].presence }.join("、"),
      attester: attester&.dig("party", "display").to_s,
      attested_at: datetime_label(attester&.dig("time")),
      department: Array(composition["extension"]).find { |e| e["url"] == ORDER_DEPARTMENT_EXT_URL }
                    &.dig("valueReference", "display").to_s
    )
  end

  def datetime_label(value)
    return "" if value.blank?

    Time.zone.parse(value).in_time_zone(FacilityClock::ZONE).strftime("%Y/%m/%d %H:%M")
  rescue ArgumentError
    value.to_s
  end

  # 保存の順(画面の固定順)のまま。本文の無いセクションは出さない。
  def build_sections(composition)
    Array(composition["section"]).filter_map do |section|
      paragraphs = Reports::XhtmlText.paragraphs(section.dig("text", "div"))
      next if paragraphs.empty?

      Section.new(title: section["title"].presence || section.dig("code", "coding", 0, "display").to_s,
                  paragraphs:)
    end
  end
end
