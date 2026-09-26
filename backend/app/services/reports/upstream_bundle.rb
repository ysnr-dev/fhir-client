module Reports
  # 帳票のオーケストレータが上流 FHIR サーバーの応答(検索結果・batch Bundle)を読む共通処理。
  # 想定外の応答は include 先の UpstreamError で上げる(コントローラは帳票の種類ごとに
  # rescue するので、例外クラスは各オーケストレータが持つ)。
  module UpstreamBundle
    # frontend の fhir/*Helpers.ts と同じ system 定義。
    ORDER_TYPE_SYSTEM = Integrations::ReceiptComputer::Coding::ORDER_TYPE
    # 保険医療機関コード(自院 Organization の identifier)。
    INSTITUTION_NO_SYSTEM =
      "http://jpfhir.jp/fhir/core/IdSystem/insurance-medical-institution-no".freeze

    private

    def upstream_error!(message)
      raise self.class::UpstreamError, message
    end

    def ensure_success!(upstream, context)
      return if (200..299).cover?(upstream.status)

      upstream_error!("upstream returned #{upstream.status} for #{context}")
    end

    # batch-response の各 entry を検証してリソース本体を返す。
    def entry_resource!(entry, context)
      status = entry&.dig("response", "status").to_i
      resource = entry&.dig("resource")
      unless (200..299).cover?(status) && resource
        upstream_error!("upstream returned #{status} for #{context} (in batch)")
      end

      resource
    end

    # resource_type が nil なら型を問わず返す(_include / _revinclude で型が混ざる検索)。
    def searchset_resources(entry, resource_type, context)
      Array(entry_resource!(entry, context)["entry"])
        .filter_map { |e| e["resource"] }
        .select { |resource| resource_type.nil? || resource["resourceType"] == resource_type }
    end

    # 帳票の患者取り違えは重大なので、患者が引けない場合は生成を中止する。
    # _include で届いた Patient のうち、owner(オーダーや QuestionnaireResponse)の
    # subject と id が一致するものだけを使う。
    def included_patient(resources, owner)
      context = "#{owner['resourceType']}/#{owner['id']}"
      reference = owner.dig("subject", "reference").to_s
      patient_id = reference[%r{\APatient/(.+)\z}, 1]
      upstream_error!("#{context} has no patient subject") if patient_id.blank?

      patient = resources.find { |r| r["resourceType"] == "Patient" && r["id"] == patient_id }
      upstream_error!("Patient/#{patient_id} was not included for #{context}") unless patient

      patient
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

    # 自院の Organization。取得できなくても発行は止めない(医療機関欄が空欄になる
    # だけで、内容は読める)。自院設定済みなら read の応答をそのまま使い、
    # 未設定なら検索結果から identifier を実際に持つ 1 件を選ぶ(上流が未知の
    # パラメータを無視して全件を返す場合への防御)。
    def find_institution(entry, self_organization_id)
      if self_organization_id
        organization = begin
          entry_resource!(entry, "Organization/#{self_organization_id}")
        rescue self.class::UpstreamError
          return nil
        end
        return organization["resourceType"] == "Organization" ? organization : nil
      end

      resources = begin
        searchset_resources(entry, "Organization", "institution search")
      rescue self.class::UpstreamError
        return nil
      end
      resources.find do |organization|
        Array(organization["identifier"]).any? { |i| i["system"] == INSTITUTION_NO_SYSTEM }
      end
    end

    def coding_by_system(codings, system)
      Array(codings).find { |coding| coding["system"] == system }
    end

    def identifier_value(resource, system)
      Array(resource["identifier"]).find { |i| i["system"] == system }&.dig("value").to_s
    end

    # 薬品名。systems の順に coding を引き、どれも無ければ text に落ちる。
    def medicine_name(medication_request, systems)
      codings = medication_request.dig("medicationCodeableConcept", "coding")
      coding = systems.lazy.filter_map { |system| coding_by_system(codings, system) }.first
      coding&.dig("display").presence || medication_request.dig("medicationCodeableConcept", "text").to_s
    end
  end
end
