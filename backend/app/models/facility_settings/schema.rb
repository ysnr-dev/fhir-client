class FacilitySettings
  # 施設設定の項目表(FacilitySettings::SETTINGS)を読んで、既定値の穴埋め・検証・
  # 文字列で来た数値の寄せをする小さなエンジン。設定を足すときに書くのは項目表だけで、
  # ここは触らない。
  #
  # 節(shape)は 3 種類。
  #
  #   { fields: { "キー" => 節 } }     決まったキーだけを持つ連想配列(知らないキーは弾く)
  #   { map: 節, keys: [...] | :any }  キーが可変の連想配列
  #   { list: 葉 }                     同じ型の並び
  #
  # 葉は :time / :number / { integer: { min:, unit: } } / { enum: [...], blank: } /
  # { pattern: //, label: }。
  #
  # 既定値の埋め方は節で変える。
  #
  # - fields は**キーごと**に埋める(空欄は既定値に戻る)。「1日3回だけ時刻を変える」が
  #   できるように。
  # - map は**キー単位で差し替える**(保存されたキーは中身を混ぜない)。バイタルの
  #   しきい値で「上限だけ空にする」を保存できるようにするため。
  module Schema
    module_function

    # 保存値(stored)に既定値(default)を重ねた、読み出し用の値。
    def fill(node, default, stored)
      if fields?(node)
        node[:fields].to_h do |key, child|
          [key, fill(child, default_at(default, key), value_at(stored, key))]
        end
      elsif map?(node)
        fill_map(node, default, stored)
      elsif list?(node)
        stored.is_a?(Array) ? stored.map(&:to_s) : default
      else
        leaf_value(node, default, stored)
      end
    end

    # 検証。エラー文言の配列を返す(空なら妥当)。path は設定の中での位置。
    def errors(node, value, path = nil)
      return [] if value.nil?

      if fields?(node)
        return [message(path, "連想配列")] unless value.is_a?(Hash)

        value.flat_map do |key, child_value|
          child = node[:fields][key.to_s]
          next [unknown(join(path, key))] if child.nil?

          errors(child, child_value, join(path, key))
        end
      elsif map?(node)
        return [message(path, "連想配列")] unless value.is_a?(Hash)

        value.flat_map do |key, child_value|
          next [unknown(join(path, key))] unless key_allowed?(node, key)

          errors(node[:map], child_value, join(path, key))
        end
      elsif list?(node)
        leaf = node[:list]
        return [list_message(path, leaf)] unless value.is_a?(Array)
        return [list_message(path, leaf)] unless value.all? { |item| leaf_valid?(leaf, item) }

        []
      else
        leaf_valid?(node, value) ? [] : [message(path, label(node))]
      end
    end

    # JSON で文字列として来た数値を数値に寄せる(管理画面のフォームは数値欄でも
    # 文字列で送ってくることがある)。型の違うものはそのまま通し、検証で弾く。
    def coerce(node, value)
      if fields?(node) && value.is_a?(Hash)
        value.to_h { |key, child| [key, node[:fields][key.to_s] ? coerce(node[:fields][key.to_s], child) : child] }
      elsif map?(node) && value.is_a?(Hash)
        value.transform_values { |child| coerce(node[:map], child) }
      elsif integer?(node)
        value.to_s.match?(/\A-?\d+\z/) ? value.to_i : value
      elsif node == :number && value.is_a?(String)
        value.match?(/\A-?\d+(\.\d+)?\z/) ? Float(value) : value
      else
        value
      end
    end

    # --- 節の判別 ---------------------------------------------------------

    def fields?(node) = node.is_a?(Hash) && node.key?(:fields)
    def map?(node) = node.is_a?(Hash) && node.key?(:map)
    def list?(node) = node.is_a?(Hash) && node.key?(:list)
    def integer?(node) = node.is_a?(Hash) && node.key?(:integer)
    def enum?(node) = node.is_a?(Hash) && node.key?(:enum)
    def pattern?(node) = node.is_a?(Hash) && node.key?(:pattern)

    # --- 既定値の穴埋め ---------------------------------------------------

    def fill_map(node, default, stored)
      filled = (default.is_a?(Hash) ? default : {}).dup
      (stored.is_a?(Hash) ? stored : {}).each do |key, value|
        next unless key_allowed?(node, key)

        filled[key.to_s] = sanitize(node[:map], value)
      end
      filled
    end

    # map のキーに入れる値。決まったキーだけを残し、空(nil)は落とす
    # (「上限を空にする」を保存できるようにするため)。
    def sanitize(node, value)
      return value unless fields?(node) && value.is_a?(Hash)

      value.slice(*node[:fields].keys).compact
    end

    def leaf_value(node, default, stored)
      return default if stored.nil?
      return stored if enum?(node) && node[:blank] && stored.is_a?(String)

      stored == "" ? default : stored
    end

    def default_at(default, key) = default.is_a?(Hash) ? default[key.to_s] : nil
    def value_at(stored, key) = stored.is_a?(Hash) ? stored[key.to_s] : nil

    def key_allowed?(node, key)
      node[:keys] == :any || Array(node[:keys]).include?(key.to_s)
    end

    # --- 葉の検証と文言 ---------------------------------------------------

    def leaf_valid?(node, value)
      if node == :time
        value.is_a?(String) && value.match?(TIME_PATTERN)
      elsif node == :number
        value.is_a?(Numeric)
      elsif integer?(node)
        value.is_a?(Integer) && value >= node[:integer][:min].to_i
      elsif enum?(node)
        return true if node[:blank] && value.to_s.empty?

        value.is_a?(String) && node[:enum].include?(value)
      elsif pattern?(node)
        value.to_s.match?(node[:pattern])
      else
        raise ArgumentError, "未知の節: #{node.inspect}"
      end
    end

    # 期待する値の言い方。文言に直に混ぜるので、英数字の前後の空きはここに持たせる
    # (「は HH:MM で指定してください」「は管理番号の配列で指定してください」)。
    def label(node)
      if node == :time
        " HH:MM "
      elsif node == :number
        "数値"
      elsif integer?(node)
        " #{node[:integer][:min]} 以上の#{node[:integer][:unit]}"
      elsif enum?(node)
        " #{node[:enum].join(' / ')}#{' か空' if node[:blank]} のいずれか"
      elsif pattern?(node)
        node[:label]
      end
    end

    def message(path, label) = "#{path} は#{label}で指定してください".squeeze(" ").strip
    def list_message(path, leaf) = "#{path} は#{label(leaf)}の配列で指定してください".squeeze(" ").strip
    def unknown(path) = "#{path} は対象外の項目です"
    def join(path, key) = path ? "#{path}.#{key}" : key.to_s
  end
end
