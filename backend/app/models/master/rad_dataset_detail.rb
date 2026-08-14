module Master
  # 実施入力用データセットの明細。detail_type で参照先マスタが決まる。
  # 3種を1テーブルに縦持ちしている理由は migration のコメントを参照。
  class RadDatasetDetail < ApplicationRecord
    self.table_name = "master_rad_dataset_details"

    # detail_type => 参照先マスタのモデルとコード列。名称解決とバリデーションで使う。
    REFERENCES = {
      "procedure" => { model: "Master::MedicalProcedure", code_column: :procedure_code },
      "medicine" => { model: "Master::Medicine", code_column: :medicine_code },
      "material" => { model: "Master::RadMaterial", code_column: :material_code },
    }.freeze

    DETAIL_TYPES = REFERENCES.keys.freeze

    validates :dataset_code, presence: true
    validates :detail_type, presence: true, inclusion: { in: DETAIL_TYPES }
    validates :code, presence: true, uniqueness: { scope: %i[dataset_code detail_type] }
    validates :default_quantity, numericality: { greater_than: 0 }, allow_nil: true

    # 参照先マスタの名称を添える。FK が無いので detail_type つきでコードを LEFT JOIN
    # する(参照先が未取込・削除済みでも明細は出せるよう外部結合)。
    # データセット詳細と実施入力の両方から使うので、コントローラではなくここに置く。
    #
    # 添える値:
    #   resolved_name          … 画面に出す名称(手技名・医薬品名・器材の製品名)
    #   resolved_unit_name     … 数量の単位(医薬品と器材のみ)
    #   receipt_material_code  … 器材の算定用コード。FHIR の usedCode に載せる
    #   yj_code                … 造影剤の個別医薬品コード。処方・注射と揃える
    scope :with_names, lambda {
      joins("LEFT JOIN master_medical_procedures " \
            "ON master_rad_dataset_details.detail_type = 'procedure' " \
            "AND master_medical_procedures.procedure_code = master_rad_dataset_details.code")
        .joins("LEFT JOIN master_medicines " \
               "ON master_rad_dataset_details.detail_type = 'medicine' " \
               "AND master_medicines.medicine_code = master_rad_dataset_details.code")
        .joins("LEFT JOIN master_rad_materials " \
               "ON master_rad_dataset_details.detail_type = 'material' " \
               "AND master_rad_materials.material_code = master_rad_dataset_details.code")
        .select(
          "master_rad_dataset_details.*",
          "COALESCE(master_medical_procedures.name, master_medicines.name, master_rad_materials.name) " \
          "AS resolved_name",
          "COALESCE(master_medicines.unit_name, master_rad_materials.unit_name) AS resolved_unit_name",
          "master_rad_materials.receipt_material_code AS receipt_material_code",
          "(SELECT hc.individual_medicine_code FROM master_hot_codes hc " \
          "WHERE hc.receipt_code_1 = master_medicines.medicine_code " \
          "AND hc.individual_medicine_code <> '' LIMIT 1) AS yj_code",
        )
    }

    # 明細の並び。データセット内は表示順、同順なら登録順。
    scope :in_display_order, lambda {
      order(Arel.sql("master_rad_dataset_details.display_order NULLS LAST")).order(:id)
    }

    # 参照先マスタのレコード。取込前・削除済みなら nil。
    def referenced_record
      reference = REFERENCES[detail_type]
      return nil if reference.nil? || code.blank?

      reference[:model].constantize.find_by(reference[:code_column] => code)
    end
  end
end
