# 削除の来歴(docs/features/karte.md「削除の記録」)。中継を通る診療記録の削除に、
# 誰が・いつ・なぜ消したかの Provenance を同じ transaction で添える。
#
# 上流は論理削除で、削除の版に直前の内容と日時は残すが、操作した人は残さない(上流には
# backend のトークンしか届かない)。ログイン本人を知っているのは中継だけなので、ここで付ける。
# 理由は画面が X-Delete-Reason ヘッダ(encodeURIComponent した文字列)で渡す。
class FhirDeleteProvenance
  REASON_HEADER = "X-Delete-Reason".freeze
  REASON_MAX_LENGTH = 200

  ACTIVITY_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-DataOperation".freeze
  AGENT_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/provenance-participant-type".freeze
  NAME_REPRESENTATION_URL = "http://hl7.org/fhir/StructureDefinition/iso21090-EN-representation".freeze

  # 来歴を残す型。患者の診療の記録になるもの。進捗・通知の Task、マスタ、来歴そのものは対象外。
  RECORDED_TYPES = %w[
    Patient Composition ServiceRequest MedicationRequest MedicationAdministration MedicationDispense
    MedicationStatement QuestionnaireResponse Observation DiagnosticReport Specimen Procedure Condition
    AllergyIntolerance DocumentReference Flag CarePlan Goal Encounter Appointment ImagingStudy
  ].freeze

  # "Composition/abc" の形(条件付き削除の "Type?criteria" は対象が分からないので外す)。
  REFERENCE_PATTERN = %r{\A([A-Za-z]+)/([A-Za-z0-9\-.]{1,64})\z}

  # actor は current_user_payload({ login_id:, practitioner_id: })。ログイン無しの環境では nil。
  def initialize(actor:, reason: nil, store: Integrations::FhirStore.new)
    @actor = actor
    @reason = normalize_reason(reason)
    @store = store
  end

  def self.recorded_reference?(reference)
    match = REFERENCE_PATTERN.match(reference.to_s)
    match.present? && RECORDED_TYPES.include?(match[1])
  end

  # transaction Bundle(Hash)に来歴の entry を足したもの。対象の削除が無ければ nil。
  def bundle_with_provenance(bundle)
    return nil unless bundle.is_a?(Hash) && bundle["resourceType"] == "Bundle" && bundle["type"] == "transaction"

    targets = Array(bundle["entry"]).filter_map do |entry|
      next unless entry.is_a?(Hash) && entry.dig("request", "method").to_s.upcase == "DELETE"

      url = entry.dig("request", "url").to_s
      url if self.class.recorded_reference?(url)
    end.uniq
    return nil if targets.empty?

    bundle.merge("entry" => Array(bundle["entry"]) + [provenance_entry(targets)])
  end

  # 単体の DELETE(/Type/id)を、来歴付きの transaction に組み直す。
  def transaction_for(reference, if_match: nil)
    request = { "method" => "DELETE", "url" => reference }
    request["ifMatch"] = if_match if if_match.present?
    {
      "resourceType" => "Bundle",
      "type" => "transaction",
      "entry" => [{ "request" => request }, provenance_entry([reference])]
    }
  end

  private

  attr_reader :actor, :reason, :store

  def provenance_entry(targets)
    provenance = {
      "resourceType" => "Provenance",
      "target" => targets.map { |reference| { "reference" => reference } },
      "recorded" => FacilityClock.now.iso8601(3),
      "activity" => { "coding" => [{ "system" => ACTIVITY_SYSTEM, "code" => "DELETE" }] },
      "agent" => [{
        "type" => { "coding" => [{ "system" => AGENT_TYPE_SYSTEM, "code" => "enterer" }] },
        "who" => who
      }]
    }
    provenance["reason"] = [{ "text" => reason }] if reason.present?
    {
      "fullUrl" => "urn:uuid:#{SecureRandom.uuid}",
      "resource" => provenance,
      "request" => { "method" => "POST", "url" => "Provenance" }
    }
  end

  # 医療従事者なら Practitioner 参照と氏名、それ以外(管理者・ログイン無し)はログイン名だけ。
  def who
    practitioner_id = actor&.dig(:practitioner_id).presence
    return { "display" => actor&.dig(:login_id).presence || "不明" } unless practitioner_id

    { "reference" => "Practitioner/#{practitioner_id}", "display" => practitioner_name(practitioner_id) }.compact
  end

  # 画面の表示名(fhir/humanName.ts の displayJapaneseName)と同じく、漢字表記を姓 名で。
  def practitioner_name(id)
    names = Array(store.read_or_nil("Practitioner", id)&.dig("name"))
    name = names.find { |n| representation(n) == "IDE" } || names.find { |n| representation(n).nil? } || names.first
    return actor&.dig(:login_id) if name.nil?

    [name["family"], Array(name["given"]).first].compact_blank.join(" ").presence || actor&.dig(:login_id)
  rescue StandardError => e
    Rails.logger.warn("[delete-provenance] 医療従事者の氏名を読めませんでした: #{e.class}: #{e.message}")
    actor&.dig(:login_id)
  end

  def representation(name)
    Array(name["extension"]).find { |ext| ext["url"] == NAME_REPRESENTATION_URL }&.dig("valueCode")
  end

  def normalize_reason(raw)
    return nil if raw.blank?

    text = URI.decode_www_form_component(raw.to_s).strip
    text.presence&.slice(0, REASON_MAX_LENGTH)
  rescue ArgumentError
    nil
  end
end
