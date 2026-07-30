module Reports
  # QuestionnaireResponse の answer を帳票に印字する文字列へ整形する。
  # 値の優先順位・単位の付け方・複数回答の連結は frontend の平文表示
  # (questionnaireResponsePlainText)と揃える。日付だけは帳票向けに
  # YYYY/MM/DD 形式へ整形する(サーバーは UTC 既定のため JST へ明示変換)。
  class AnswerFormatter
    TIME_ZONE = "Asia/Tokyo".freeze

    # units: linkId => 単位表示文字列(Questionnaire の questionnaire-unit 拡張から収集)
    def initialize(units = {})
      @units = units
    end

    # answers: QuestionnaireResponse item の answer 配列(Hash の配列)
    def format(link_id, answers)
      unit = @units[link_id]
      Array(answers)
        .map { |answer| unit.present? ? "#{answer_text(answer)} #{unit}" : answer_text(answer) }
        .join("、")
    end

    def answer_text(answer)
      coding = answer["valueCoding"]
      return coding["display"] || coding["code"] || "" if coding
      return answer["valueString"] if answer["valueString"]
      return format_date(answer["valueDate"]) if answer["valueDate"]
      return format_date_time(answer["valueDateTime"]) if answer["valueDateTime"]
      return answer["valueTime"] if answer["valueTime"]
      return answer["valueInteger"].to_s unless answer["valueInteger"].nil?
      return answer["valueDecimal"].to_s unless answer["valueDecimal"].nil?

      ""
    end

    def format_date(value)
      Date.parse(value).strftime("%Y/%m/%d")
    rescue ArgumentError, TypeError
      value.to_s
    end

    def format_date_time(value)
      Time.find_zone!(TIME_ZONE).parse(value).strftime("%Y/%m/%d %H:%M")
    rescue ArgumentError, TypeError
      value.to_s
    end
  end
end
