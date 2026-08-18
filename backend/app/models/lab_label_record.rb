# 検体ラベルの発行記録。ラベルに刷る番号と、その番号が指すオーダー・検体・採取管の
# 対応を持つ。番号はバーコード(CODE128)として刷り、到着確認でのスキャン逆引きに使う。
#
# 番号は「id の 10 桁ゼロ埋め + チェックデジット(M10W3)1 桁」の 11 桁。番号自体には
# 日付や患者番号などの意味を持たせない(docs/lab-label-design.md §3)。
class LabLabelRecord < ApplicationRecord
  validates :order_fhir_id, presence: true

  # 発行のたびに(オーダー, 検体)で引き、無ければ採番して作る。再発行は同じ番号を
  # 返す(番号は採取管の同一性を表すもので、発行操作の回数を表すものではない)。
  #
  # 番号は行の id から組むため「作ってから埋める」の 2 段になる。label_number が
  # NULL のままの行は、埋める前に落ちた発行の残骸なので次の発行で埋め直す。
  def self.ensure_for(order_fhir_id:, specimen_code:, container_code:)
    record = find_or_create_by!(order_fhir_id:, specimen_code:) do |r|
      r.container_code = container_code
    end
    record.update!(label_number: number_for(record.id)) if record.label_number.blank?
    record
  rescue ActiveRecord::RecordNotUnique
    # 並行発行で作成が同時に走った側。作られた行を引き直す。
    retry
  end

  def self.number_for(id)
    base = format("%010d", id)
    "#{base}#{check_digit(base)}"
  end

  # 到着確認のスキャン入力の検証。11 桁の数字で、末尾がチェックデジットと一致すること。
  def self.valid_number?(number)
    number.match?(/\A\d{11}\z/) && check_digit(number[0, 10]) == number[10]
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
