module LabImport
  # 検体ラベル番号(11 桁 + M10W3 チェックデジット)。
  #
  # 採番は上流の Specimen に移っていて backend には計算が残っていないため
  # (docs/lab-arrival-design.md §6-1)、frontend の
  # labSpecimenHelpers.ts#isValidLabelNumber と同じ計算をここに持つ。
  module LabelNumber
    LENGTH = 11

    module_function

    def valid?(value)
      number = value.to_s
      return false unless number.match?(/\A\d{#{LENGTH}}\z/)

      check_digit(number[0, LENGTH - 1]) == number[LENGTH - 1]
    end

    def check_digit(digits)
      sum = digits.chars.each_with_index.sum do |digit, index|
        weight = ((digits.length - 1 - index) % 2).zero? ? 3 : 1
        digit.to_i * weight
      end
      ((10 - (sum % 10)) % 10).to_s
    end

    # 候補の中から最初の妥当な番号を選ぶ。SPM-2 → OBR-2 → ORC-2 の順で渡される。
    def pick(candidates)
      Array(candidates).map(&:to_s).find { |candidate| valid?(candidate) }
    end
  end
end
