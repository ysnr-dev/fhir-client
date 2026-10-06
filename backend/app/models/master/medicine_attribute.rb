module Master
  # 薬剤付加情報。医薬品マスタ(レセプト電算)に無い、施設独自の薬剤の設定を 1 薬 1 行で持つ
  # (docs/lot-number-design.md)。
  #
  # 項目は settings(jsonb)に入れる。**項目を足すときに書くのは下の ATTRIBUTES だけ**で、検証・API の
  # 定義・画面の列はこの表から回る(施設設定 FacilitySettings::SETTINGS と同じ作り)。
  class MedicineAttribute < ApplicationRecord
    self.table_name = "master_medicine_attributes"

    # 項目の表。
    #   label:   画面の列名
    #   shape:   値の形(JsonShape の葉)
    #   default: 行に値が無いときの既定。医薬品マスタの行を受け取って決める
    ATTRIBUTES = {
      # 特定生物由来製品などのロット番号を実施時に記録する薬。医薬品マスタの「生物学的製剤」の印が
      # ある薬は既定で対象(印は特定生物由来製品を区別しないので、施設がこの項目で足し引きする)。
      "lot_required" => {
        label: "ロット管理",
        shape: :boolean,
        default: ->(medicine) { medicine&.biological_product_flag == "1" }
      }
    }.freeze

    SHAPE = { fields: ATTRIBUTES.transform_values { |a| a[:shape] } }.freeze

    validates :medicine_code, presence: true, uniqueness: true
    validate :settings_shape

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
      ATTRIBUTES.map { |key, attribute| { key: key, label: attribute[:label], type: attribute[:shape].to_s } }
    end

    private

    # 画面の「未設定」(null)は保存しない(既定に戻す)。
    def drop_blank_settings
      self.settings = (settings.is_a?(Hash) ? settings : {}).compact
    end

    def settings_shape
      JsonShape.errors(SHAPE, settings, "settings").each { |message| errors.add(:settings, message) }
    end
  end
end
