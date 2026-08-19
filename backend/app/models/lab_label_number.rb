# 検体ラベル番号の採番。行 1 つ = 採番 1 回で、番号は id から組む(連番なので重複しない)。
#
# 番号が指す先(オーダー・検体・採取管)や発行・到着の状態は、ここではなく上流の
# Specimen リソースが持つ(accessionIdentifier に番号、request にオーダー、
# receivedTime に到着。docs/lab-arrival-design.md §6-1)。バーコードに載る短い番号の
# 一意な払い出しだけが FHIR で表現できないので、それだけを backend に残している。
#
# 番号は「id の 10 桁ゼロ埋め + チェックデジット(M10W3)1 桁」の 11 桁。番号自体には
# 日付や患者番号などの意味を持たせない(docs/lab-label-design.md §3)。
class LabLabelNumber < ApplicationRecord
  SYSTEM = "http://fhir-client.local/IdSystem/lab-label-number".freeze

  def self.allocate
    base = format("%010d", create!.id)
    "#{base}#{check_digit(base)}"
  end

  # M10W3(モジュラス 10 ウェイト 3)。JAN と同じ方式で、右端の桁から 3, 1, 3, ...
  # の重みを掛けて合計し、10 の補数を取る。スキャナ誤読・手入力ミスの検出用。
  def self.check_digit(digits)
    sum = digits.chars.reverse.each_with_index.sum do |ch, index|
      ch.to_i * (index.even? ? 3 : 1)
    end
    ((10 - sum % 10) % 10).to_s
  end
end
