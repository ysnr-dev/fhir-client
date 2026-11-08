module Ssmix2
  module Cda
    # 診療記録(Composition)を JAHIS 経過記録構造化記述規約(C-CDA Progress Note (V2) の JP 適用)の
    # HL7 CDA R2 文書にし、拡張ストレージのメッセージとして返す(docs/ssmix2-export-design.md §12)。
    #
    # 対象は経過記録(11506-3)と他科依頼回答(11488-4)の確定(final / amended)だけ。下書きは出さず、
    # 確定が下書きに戻ったときと削除は DEL(エージェントがコンテンツフォルダを無効にする)。
    # データ種別は医師等の記録を「経過記録 11506-3」、看護職の記録(category nursing)を「看護記録 28623-7」にする。
    class ProgressNote < Messages::Base
      include Header

      LOINC_SYSTEM = "http://loinc.org".freeze
      NOTE_TYPES = %w[11506-3 11488-4].freeze
      EXPORTED_STATUSES = %w[final amended].freeze
      CLINICAL_NOTE_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/clinical-note-category".freeze
      NURSING_CATEGORY = "nursing".freeze
      # 文書コードは規約の推奨どおり単一(3.1.1(2))。看護記録もデータ種別フォルダだけを分ける。
      DOCUMENT_CODE = "11506-3".freeze
      DOCUMENT_DISPLAY = "経過記録".freeze
      # 標準文書コード表(拡張ストレージ構築ガイドライン 別紙)の文書コードと名称。
      DOCUMENT_KINDS = {
        progress: { code: "11506-3", name: "経過記録" },
        nursing: { code: "28623-7", name: "看護記録" }
      }.freeze
      # セクション(経過記録規約 表 4-1)。LOINC → templateId・displayName・既定の title。
      SECTIONS = {
        "61150-9" => { template: "2.16.840.1.113883.10.20.21.2.2", display: "Subjective", title: "主観的情報" },
        "61149-1" => { template: "2.16.840.1.113883.10.20.21.2.1", display: "Objective", title: "客観的情報" },
        "51848-0" => { template: "2.16.840.1.113883.10.20.22.2.8", display: "Assessments", title: "評価" },
        "18776-5" => { template: "2.16.840.1.113883.10.20.22.2.10", extension: "2014-06-09", display: "Plan of treatment", title: "治療計画" },
        "51847-2" => { template: "2.16.840.1.113883.10.20.22.2.9", extension: "2014-06-09", display: "ASSESSMENT AND PLAN SECTION", title: "評価と計画" },
        "77599-9" => { template: "2.16.840.1.113883.10.20.35.2.1", display: "ADDITIONAL DOCUMENTATION", title: "自由記載" }
      }.freeze
      FREE_TEXT_CODE = "77599-9".freeze
      ASSESSMENT_AND_PLAN_CODE = "51847-2".freeze
      REQUIRED_CODES = %w[51848-0 18776-5].freeze
      # 対象プロブレム(clinicalNoteHelpers.ts の problems_section)。規約の 6 セクションの外なので共通編 7.1.4 の追加セクションとして出す。
      PROBLEMS_CODE = "11450-4".freeze
      PROBLEMS_SECTION = { template: "2.16.840.1.113883.10.20.22.2.5.1", extension: "2015-08-01", display: "Problem list", title: "プロブレム" }.freeze

      def build
        return nil unless Settings.extended_enabled?

        composition, process = plan_process
        return nil if process.nil?

        patient = patient_of(composition.dig("subject", "reference"))
        kind = nursing?(composition) ? DOCUMENT_KINDS[:nursing] : DOCUMENT_KINDS[:progress]
        version = written.version || composition.dig("meta", "versionId")&.to_i
        @image_counter = Enumerator.new { |y| (1..).each { |n| y << n } }
        xml = document_xml(composition, patient, version)

        Result.new(
          storage: "extended", data_kind: kind[:code], document_folder: folder_name(kind), document_name: kind[:name],
          patient_id: patient_id(patient), service_date: Hl7::Stamp.day(composition["date"]).presence || UNDATED,
          order_no: OrderNumber.for("Composition/#{composition['id']}"), process: process,
          department_code: department_code_of(Fhir.department_reference(composition)),
          hl7: xml, warnings: warnings,
          files: [ContentsFile.file(document_name: kind[:name], file_name: Ssmix2Message::DOCUMENT_FILE_NAME,
                                    created_at: transaction.occurred_at, vendor: Settings.sending_application)]
        )
      end

      private

      # 出す内容と処理区分。[組む元の Composition, "INS" / "DEL"]、出さないときは [nil, nil]。
      def plan_process
        if written.method == "DELETE"
          last = context.last_version("Composition", written.id)
          raise "削除された診療記録の最後の版が読めません: Composition/#{written.id}" if last.nil?
          return [nil, nil] unless target?(last) && exported?(last)

          [last, "DEL"]
        else
          current = written.resource
          return [nil, nil] unless target?(current)
          return [current, "INS"] if exported?(current)

          # 下書きに戻した・入力誤りにしたときは、出していた前の版を無効にする。
          previous = previous_version("Composition", current)
          return [nil, nil] unless previous && target?(previous) && exported?(previous)

          [previous, "DEL"]
        end
      end

      def target?(composition)
        return false unless composition.is_a?(Hash) && composition["resourceType"] == "Composition"

        Array(composition.dig("type", "coding")).any? { |c| c["system"] == LOINC_SYSTEM && NOTE_TYPES.include?(c["code"]) }
      end

      def exported?(composition) = EXPORTED_STATUSES.include?(composition["status"])

      def nursing?(composition)
        Array(composition["category"]).any? do |category|
          Array(category["coding"]).any? { |c| c["system"] == CLINICAL_NOTE_CATEGORY_SYSTEM && c["code"] == NURSING_CATEGORY }
        end
      end

      # データ種別フォルダ名(構築ガイドライン 2.2(4)③)。ローカル文書コードは置かず、ローカル文書名称と標準部分を書く。
      def folder_name(kind) = "^#{kind[:name]}^^#{kind[:code]}^#{kind[:name]}^LN"

      def document_xml(composition, patient, version)
        Nokogiri::XML::Builder.new(encoding: "UTF-8") do |xml|
          xml.ClinicalDocument("xmlns" => "urn:hl7-org:v3", "xmlns:voc" => "urn:hl7-org:v3/voc",
                               "xmlns:xsi" => "http://www.w3.org/2001/XMLSchema-instance") do
            header(xml, composition, patient, version)
            body(xml, composition)
          end
        end.to_xml
      end

      def body(xml, composition)
        problems, sections = Array(composition["section"]).partition { |s| section_code(s) == PROBLEMS_CODE }
        xml.component do
          xml.structuredBody do
            problems.each { |section| problems_section(xml, section) }
            codes = sections.map { |section| body_section(xml, section) }
            required_sections(xml, codes)
          end
        end
      end

      def section_code(section)
        codings = Array(section.dig("code", "coding"))
        (codings.find { |c| c["system"] == LOINC_SYSTEM } || codings.first)&.dig("code").to_s
      end

      # 本文のセクション。規約に無いコードは自由記載として出す。返り値は出したコード。
      def body_section(xml, section)
        code = section_code(section)
        spec = SECTIONS[code]
        if spec.nil?
          warn("規約に無いセクション(#{code.presence || 'コードなし'})を自由記載として出力しました")
          code = FREE_TEXT_CODE
          spec = SECTIONS[FREE_TEXT_CODE]
        end
        xml.component do
          xml.section do
            section_head(xml, spec, code, section["title"])
            images = []
            xml.text_ { Narrative.new(xml, images: images, warnings: warnings, counter: @image_counter).render(section.dig("text", "div")) }
            images.each { |image| media_entry(xml, image) }
          end
        end
        code
      end

      def section_head(xml, spec, code, title)
        attrs = { root: spec[:template] }
        attrs[:extension] = spec[:extension] if spec[:extension]
        xml.templateId(attrs)
        xml.code(code: code, codeSystem: Oids::LOINC, codeSystemName: "LOINC", displayName: spec[:display])
        xml.title(title.presence || spec[:title])
      end

      # 「評価」と「治療計画」の 2 つか「評価と計画」の 1 つが必須(4.1.1)。無いものは nullFlavor="NI" で明示する。
      def required_sections(xml, codes)
        return if codes.include?(ASSESSMENT_AND_PLAN_CODE)

        (REQUIRED_CODES - codes).each do |code|
          xml.component do
            xml.section(nullFlavor: "NI") do
              section_head(xml, SECTIONS[code], code, nil)
              xml.text_
            end
          end
        end
      end

      # 対象プロブレム。entry の display を箇条書きにする(共通編 7.1.4(2) パターン②)。
      def problems_section(xml, section)
        items = Array(section["entry"]).filter_map { |e| e["display"].presence }
        xml.component do
          xml.section do
            section_head(xml, PROBLEMS_SECTION, PROBLEMS_CODE, section["title"])
            xml.text_ do
              if items.any?
                xml.list { items.each { |item| xml.item(item) } }
              else
                Narrative.new(xml, images: [], warnings: warnings, counter: @image_counter).render(section.dig("text", "div"))
              end
            end
          end
        end
      end

      def media_entry(xml, image)
        xml.entry do
          xml.observationMedia(ID: image.id, classCode: "OBS", moodCode: "EVN") do
            xml.value(mediaType: image.media_type, representation: "B64") { xml.text(image.data) }
          end
        end
      end
    end
  end
end
