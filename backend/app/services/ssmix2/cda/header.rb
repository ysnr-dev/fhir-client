module Ssmix2
  module Cda
    # CDA ヘッダの組み立て(共通編 6 章、経過記録規約 3 章の表 3-3)。ProgressNote に混ぜて使い、
    # 患者・医療従事者・自院の読み出しは Messages::Base の仕組み(context、patient_id、practitioner_id)に任せる。
    module Header
      GENDERS = { "male" => %w[M 男], "female" => %w[F 女] }.freeze
      UNKNOWN_GENDER = %w[UN 不明].freeze

      private

      def header(xml, composition, patient, version)
        xml.realmCode(code: "JP")
        xml.typeId(root: Oids::HL7_TYPE_ID, extension: "POCD_HD000040")
        xml.templateId(root: Oids::PROGRESS_NOTE_TEMPLATE)
        xml.id(root: Oids.facility_root, extension: document_id(composition, version))
        xml.code(code: ProgressNote::DOCUMENT_CODE, codeSystem: Oids::LOINC, codeSystemName: "LOINC",
                 displayName: ProgressNote::DOCUMENT_DISPLAY)
        xml.title(composition["title"].to_s) if composition["title"].present?
        xml.effectiveTime(value: Timestamp.format(composition["date"]))
        xml.confidentialityCode(code: "N", codeSystem: Oids::CONFIDENTIALITY)
        xml.languageCode(code: "ja-JP")
        xml.setId(root: Oids.facility_root, extension: composition["id"].to_s)
        xml.versionNumber(value: version) if version
        record_target(xml, patient)
        author(xml, composition)
        system_author(xml, composition)
        custodian(xml)
        legal_authenticator(xml, composition)
        documentation_of(xml, composition)
        related_document(xml, composition, version) if version.to_i > 1
      end

      # 文書 ID は版ごとに別、setId は記録ごとに同じ(共通編 6.3.12)。
      def document_id(composition, version)
        version ? "#{composition['id']}.#{version}" : composition["id"].to_s
      end

      def updated_at(composition)
        composition.dig("meta", "lastUpdated").presence || transaction.occurred_at
      end

      def record_target(xml, patient)
        xml.recordTarget do
          xml.patientRole do
            xml.id(root: Oids.patient_root, extension: patient_id(patient))
            address(xml, Array(patient["address"]).first, use: "HP")
            telecom(xml, Fhir.phone(patient, "home"), use: "HP")
            telecom(xml, Fhir.phone(patient, "work"), use: "WP")
            xml.patient do
              person_name(xml, Fhir.name(patient))
              gender(xml, patient["gender"])
              birth = Hl7::Stamp.day(patient["birthDate"])
              birth.present? ? xml.birthTime(value: birth) : xml.birthTime(nullFlavor: "UNK")
            end
          end
        end
      end

      def gender(xml, code)
        return if code.blank?

        value, display = GENDERS.fetch(code, UNKNOWN_GENDER)
        xml.administrativeGenderCode(code: value, codeSystem: Oids::ADMINISTRATIVE_GENDER, displayName: display)
      end

      # 漢字(IDE)とカナ(SYL)。姓も名も無ければ nullFlavor。
      def person_name(xml, name)
        if name.family_kanji.blank? && name.given_kanji.blank? && name.family_kana.blank? && name.given_kana.blank?
          xml.name(nullFlavor: "NI")
          return
        end

        name_element(xml, "IDE", name.family_kanji, name.given_kanji)
        name_element(xml, "SYL", name.family_kana, name.given_kana)
      end

      def name_element(xml, use, family, given)
        return if family.blank? && given.blank?

        xml.name(use: use) do
          xml.family(family.presence || given)
          xml.given(given) if family.present? && given.present?
        end
      end

      def address(xml, addr, use:)
        return if addr.nil? || Fhir.address_text(addr).blank?

        xml.addr(use: use) do
          xml.streetAddressLine(Array(addr["line"]).join.presence || addr["text"].presence || Fhir.address_text(addr))
          xml.city(addr["city"]) if addr["city"].present?
          xml.state(addr["state"]) if addr["state"].present?
          xml.postalCode(addr["postalCode"]) if addr["postalCode"].present?
          xml.country("JP")
        end
      end

      def telecom(xml, number, use:)
        return if number.blank?

        xml.telecom(value: "tel:#{number}", use: use)
      end

      def author(xml, composition)
        xml.author do
          xml.time(value: Timestamp.format(updated_at(composition)))
          xml.assignedAuthor do
            person_entity(xml, *author_of(composition))
            organization(xml, :representedOrganization)
          end
        end
      end

      # 作成システム(表 3-3 で R)。作成者とは別の author に書く(共通編 6.3.2(3))。
      def system_author(xml, composition)
        xml.author do
          xml.time(value: Timestamp.format(updated_at(composition)))
          xml.assignedAuthor do
            xml.id(nullFlavor: "NI")
            xml.assignedAuthoringDevice do
              xml.manufacturerModelName(Settings.sending_application)
              xml.softwareName("fhir-client")
            end
            organization(xml, :representedOrganization)
          end
        end
      end

      def author_of(composition)
        first = Array(composition["author"]).first || {}
        [first["reference"], first["display"]]
      end

      # 医療従事者の id と氏名。Practitioner が読めなければ display の名前だけ(id は nullFlavor)。
      def person_entity(xml, reference, display)
        practitioner = reference.to_s.start_with?("Practitioner/") ? context.by_reference(reference) : nil
        if practitioner
          xml.id(root: Oids.practitioner_root, extension: practitioner_id(practitioner))
          xml.assignedPerson { person_name(xml, Fhir.name(practitioner)) }
        else
          warn("医療従事者が読めないので氏名だけを書きました: #{reference.presence || '(参照なし)'}")
          xml.id(nullFlavor: "NI")
          xml.assignedPerson do
            display.present? ? xml.name(use: "IDE") { xml.family(display) } : xml.name(nullFlavor: "NI")
          end
        end
      end

      # 自院。element は representedOrganization か representedCustodianOrganization。保管組織は電話・住所も必須。
      def organization(xml, element, with_contact: false)
        institution = context.institution
        warn("自院の Organization が読めないので施設 ID だけを書きました") if institution.nil?
        xml.send(element) do
          xml.id(root: Oids.facility_root)
          xml.name(institution&.dig("name").presence || Settings.facility_id)
          next unless with_contact

          phone = institution && (Fhir.phone(institution, "work") || Fhir.phone(institution, "home"))
          phone.present? ? xml.telecom(value: "tel:#{phone}", use: "WP") : xml.telecom(nullFlavor: "NI")
          addr = institution && Array(institution["address"]).first
          if addr && Fhir.address_text(addr).present?
            address(xml, addr, use: "WP")
          else
            xml.addr(nullFlavor: "NI")
          end
        end
      end

      def custodian(xml)
        xml.custodian do
          xml.assignedCustodian { organization(xml, :representedCustodianOrganization, with_contact: true) }
        end
      end

      # 確定の署名(attester mode=legal)。無ければ書かない(表 3-3 で O)。
      def legal_authenticator(xml, composition)
        attester = Array(composition["attester"]).find { |a| a["mode"] == "legal" }
        return if attester.nil?

        xml.legalAuthenticator do
          xml.time(value: Timestamp.format(attester["time"].presence || updated_at(composition)))
          xml.signatureCode(code: "S")
          xml.assignedEntity { person_entity(xml, attester.dig("party", "reference"), attester.dig("party", "display")) }
        end
      end

      # 記載した診療行為。実施日は記録日時、実施者は記載者。
      def documentation_of(xml, composition)
        at = Timestamp.format(composition["date"])
        xml.documentationOf(typeCode: "DOC") do
          xml.serviceEvent(classCode: "PCPR") do
            xml.effectiveTime do
              xml.low(value: at)
              xml.high(value: at)
            end
            xml.performer(typeCode: "PRF") do
              xml.assignedEntity { person_entity(xml, *author_of(composition)) }
            end
          end
        end
      end

      # 改版は前の版の差し替え(RPLC)。
      def related_document(xml, composition, version)
        xml.relatedDocument(typeCode: "RPLC") do
          xml.parentDocument do
            xml.id(root: Oids.facility_root, extension: document_id(composition, version - 1))
            xml.setId(root: Oids.facility_root, extension: composition["id"].to_s)
            xml.versionNumber(value: version - 1)
          end
        end
      end
    end
  end
end
