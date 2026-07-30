module Reports
  # 帳票レイアウトのマッピング定義(ReportLayout#mapping)。
  #
  # ItemIdMapper の命名規約だけでは表現できない対応を JSON 配列のルールで宣言する:
  # チェックマーク・丸囲みの表示切替、既存レイアウトの独自 ID への出力、メタ値の別名。
  #
  # ルールの形式(1 要素 1 ルール):
  #   { "linkId": "...", "tlfId": "..." }
  #     回答値を text-block へ出力する。対象が image-block なら描き込み画像を出力する。
  #   { "linkId": "...", "code": "01", "show": ["id1", ...] }
  #     answerCoding.code が一致する回答があれば対象アイテム(text/ellipse 等)を表示する。
  #   { "linkId": "...", "answered": true, "show": ["id1", ...] }
  #     回答が 1 つでもあれば対象アイテムを表示する(code 省略時と同義)。
  #   { "meta": "pt_name", "tlfId": "..." }
  #     予約プレースホルダーの値を別 ID の text-block にも出力する。
  #
  # show に指定したアイテムは、どのルールの条件も満たさなければ強制的に非表示にする
  # (レイアウト側の display 設定に依らず出力結果が確定する)。
  # 繰り返しグループは非対応: 値は最後の出現で上書き、show は全出現の OR になる。
  class LayoutMapping
    # ThinreportsRenderer#meta_values のキーと同期させること(スペックで検証)。
    RESERVED_META_IDS = %w[
      pt_name pt_kana pt_id pt_birthdate pt_age pt_gender
      qr_title qr_status qr_authored qr_author qr_institution qr_id
    ].freeze

    RULE_KEYS = %w[linkId meta tlfId show code answered].freeze

    # モデル検証用。エラーメッセージの配列を返す(空なら妥当)。
    # メッセージは errors.add(:mapping, msg) で属性名に続けて表示される前提の文体。
    def self.validate(json_text)
      return [] if json_text.blank?

      parsed = JSON.parse(json_text)
      return ["はルールの配列(JSON Array)で指定してください"] unless parsed.is_a?(Array)

      parsed.each_with_index.flat_map { |rule, index| validate_rule(rule, index + 1) }
    rescue JSON::ParserError
      ["が JSON として不正です"]
    end

    # 検証済みの JSON をパースする。空なら nil(マッピングなし)。
    def self.parse(json_text)
      return nil if json_text.blank?

      new(JSON.parse(json_text))
    end

    def self.validate_rule(rule, number)
      prefix = "のルール#{number}"
      return ["#{prefix}がオブジェクト(JSON Object)ではありません"] unless rule.is_a?(Hash)

      errors = []
      unknown = rule.keys - RULE_KEYS
      errors << "#{prefix}に不明なキーがあります: #{unknown.join(', ')}" if unknown.any?

      sources = rule.keys & %w[linkId meta]
      targets = rule.keys & %w[tlfId show]
      errors << "#{prefix}には linkId か meta のどちらか一方を指定してください" if sources.size != 1
      errors << "#{prefix}には tlfId か show のどちらか一方を指定してください" if targets.size != 1

      sources.each do |key|
        errors << "#{prefix}の #{key} は空でない文字列で指定してください" unless non_blank_string?(rule[key])
      end
      if rule.key?("meta") && non_blank_string?(rule["meta"]) && RESERVED_META_IDS.exclude?(rule["meta"])
        errors << "#{prefix}の meta \"#{rule['meta']}\" は予約プレースホルダーではありません"
      end

      errors.concat(validate_rule_target(rule, prefix))
      errors.concat(validate_rule_condition(rule, prefix))
      errors
    end
    private_class_method :validate_rule

    def self.validate_rule_target(rule, prefix)
      errors = []
      if rule.key?("tlfId") && !non_blank_string?(rule["tlfId"])
        errors << "#{prefix}の tlfId は空でない文字列で指定してください"
      end
      if rule.key?("show")
        show = rule["show"]
        unless show.is_a?(Array) && show.any? && show.all? { |id| non_blank_string?(id) }
          errors << "#{prefix}の show は空でない文字列の配列で指定してください"
        end
        errors << "#{prefix}の show は linkId と組み合わせてください" if rule.key?("meta")
      end
      errors
    end
    private_class_method :validate_rule_target

    def self.validate_rule_condition(rule, prefix)
      errors = []
      if rule.key?("code")
        errors << "#{prefix}の code は空でない文字列で指定してください" unless non_blank_string?(rule["code"])
        errors << "#{prefix}の code は show と組み合わせてください" unless rule.key?("show")
        errors << "#{prefix}の code と answered は同時に指定できません" if rule.key?("answered")
      end
      if rule.key?("answered")
        errors << "#{prefix}の answered は true のみ指定できます" unless rule["answered"] == true
        errors << "#{prefix}の answered は show と組み合わせてください" unless rule.key?("show")
      end
      errors
    end
    private_class_method :validate_rule_condition

    def self.non_blank_string?(value)
      value.is_a?(String) && !value.strip.empty?
    end
    private_class_method :non_blank_string?

    def initialize(rules)
      @value_targets = Hash.new { |hash, key| hash[key] = [] }
      @meta_targets = Hash.new { |hash, key| hash[key] = [] }
      @show_rules = Hash.new { |hash, key| hash[key] = [] }
      @show_target_ids = Set.new

      rules.each do |rule|
        if rule.key?("show")
          ids = Array(rule["show"]).map(&:to_s)
          @show_rules[rule["linkId"]] << { code: rule["code"], ids: ids }
          @show_target_ids.merge(ids)
        elsif rule.key?("meta")
          @meta_targets[rule["meta"]] << rule["tlfId"]
        else
          @value_targets[rule["linkId"]] << rule["tlfId"]
        end
      end
    end

    # linkId の回答値を出力する先のアイテム ID 一覧。
    def value_targets(link_id)
      @value_targets.fetch(link_id) { [] }
    end

    # 値出力先の全アイテム ID(未回答時の空文字埋めに使う)。
    def value_target_ids
      @value_targets.values.flatten
    end

    # 予約メタ値 meta_id を別名出力する先のアイテム ID 一覧。
    def meta_targets(meta_id)
      @meta_targets.fetch(meta_id) { [] }
    end

    # show ルールが参照する全アイテム ID。ここに含まれるアイテムは
    # 「トリガーされたら表示、されなければ非表示」で確定させる。
    def show_target_ids
      @show_target_ids
    end

    # linkId への回答 answers で表示条件を満たすアイテム ID 一覧。
    def triggered_show_ids(link_id, answers)
      rules = @show_rules.fetch(link_id) { return [] }
      codes = Array(answers).filter_map { |answer| answer.dig("valueCoding", "code")&.to_s }
      rules.flat_map do |rule|
        rule[:code].nil? || codes.include?(rule[:code]) ? rule[:ids] : []
      end
    end
  end
end
