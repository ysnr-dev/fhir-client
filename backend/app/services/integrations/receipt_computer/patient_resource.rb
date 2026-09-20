module Integrations
  module ReceiptComputer
    # 中立の患者情報 → FHIR Patient。
    #
    # レセコンが持たない項目(かかりつけ、注意区分など)はカルテ側で付けるので、
    # 既存のリソースに対しては「レセコンが正本の項目」だけを差し替える。
    module PatientResource
      IDENTIFIER_SYSTEM = "urn:oid:1.2.392.100495.20.3.51".freeze
      KANA_REPRESENTATION_URL = "http://hl7.org/fhir/StructureDefinition/iso21090-EN-representation".freeze

      # レセコンから取り込む要素。これ以外は既存の値をそのまま残す。
      OWNED = %w[identifier name birthDate gender address telecom].freeze

      module_function

      def identifier_query(number) = "#{IDENTIFIER_SYSTEM}|#{number}"

      def number_of(patient)
        identifiers = Array(patient["identifier"])
        # 体系の指定が無い identifier(他システム由来)も患者番号として扱う。
        found = identifiers.find { |i| i["system"] == IDENTIFIER_SYSTEM } ||
                identifiers.find { |i| i["system"].blank? }
        found&.dig("value").presence
      end

      # レセコンとカルテで患者番号の桁揃えが違うことがある(レセコンは 1009 の
      # 連番桁数でゼロ埋めし、カルテは入力したまま持つ)。同じ患者を二重に作らない
      # よう、ゼロ埋めを外した形も同じ番号として扱う。
      def candidate_numbers(number)
        text = number.to_s.strip
        return [text] unless text.match?(/\A\d+\z/)

        [text, text.sub(/\A0+/, "")].uniq.reject(&:empty?)
      end

      def same_number?(a, b)
        candidate_numbers(a).intersect?(candidate_numbers(b))
      end

      # existing があれば、その上にレセコン側の値を重ねる。
      def build(record, existing: nil)
        patient = (existing || { "resourceType" => "Patient" }).dup
        patient["resourceType"] = "Patient"
        # 既にカルテに居る患者の番号は書き換えない。桁揃えが違うだけで同じ患者なので、
        # ここで振り直すとカルテ側の参照や検索が一斉にずれる。
        existing_number = existing && number_of(existing)
        patient["identifier"] = merged_identifiers(patient, existing_number.presence || record.number)
        patient["name"] = names(record)
        patient["birthDate"] = record.birth_date if record.birth_date.present?
        patient["gender"] = record.gender if record.gender.present?

        address = address_of(record)
        patient["address"] = [address] if address
        telecom = telecom_of(record)
        patient["telecom"] = telecom if telecom.any?

        patient["active"] = true
        patient
      end

      def deactivate(existing)
        existing.merge("active" => false)
      end

      def merged_identifiers(patient, number)
        others = Array(patient["identifier"]).reject do |i|
          i["system"] == IDENTIFIER_SYSTEM || i["system"].blank?
        end
        [{ "system" => IDENTIFIER_SYSTEM, "value" => number }] + others
      end

      def names(record)
        list = []
        kanji = name_entry(record.family, record.given)
        list << kanji if kanji

        kana = name_entry(record.family_kana, record.given_kana)
        if kana
          kana["extension"] = [{ "url" => KANA_REPRESENTATION_URL, "valueCode" => "SYL" }]
          list << kana
        end
        list
      end

      def name_entry(family, given)
        return nil if family.blank? && given.blank?

        entry = { "use" => "official" }
        entry["family"] = family if family.present?
        entry["given"] = [given] if given.present?
        entry["text"] = [family, given].compact_blank.join("　")
        entry
      end

      def address_of(record)
        return nil if record.address.blank? && record.postal_code.blank?

        {
          "use" => "home",
          "postalCode" => record.postal_code.presence,
          "text" => record.address.presence
        }.compact
      end

      def telecom_of(record)
        return [] if record.phone.blank?

        [{ "system" => "phone", "value" => record.phone, "use" => "home" }]
      end
    end
  end
end
