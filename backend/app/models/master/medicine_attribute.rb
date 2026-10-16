module Master
  # 薬剤付加情報。医薬品マスタ(レセプト電算)に無い、施設独自の薬剤の設定を 1 薬 1 行で持つ
  # (docs/lot-number-design.md)。
  #
  # 項目は settings(jsonb)に入れる。**項目を足すときに書くのは下の ATTRIBUTES だけ**で、検証・API の
  # 定義・画面の列はこの表から回る(施設設定 FacilitySettings::SETTINGS と同じ作り)。
  class MedicineAttribute < ApplicationRecord
    self.table_name = "master_medicine_attributes"

    # 抗菌薬の薬効分類(薬価基準コードの上 4 桁 = 薬効分類番号の前方一致)。frontend の
    # fhir/antimicrobialHelpers.ts の ANTIMICROBIAL_YAKKO_PREFIXES と同じ値。
    ANTIMICROBIAL_YAKKO_PREFIXES = %w[61 622 624].freeze
    ANTIMICROBIAL_CATEGORIES = %w[none notify approve].freeze
    DDD_UNITS = %w[g mg MU].freeze

    def self.antimicrobial?(medicine)
      code = medicine&.yakka_code.to_s
      ANTIMICROBIAL_YAKKO_PREFIXES.any? { |prefix| code.start_with?(prefix) }
    end

    # 項目の表。
    #   label:      画面の列名
    #   type:       画面の入力の種類(boolean / enum / quantity)
    #   shape:      値の形(JsonShape の葉)
    #   default:    行に値が無いときの既定。医薬品マスタの行を受け取って決める
    #   applicable: その薬に設定できるか(省略は全薬)。偽の薬に値を保存すると 422
    ATTRIBUTES = {
      # 特定生物由来製品などのロット番号を実施時に記録する薬。医薬品マスタの「生物学的製剤」の印が
      # ある薬は既定で対象(印は特定生物由来製品を区別しないので、施設がこの項目で足し引きする)。
      "lot_required" => {
        label: "ロット管理",
        type: "boolean",
        shape: :boolean,
        default: ->(medicine) { medicine&.biological_product_flag == "1" }
      },
      # 特定抗菌薬の区分(docs/antimicrobial-stewardship-design.md)。届出制・許可制の薬は処方・注射で
      # 警告を出し、依頼医に届出の通知を送る。
      "antimicrobial_category" => {
        label: "特定抗菌薬",
        type: "enum",
        options: [
          { value: "none", label: "-" },
          { value: "notify", label: "届出制" },
          { value: "approve", label: "許可制" }
        ],
        shape: { enum: ANTIMICROBIAL_CATEGORIES },
        default: ->(_medicine) { "none" },
        applicable: ->(medicine) { antimicrobial?(medicine) }
      },
      # 1 日規定用量(WHO の DDD)。抗菌薬使用密度(AUD)の分母に使う。
      "ddd" => {
        label: "DDD",
        type: "quantity",
        units: DDD_UNITS,
        shape: { fields: { "value" => :number, "unit" => { enum: DDD_UNITS } }, required: %w[value unit] },
        default: ->(_medicine) {},
        applicable: ->(medicine) { antimicrobial?(medicine) }
      }
    }.freeze

    SHAPE = { fields: ATTRIBUTES.transform_values { |a| a[:shape] } }.freeze

    validates :medicine_code, presence: true, uniqueness: true
    validate :settings_shape
    validate :settings_applicable

    before_validation :drop_blank_settings

    # 行(無ければ nil)と医薬品マスタの行から、項目ごとの実効値。
    def self.effective(record, medicine)
      ATTRIBUTES.to_h do |key, attribute|
        stored = record&.settings&.dig(key)
        [key, stored.nil? ? attribute[:default].call(medicine) : stored]
      end
    end

    # 画面が列を組み立てるための項目の定義。
    def self.definitions
      ATTRIBUTES.map do |key, attribute|
        { key: key, label: attribute[:label], type: attribute[:type] }
          .merge(attribute.slice(:options, :units))
      end
    end

    # 項目ごとに、その薬に設定できるか。
    def self.applicable(medicine)
      ATTRIBUTES.to_h { |key, attribute| [key, attribute[:applicable] ? attribute[:applicable].call(medicine) : true] }
    end

    private

    # 画面の「未設定」(null)は保存しない(既定に戻す)。
    def drop_blank_settings
      self.settings = (settings.is_a?(Hash) ? settings : {}).compact
    end

    def settings_shape
      JsonShape.errors(SHAPE, settings, "settings").each { |message| errors.add(:settings, message) }
    end

    def settings_applicable
      return unless settings.is_a?(Hash)

      allowed = self.class.applicable(Master::Medicine.find_by(medicine_code: medicine_code))
      settings.each_key do |key|
        errors.add(:settings, "#{ATTRIBUTES.dig(key, :label)} はこの薬には設定できません") if allowed[key] == false
      end
    end
  end
end
