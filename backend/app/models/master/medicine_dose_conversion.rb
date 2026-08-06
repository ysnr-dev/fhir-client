module Master
  # 処方の投与量入力を医薬品マスタの薬価算定単位へ換算するための係数。
  # 1医薬品につき入力単位ごとに1行(例: mg→管 と mL→管 の2行)を持つ。
  class MedicineDoseConversion < ApplicationRecord
    self.table_name = "master_medicine_dose_conversions"

    # 自動生成の導出根拠。manual は画面から手で登録・修正したもの。
    SOURCES = %w[explicit from_percent volume identity from_name injection_volume manual].freeze

    validates :medicine_code, presence: true
    validates :from_unit, presence: true, uniqueness: { scope: :medicine_code }
    validates :to_unit, presence: true
    validates :factor, numericality: { greater_than: 0 }
    validates :source, inclusion: { in: SOURCES }
  end
end
