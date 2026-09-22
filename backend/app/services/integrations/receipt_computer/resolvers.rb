module Integrations
  module ReceiptComputer
    # 手技コードを項目マスタで引けない種別の、実施記録(またはオーダー)→ 剤の行 の変換。
    #
    # 共通の入口は `call(record, order)`。record は PerformedRecordCollector::Record、
    # order はそのハブが basedOn で指すオーダー(ServiceRequest)。返すのは
    # `[lines, count]`(行の配列と回数)。送れないときは skipped に理由を積んで nil を返す。
    # 1 回の会計の組み立てごとに new する(放射線治療は同じ日の 2 回目を数えるため)。
    module Resolvers
      Skipped = BillingClaimBuilder::Skipped

      class Base
        include Records

        def initialize(skipped:, store:, codes: ReceiptCodes.new)
          @skipped = skipped
          @store = store
          @codes = codes
        end

        private

        attr_reader :skipped, :store, :codes

        def skip(kind, name, reason)
          skipped << Skipped.new(kind: kind, name: name, reason: reason)
          nil
        end

        def line(code, name, quantity: "1")
          BillingLine.new(code: code, name: name, quantity: quantity, kind: :procedure)
        end
      end

      # リハビリ。疾患別区分はオーダーの code、療法の担い手は実施記録の code、
      # 回数は実施単位数(拡張)。同じ日に PT と OT があれば剤が 2 つになる。
      class Rehab < Base
        DISEASE_CATEGORY = "#{Coding::LOCAL}/CodeSystem/rehab-disease-category".freeze
        THERAPY_TYPE = "#{Coding::LOCAL}/CodeSystem/rehab-therapy-type".freeze
        PERFORMED_UNITS_EXT = "#{Coding::LOCAL}/StructureDefinition/rehab-performed-units".freeze
        LABEL = "リハビリ".freeze

        def call(record, order)
          category = Coding.code_of(order&.dig("code"), DISEASE_CATEGORY)
          therapy = Coding.code_of(record.hub["code"], THERAPY_TYPE)
          name = [Coding.label_of(order&.dig("code"), DISEASE_CATEGORY), therapy&.upcase].compact.join(" ")
          return skip(LABEL, name, "オーダーに疾患別リハビリの区分がありません") if category.blank?
          return skip(LABEL, name, "実施記録に療法の種別(PT/OT/ST)がありません") if therapy.blank?

          code = codes.rehab(category, therapy)
          return skip(LABEL, name, "施設設定にリハビリ(#{category} / #{therapy})のレセプト電算コードがありません") if code.nil?

          units = Array(record.hub["extension"]).find { |e| e["url"] == PERFORMED_UNITS_EXT }&.dig("valueInteger")
          [[line(code, name)], units.to_i.positive? ? units.to_i.to_s : "1"]
        end
      end

      # 栄養食事指導。初回 / 2 回目以降 / 集団 は実施記録の code。
      class NutritionGuidance < Base
        SESSION_TYPE = "#{Coding::LOCAL}/CodeSystem/nutrition-guidance-session-type".freeze
        LABEL = "栄養指導".freeze

        def call(record, _order)
          session = Coding.code_of(record.hub["code"], SESSION_TYPE)
          name = Coding.label_of(record.hub["code"], SESSION_TYPE).presence || LABEL
          return skip(LABEL, name, "実施記録に指導の種別(初回 / 2 回目以降 / 集団)がありません") if session.blank?

          code = codes.nutrition_guidance(session)
          return skip(LABEL, name, "施設設定に栄養食事指導料(#{session})のレセプト電算コードがありません") if code.nil?

          [[line(code, name)], "1"]
        end
      end

      # 放射線治療。照射 1 回(fraction)が 1 ハブで、照射技法(実施記録の code)ごとに
      # 体外照射のコードを照射技法マスタから引く。同じ日の 2 回目は別コード。
      # コースの初回の照射には放射線治療管理料を添える。治療終了サマリーのハブは送らない。
      class Radiotherapy < Base
        PROCEDURE_KIND = "#{Coding::LOCAL}/CodeSystem/radiotherapy-procedure".freeze
        FRACTION = "fraction".freeze
        TECHNIQUE = "#{Coding::LOCAL}/CodeSystem/radiotherapy-technique".freeze
        LABEL = "放射線治療".freeze

        def initialize(**)
          super
          @fractions_today = Hash.new(0)
        end

        def call(record, _order)
          return nil unless Coding.code_in_list(record.hub["category"], PROCEDURE_KIND) == FRACTION

          technique_code = Coding.code_of(record.hub["code"], TECHNIQUE)
          name = Coding.label_of(record.hub["code"], TECHNIQUE).presence || LABEL
          return skip(LABEL, name, "照射記録に照射技法がありません") if technique_code.blank?

          technique = Master::RadiotherapyTechnique.find_by(code: technique_code)
          return skip(LABEL, name, "照射技法マスタに #{technique_code} がありません") if technique.nil?

          nth = (@fractions_today[record.order_id] += 1)
          code = nth == 1 ? technique.receipt_code : technique.receipt_code_second
          if code.blank?
            return skip(LABEL, name, "照射技法マスタに体外照射(#{nth == 1 ? '1 回目' : '2 回目'})のレセプト電算コードがありません")
          end

          lines = [line(code, name)]
          if nth == 1 && technique.management_receipt_code.present? && first_of_course?(record)
            lines.unshift(line(technique.management_receipt_code, "放射線治療管理料"))
          end
          [lines, "1"]
        end

        private

        # コースの初回か。その日より前に完了した照射が同じオーダーに無ければ初回。
        def first_of_course?(record)
          date = LocalDate.of(record.performed_at)
          earlier = store.search("Procedure", {
                                   "based-on" => "ServiceRequest/#{record.order_id}",
                                   "status" => "completed",
                                   "date" => "le#{Date.parse(date) - 1}",
                                   "_count" => "20"
                                 }, limit: 20)
          earlier.none? do |p|
            Coding.code_in_list(p["category"], PROCEDURE_KIND) == FRACTION &&
              LocalDate.of(p["performedDateTime"] || p.dig("performedPeriod", "start")).to_s < date
          end
        end
      end

      # 病理。実施入力を持たないのでオーダーから組む。検査区分(組織診 / 細胞診 / 術中迅速)は
      # ヘッダの code、数量は検体(明細)の数。判断料・診断料は日レセが自動算定する。
      class Pathology < Base
        EXAM_CATEGORY = "#{Coding::LOCAL}/CodeSystem/jahis-patho-exam-category".freeze
        LABEL = "病理検査".freeze

        def call(header, details)
          category = Coding.code_of(header["code"], EXAM_CATEGORY)
          name = Coding.label_of(header["code"], EXAM_CATEGORY).presence || LABEL
          return skip(LABEL, name, "オーダーに検査区分(組織診 / 細胞診 / 術中迅速)がありません") if category.blank?

          code = codes.pathology(category)
          return skip(LABEL, name, "施設設定に病理(#{category})のレセプト電算コードがありません") if code.nil?

          count = [details.length, 1].max
          BillingItem.new(category: :pathology, name: LABEL, lines: [line(code, name, quantity: count.to_s)],
                          source_ref: "ServiceRequest/#{header['id']}")
        end
      end
    end
  end
end
