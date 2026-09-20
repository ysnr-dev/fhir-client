module Integrations
  module Orca
    # 日レセの保険種別コードを、中立の値へ読み替えるための対応。
    module InsuranceCodes
      # RelationToInsuredPerson。1=本人、2=家族。
      # 家族は続柄までは分からないので、subscriber-relationship では other にする
      # (child と決め打つと誤った続柄が残る)。
      RELATIONSHIP = { "1" => "self", "2" => "other" }.freeze

      # 期限なしを表す日レセ側の値。FHIR では period.end を出さないことで表す。
      OPEN_ENDED = ["9999-12-31", "0000-00-00", "99999999", ""].freeze

      module_function

      def relationship(code) = RELATIONSHIP[code.to_s]

      def date(value)
        text = value.to_s.strip
        return nil if OPEN_ENDED.include?(text)

        text.presence
      end

      # InsuranceCombination_Rate_Outpatient は "0.30" のような割合。
      # 表示も FHIR の costToBeneficiary も百分率で扱う。
      def copay_percent(rate)
        value = rate.to_s.strip
        return nil if value.blank?

        percent = (value.to_f * 100).round
        percent.positive? ? percent : nil
      end
    end
  end
end
