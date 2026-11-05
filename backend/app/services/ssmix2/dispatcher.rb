module Ssmix2
  # 書き込みの内容から、起こす SS-MIX2 メッセージを決める(docs/ssmix2-export-design.md §5.2)。
  # relevant? は記録の段階の前段フィルタ、plan は組み立ての段階で builder と対象リソースを並べる。
  module Dispatcher
    # 標準化ストレージの対象になりうるリソース。Observation は検体検査結果(DiagnosticReport と同じ
    # transaction)でだけ使うので、単独の書き込み(バイタル・看護観察)は対象にしない。
    # Procedure と MedicationAdministration は実施記録(処方・注射・放射線・内視鏡)。
    RESOURCE_TYPES = %w[
      Patient Encounter Appointment AllergyIntolerance Condition
      ServiceRequest MedicationRequest DiagnosticReport Procedure MedicationAdministration
    ].freeze

    # 書き込まれたリソース 1 件。resource は書いた内容(POST は応答の id を補い、Bundle 内の urn:uuid 参照を
    # 採番後の参照に置き換えたもの)。DELETE は resource が nil で type / id だけ持つ。
    Written = Struct.new(:method, :type, :id, :version, :resource, keyword_init: true)
    Plan = Struct.new(:builder, :written, keyword_init: true)

    module_function

    def relevant?(method, path, request)
      if transaction_bundle?(path, request)
        Array(request["entry"]).any? { |entry| relevant_entry?(entry) }
      else
        RESOURCE_TYPES.include?(resource_type_of(path, request))
      end
    end

    def transaction_bundle?(path, request)
      path.to_s.delete("/").empty? && request.is_a?(Hash) && request["resourceType"] == "Bundle" &&
        request["type"] == "transaction"
    end

    def relevant_entry?(entry)
      return false unless entry.is_a?(Hash)

      method = entry.dig("request", "method").to_s.upcase
      return false unless Ssmix2Transaction::METHODS.include?(method)

      RESOURCE_TYPES.include?(entry_type(entry))
    end

    def entry_type(entry)
      entry.dig("resource", "resourceType") || entry.dig("request", "url").to_s.split(%r{[/?]}).first
    end

    # 単体の書き込み。DELETE は body が無いのでパスから種別を取る。
    def resource_type_of(path, request)
      if request.is_a?(Hash) && request["resourceType"].present?
        request["resourceType"]
      else
        path.to_s.delete_prefix("/").split("/").first
      end
    end

    # transaction 1 件が書いたリソースの一覧。POST の id と版は transaction-response の location から補う。
    # 既定は対象のリソース(RESOURCE_TYPES)だけ。all: true は Observation・Specimen など、メッセージの中身に
    # 使う付随のリソースも含める。
    def written_resources(transaction, all: false)
      request = transaction.request
      if transaction_bundle?(transaction.path, request)
        entries = Array(request["entry"])
        responses = Array(transaction.response&.dig("entry"))
        urns = urn_map(entries, responses)
        entries.each_with_index.filter_map do |entry, index|
          next unless all ? written_entry?(entry) : relevant_entry?(entry)

          written_from_entry(entry, responses[index], urns)
        end
      else
        [written_single(transaction)]
      end
    end

    def written_entry?(entry)
      entry.is_a?(Hash) && Ssmix2Transaction::METHODS.include?(entry.dig("request", "method").to_s.upcase) && entry_type(entry).present?
    end

    # Bundle 内の fullUrl(urn:uuid)→ 採番後の参照("Procedure/12")。
    def urn_map(entries, responses)
      entries.each_with_index.each_with_object({}) do |(entry, index), map|
        full_url = entry["fullUrl"].to_s
        next unless full_url.start_with?("urn:")

        type, id = Fhir.split_reference(responses[index]&.dig("response", "location"))
        map[full_url] = "#{type}/#{id}" if type && id
      end
    end

    def written_from_entry(entry, response_entry, urns)
      method = entry.dig("request", "method").to_s.upcase
      resource = entry["resource"]
      type, id = Fhir.split_reference(response_entry&.dig("response", "location"))
      type ||= entry_type(entry)
      id ||= resource&.dig("id") || entry.dig("request", "url").to_s.split("/")[1]
      version = response_entry&.dig("response", "location").to_s[%r{_history/(\d+)}, 1]
      resource = resolve_urns(resource.merge("id" => id), urns) if resource && id
      Written.new(method: method, type: type, id: id, version: version&.to_i, resource: resource)
    end

    # リソースの中の urn:uuid 参照を採番後の参照に置き換える(同じ transaction の親子を辿れるようにする)。
    def resolve_urns(value, urns)
      return value if urns.empty?

      case value
      when Hash
        value.transform_values { |v| resolve_urns(v, urns) }
      when Array
        value.map { |v| resolve_urns(v, urns) }
      when String
        value.start_with?("urn:") ? urns.fetch(value, value) : value
      else
        value
      end
    end

    def written_single(transaction)
      type, id = Fhir.split_reference(transaction.path)
      type ||= resource_type_of(transaction.path, transaction.request)
      response = transaction.response
      resource = response.is_a?(Hash) && response["resourceType"] == type ? response : transaction.request
      id ||= resource&.dig("id")
      resource = resource.merge("id" => id) if resource.is_a?(Hash) && id
      version = response&.dig("meta", "versionId")
      Written.new(method: transaction.method, type: type, id: id, version: version&.to_i,
                  resource: transaction.method == "DELETE" ? nil : resource)
    end

    # 起こすメッセージ。種別ごとに 1 行足す。builder は書き込みの中身を見て対象外なら nil を返す。
    # MedicationRequest だけが書かれた transaction は、そのヘッダーのオーダーを 1 件として組み直す。
    # MedicationAdministration だけが書かれた transaction は、その実施(partOf の Procedure)を組み直す。
    def plan(transaction)
      written = written_resources(transaction)
      plans = written.flat_map do |w|
        case w.type
        when "Patient" then w.method == "DELETE" ? [] : [Plan.new(builder: Messages::AdtA08, written: w)]
        when "Encounter"
          next [] if w.method == "DELETE"

          [Messages::EncounterAdt, Messages::EncounterPlanAdt, Messages::EncounterAttendingAdt, Messages::EncounterLeaveAdt]
            .map { |b| Plan.new(builder: b, written: w) }
        when "Appointment" then w.method == "DELETE" ? [] : [Plan.new(builder: Messages::AppointmentA04, written: w)]
        when "AllergyIntolerance" then [Plan.new(builder: Messages::AdtA60, written: w)]
        when "Condition" then [Plan.new(builder: Messages::PprZd1, written: w)]
        when "ServiceRequest"
          [Messages::RdeO11, Messages::OmlO33, Messages::OmdO03, Messages::OmgO19].map { |b| Plan.new(builder: b, written: w) }
        when "DiagnosticReport" then [Messages::OulR22, Messages::OruR01].map { |b| Plan.new(builder: b, written: w) }
        when "Procedure" then [Messages::RasO17, Messages::OmiZ23].map { |b| Plan.new(builder: b, written: w) }
        else []
        end
      end
      plans + medication_header_plans(written) + administration_hub_plans(written) + child_procedure_hub_plans(written)
    end

    # ヘッダーが書かれていない MedicationRequest の書き込み(監査・調剤での更新)は、basedOn のヘッダーを
    # 読み直す Plan にする。
    def medication_header_plans(written)
      headers = written.filter_map { |w| w.id if w.type == "ServiceRequest" }
      written.select { |w| w.type == "MedicationRequest" && w.resource }
             .flat_map { |w| Array(w.resource["basedOn"]).filter_map { |b| Fhir.reference_id(b["reference"]) } }
             .uniq.reject { |id| headers.include?(id) }
             .map { |id| Plan.new(builder: Messages::RdeO11, written: Written.new(method: "PUT", type: "ServiceRequest", id: id, resource: nil)) }
    end

    # ハブの Procedure が書かれていない MedicationAdministration の書き込み(ロット番号の後入れなど)は、
    # partOf の実施を読み直す Plan にする。
    def administration_hub_plans(written)
      hub_ids_of(written, "MedicationAdministration").map do |id|
        Plan.new(builder: Messages::RasO17, written: Written.new(method: "PUT", type: "Procedure", id: id, resource: nil))
      end
    end

    # 子の Procedure(2 件目以降の手技)だけが書かれたときも、partOf のハブを読み直す。
    def child_procedure_hub_plans(written)
      hub_ids_of(written, "Procedure").flat_map do |id|
        hub = Written.new(method: "PUT", type: "Procedure", id: id, resource: nil)
        [Plan.new(builder: Messages::RasO17, written: hub), Plan.new(builder: Messages::OmiZ23, written: hub)]
      end
    end

    # type のリソースが partOf で指すハブ(Procedure)のうち、同じ transaction で書かれていないもの。
    def hub_ids_of(written, type)
      hubs = written.filter_map { |w| w.id if w.type == "Procedure" }
      written.select { |w| w.type == type && w.resource }
             .flat_map { |w| Array(w.resource["partOf"]).filter_map { |p| Fhir.reference_id(p["reference"]) if p["reference"].to_s.start_with?("Procedure/") } }
             .uniq.reject { |id| hubs.include?(id) }
    end
  end
end
