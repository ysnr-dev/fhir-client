module Reports
  # 患者リソース(パース済み Hash)から帳票に刷る表示値を取り出す共通処理。
  # QuestionnaireResponse の帳票と検体ラベルで同じ規約を使う。
  #
  # カナは JP Core 方式(複数 name + iso21090-EN-representation 拡張)。
  # frontend の fhir/humanName.ts と同じ読み方。
  module PatientMeta
    KANA_REPRESENTATION_URL = "http://hl7.org/fhir/StructureDefinition/iso21090-EN-representation".freeze

    GENDER_LABELS = {
      "male" => "男性",
      "female" => "女性",
      "other" => "その他",
      "unknown" => "不明"
    }.freeze

    module_function

    def display_name(patient)
      names = Array(patient["name"])
      kanji = names.find { |name| representation_code(name) == "IDE" }
      fallback = names.find { |name| representation_code(name).nil? } || names.first
      name = kanji || fallback
      return "" unless name

      [name["family"], Array(name["given"]).first].compact.join(" ")
    end

    def display_kana(patient)
      kana = Array(patient["name"]).find { |name| representation_code(name) == "SYL" }
      return "" unless kana

      [kana["family"], Array(kana["given"]).first].compact.join(" ")
    end

    def gender_label(patient)
      GENDER_LABELS.fetch(patient["gender"].to_s, patient["gender"].to_s)
    end

    # 患者番号。identifier が無い患者はリソース id で代用する。
    def identifier(patient)
      patient.dig("identifier", 0, "value") || patient["id"].to_s
    end

    def format_date(value)
      return "" if value.blank?

      Date.parse(value).strftime("%Y/%m/%d")
    rescue ArgumentError
      value.to_s
    end

    def representation_code(name)
      Array(name["extension"]).find { |ext| ext["url"] == KANA_REPRESENTATION_URL }&.dig("valueCode")
    end
  end
end
