module LabImport
  # 取込行 → 施設の結果項目(master_lab_result_items)の引き当て。
  #
  # 正本は JLAC10 / JLAC11。取込元ごとのコード対応表は持たない。当たらない行は
  # 保留にして取込画面で人が選び、そこで結果項目マスタの JLAC を育てる
  # (docs/lab-result-import-design.md §4 を JLAC 中心に改めたもの)。
  #
  # 17 桁のコードは試薬・機器単位で下 5 桁(測定法・結果識別)がマスタの代表コードと
  # 違うことが多いので、完全一致の次に先頭 12 桁(測定物 5 + 識別 4 + 材料 3)で引く。
  # どの段階でも複数当たったら候補を残して保留にする(先勝ちさせない)。
  class ItemResolver
    PREFIX_LENGTH = 12
    JLAC_LENGTH = 17
    NUMERIC = /\A[-+]?\d+(\.\d+)?\z/

    def initialize(as_of: Date.current)
      @as_of = as_of
    end

    # rows は LabResultImportRow(未保存可)または属性 Hash の配列。
    # コードをまとめて引いてから行ごとに判定する。
    def resolve_all(rows)
      index = build_index(rows)
      rows.each { |row| resolve(row, index) }
      rows
    end

    # 人が結果項目を選んだ後の値の検証。resolve と同じ道を通す。
    def check_value(row, item)
      if item.nil?
        return assign(row, nil, nil, status: "pending", pending_reason: "item_unresolved")
      end

      case item.data_type
      when "CD", "CO"
        matched = match_code_value(row, item)
        if matched.nil?
          assign(row, item.result_item_code, resolution_of(row), status: "pending",
                                                                 pending_reason: "value_unmatched")
        else
          write(row, value: matched)
          assign(row, item.result_item_code, resolution_of(row), status: "ready")
        end
      when "PQ"
        if read(row, :value).to_s.match?(NUMERIC)
          assign(row, item.result_item_code, resolution_of(row), status: "ready")
        else
          # 数値項目に "<5" のような値が来た行。そのまま登録すると
          # valueQuantity が NaN になるので、人が直すまで止める。
          assign(row, item.result_item_code, resolution_of(row), status: "pending",
                                                                 pending_reason: "value_not_numeric")
        end
      else
        assign(row, item.result_item_code, resolution_of(row), status: "ready")
      end
    end

    private

    def resolve(row, index)
      item, resolution = lookup(row, index)
      if item == :ambiguous
        return assign(row, nil, nil, status: "pending", pending_reason: "item_ambiguous")
      end
      return assign(row, nil, nil, status: "pending", pending_reason: "item_unresolved") if item.nil?

      write(row, resolution: resolution)
      check_value(row, item)
    end

    # 引き当ての順序。各段階で複数当たったら候補を残して保留にする。
    def lookup(row, index)
      jlac10 = read(row, :jlac10_code).presence
      jlac11 = read(row, :jlac11_code).presence

      steps = [
        [index[:jlac10_exact][jlac10], "jlac10"],
        [index[:jlac11_exact][jlac11], "jlac11"],
        [prefix_candidates(index[:jlac10_prefix], jlac10), "jlac10_prefix"],
        [prefix_candidates(index[:jlac11_prefix], jlac11), "jlac11_prefix"]
      ]

      steps.each do |found, name|
        next if found.blank?
        return [found.first, name] if found.size == 1

        write(row, candidate_item_codes: found.map(&:result_item_code))
        return [:ambiguous, nil]
      end

      [nil, nil]
    end

    def prefix_candidates(bucket, code)
      return nil if code.nil? || code.length != JLAC_LENGTH

      bucket[code[0, PREFIX_LENGTH]]
    end

    # 行に出てくるコードをまとめて 1 回ずつ引く。
    def build_index(rows)
      codes = rows.flat_map { |row| [read(row, :jlac10_code), read(row, :jlac11_code)] }
                  .map(&:presence).compact.uniq
      prefixes = codes.select { |code| code.length == JLAC_LENGTH }
                      .map { |code| code[0, PREFIX_LENGTH] }.uniq

      {
        jlac10_exact: group_by_column(active_items.where(jlac10_code: codes), :jlac10_code),
        jlac11_exact: group_by_column(active_items.where(jlac11_code: codes), :jlac11_code),
        jlac10_prefix: group_by_prefix(prefix_scope(:jlac10_code, prefixes), :jlac10_code),
        jlac11_prefix: group_by_prefix(prefix_scope(:jlac11_code, prefixes), :jlac11_code)
      }
    end

    def prefix_scope(column, prefixes)
      return Master::LabResultItem.none if prefixes.empty?

      patterns = prefixes.map { |prefix| "#{sanitize_like(prefix)}%" }
      active_items.where("master_lab_result_items.#{column} LIKE ANY (ARRAY[?])", patterns)
    end

    def group_by_column(scope, column)
      scope.to_a.group_by { |item| item.public_send(column) }
    end

    def group_by_prefix(scope, column)
      scope.to_a.group_by { |item| item.public_send(column).to_s[0, PREFIX_LENGTH] }
    end

    # 有効期間の外の項目は当てない。
    def active_items
      Master::LabResultItem
        .where("valid_from IS NULL OR valid_from <= ?", @as_of)
        .where("valid_to IS NULL OR valid_to >= ?", @as_of)
        .order(Arel.sql("display_order NULLS LAST"), :id)
    end

    def sanitize_like(value)
      value.gsub(/[%_\\]/) { |char| "\\#{char}" }
    end

    # CD / CO のコード値。OBX-5 のコード → 表示名の順で選択肢に照合する。
    # 選択肢に無い値を文字列で入れると時系列表示や判定が壊れるため、外れたら保留。
    def match_code_value(row, item)
      options = parse_code_value_list(item.code_value_list)
      return nil if options.empty?

      value = read(row, :value).to_s.strip
      text = read(row, :value_text).to_s.strip
      by_code = options.find { |option| option[:code] == value }
      return by_code[:code] if by_code

      by_display = options.find { |option| option[:display] == value || option[:display] == text }
      by_display&.fetch(:code)
    end

    # frontend の parseCodeValueList と同じ規則("1：陽性、2：陰性")。
    def parse_code_value_list(list)
      list.to_s.split(/[、,]/).filter_map do |entry|
        code, *rest = entry.strip.split(/[：:]/)
        next if code.nil? || code.strip.empty?

        { code: code.strip, display: rest.join("：").strip.presence || code.strip }
      end
    end

    def resolution_of(row)
      read(row, :resolution).presence
    end

    def assign(row, result_item_code, resolution, status:, pending_reason: nil)
      write(row, result_item_code: result_item_code, resolution: resolution,
                 status: status, pending_reason: pending_reason)
      # 候補は「前方一致で複数当たった」ときだけの手掛かり。解決したら残さない。
      write(row, candidate_item_codes: []) unless pending_reason == "item_ambiguous"
      row
    end

    # 行は ActiveRecord でも属性 Hash でも扱えるようにする(取込時は保存前の Hash)。
    def read(row, key)
      row.is_a?(Hash) ? (row[key] || row[key.to_s]) : row.public_send(key)
    end

    def write(row, attributes)
      if row.is_a?(Hash)
        attributes.each { |key, value| row[key] = value }
      else
        row.assign_attributes(attributes)
      end
    end
  end
end
