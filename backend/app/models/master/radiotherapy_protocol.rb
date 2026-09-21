module Master
  # 放射線治療の治療プロトコル(定型処方)マスタ(docs/radiotherapy-order-design.md §3)。
  #
  # 標的(volumes)と Phase(phases)は jsonb。処方フォームで選ぶと展開され、展開後は
  # 自由に直せる(オーダーにはプロトコルのコードと名称だけが残る)。
  class RadiotherapyProtocol < ApplicationRecord
    self.table_name = "master_radiotherapy_protocols"

    INTENTS = %w[curative neoadjuvant adjuvant palliative prophylactic].freeze

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :intent, inclusion: { in: INTENTS }, allow_blank: true
    validate :volumes_are_well_formed
    validate :phases_are_well_formed

    before_save :set_search_columns

    private

    def volumes_are_well_formed
      return errors.add(:volumes, "は配列で指定してください") unless volumes.is_a?(Array)
      return errors.add(:volumes, "を 1 件以上指定してください") if volumes.empty?

      keys = volumes.map { |v| v.is_a?(Hash) ? v["key"].to_s : "" }
      errors.add(:volumes, "の key は空にできません") if keys.any?(&:blank?)
      errors.add(:volumes, "の key が重複しています") if keys.uniq.size != keys.size
      errors.add(:volumes, "の名称は空にできません") if volumes.any? { |v| !v.is_a?(Hash) || v["label"].blank? }
    end

    def phases_are_well_formed
      return errors.add(:phases, "は配列で指定してください") unless phases.is_a?(Array)
      return errors.add(:phases, "を 1 件以上指定してください") if phases.empty?

      volume_keys = volumes.is_a?(Array) ? volumes.filter_map { |v| v["key"].to_s if v.is_a?(Hash) } : []
      phases.each_with_index do |phase, index|
        label = "Phase #{index + 1}"
        next errors.add(:phases, "#{label} の形式が不正です") unless phase.is_a?(Hash)

        fractions = phase["fractions"]
        errors.add(:phases, "#{label} の分割回数は 1 以上の整数にしてください") unless fractions.is_a?(Integer) && fractions.positive?

        doses = phase["doses"]
        next errors.add(:phases, "#{label} に線量を 1 件以上指定してください") unless doses.is_a?(Array) && doses.any?

        doses.each do |dose|
          unless dose.is_a?(Hash) && volume_keys.include?(dose["volume_key"].to_s)
            next errors.add(:phases, "#{label} の線量が標的を指していません")
          end

          fraction_dose = dose["fraction_dose"]
          errors.add(:phases, "#{label} の 1 回線量は正の数にしてください") unless fraction_dose.is_a?(Numeric) && fraction_dose.positive?
        end
      end
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
