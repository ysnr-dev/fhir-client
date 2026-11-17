module Master
  # 処方の投与量入力を医薬品マスタの薬価算定単位へ換算するための係数。
  # 1医薬品につき入力単位ごとに1行(例: mg→管 と mL→管 の2行)を持つ。
  class MedicineDoseConversion < ApplicationRecord
    self.table_name = "master_medicine_dose_conversions"

    # 自動生成の導出根拠。manual は画面から手で登録・修正したもの。
    SOURCES = %w[explicit from_percent volume identity from_name injection_volume package manual].freeze

    # 入力単位の種類。potency(力価) / volume(容量 mL) / package(包装単位。枚・本など) /
    # identity(薬価算定単位そのもの)。包装単位の行がある薬は、その単位が用量入力の初期単位になる。
    KINDS = %w[potency volume package identity].freeze
    PACKAGE = "package".freeze

    before_validation :normalize_from_unit
    before_validation :assign_kind, if: -> { kind.blank? }

    validates :medicine_code, presence: true
    validates :from_unit, presence: true, uniqueness: { scope: :medicine_code }
    validates :to_unit, presence: true
    validates :factor, numericality: { greater_than: 0 }
    validates :source, inclusion: { in: SOURCES }
    validates :kind, inclusion: { in: KINDS }

    scope :package, -> { where(kind: PACKAGE) }

    # 全角・半角の違いを畳んだ単位。換算行の from_unit はこの形で持つ。
    def self.normalize_unit(unit)
      unit.to_s.unicode_normalize(:nfkc).strip
    end

    # オーダーの単位に当たる換算行。
    def self.for_unit(medicine_code, unit)
      normalized = normalize_unit(unit)
      return nil if normalized.empty?

      find_by(medicine_code: medicine_code, from_unit: normalized)
    end

    # 種類の指定が無い行の種類。mL は容量、薬価算定単位と同じ単位は identity、他は力価。
    def self.kind_of(from_unit, to_unit)
      from = normalize_unit(from_unit)
      return "identity" if from == normalize_unit(to_unit)

      from.casecmp?("ml") ? "volume" : "potency"
    end

    private

    def normalize_from_unit
      self.from_unit = self.class.normalize_unit(from_unit) if from_unit
    end

    def assign_kind
      self.kind = self.class.kind_of(from_unit, to_unit)
    end
  end
end
