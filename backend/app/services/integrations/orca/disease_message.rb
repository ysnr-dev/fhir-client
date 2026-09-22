module Integrations
  module Orca
    # 中立の保険病名 → 日レセの Disease_Information。
    module DiseaseMessage
      # 修飾語のレセ電算コードは日レセでは ZZZ を冠した 7 桁になる。
      MODIFIER_PREFIX = "ZZZ".freeze

      # 中立の転帰 → 日レセの転帰区分(diseasev2 の Disease_OutCome)。継続は空欄。
      # 値は F 治ゆ / D 死亡 / N 不変・R 軽快・S 後遺症残・U 不明・W 悪化(いずれも中止)/ O 削除。
      # カルテの inactive は「もう活動していない病名」で死亡ではないので、中止群の N(不変)に寄せる。
      OUTCOME = { resolved: "F", inactive: "N" }.freeze

      module_function

      # 送れる病名だけを電文の形にする。コードが無いものは second に返す。
      def build(diagnoses, coverage_set_key)
        sendable, dropped = diagnoses.partition { |d| d.codes.any? }

        children = sendable.map do |entry|
          {
            "Disease_Single" => single_codes(entry).map { |code| { "Disease_Single_Code" => code } },
            "Disease_StartDate" => entry.start_date,
            "Disease_EndDate" => entry.end_date,
            "Disease_OutCome" => OUTCOME[entry.outcome],
            "Insurance_Combination_Number" => coverage_set_key
          }.compact_blank
        end

        skipped = dropped.map do |entry|
          { kind: "病名", name: entry.name, reason: "レセプト電算コードが無いため送れません" }
        end

        [children, skipped]
      end

      # 日レセは 接頭語 → 病名 → 接尾語 の並びで一連病名を組み立てる。
      def single_codes(entry)
        modifiers = entry.modifier_codes || {}
        prefixes = Array(modifiers[:prefix]).map { |c| "#{MODIFIER_PREFIX}#{c}" }
        postfixes = Array(modifiers[:postfix]).map { |c| "#{MODIFIER_PREFIX}#{c}" }
        prefixes + entry.codes + postfixes
      end
    end
  end
end
