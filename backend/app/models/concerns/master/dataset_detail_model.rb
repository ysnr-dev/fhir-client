module Master
  # 実施入力用データセットの明細(生理検査・内視鏡・処置)の共通定義。detail_type で
  # 参照先マスタが決まる。3種を1テーブルに縦持ちしている理由は migration のコメントを参照。
  #
  # 放射線(RadDatasetDetail)との違いは material の参照先。放射線は施設内の器材
  # マスタ(master_rad_materials)を経由して算定コードに繋いでいるが、これらの部門で
  # 個別算定する特定器材は算定コードそのものである master_medical_materials を
  # 直接参照する(施設内コードの段が無い)。
  module DatasetDetailModel
    extend ActiveSupport::Concern

    # detail_type => 参照先マスタのモデルとコード列(名称は with_names で結合する)。
    REFERENCES = {
      "procedure" => { model: "Master::MedicalProcedure", code_column: :procedure_code },
      "medicine" => { model: "Master::Medicine", code_column: :medicine_code },
      "material" => { model: "Master::MedicalMaterial", code_column: :material_code },
    }.freeze

    DETAIL_TYPES = REFERENCES.keys.freeze

    included do
      validates :dataset_code, presence: true
      validates :detail_type, presence: true, inclusion: { in: DETAIL_TYPES }
      validates :code, presence: true, uniqueness: { scope: %i[dataset_code detail_type] }
      validates :default_quantity, numericality: { greater_than: 0 }, allow_nil: true

      # 参照先マスタの名称を添える。FK が無いので detail_type つきでコードを LEFT JOIN
      # する(参照先が未取込・削除済みでも明細は出せるよう外部結合)。
      # データセット詳細と実施入力の両方から使うので、コントローラではなくここに置く。
      #
      # 添える値:
      #   resolved_name        … 画面に出す名称(手技名・医薬品名・特定器材の収載名)
      #   resolved_unit_name   … 数量の単位(医薬品と器材のみ)
      #   yj_code              … 薬剤の個別医薬品コード。処方・注射と揃える
      #
      # 放射線にある receipt_material_code は添えない。material の code 自体が
      # 算定用の特定器材コードなので、別に持つ必要がない。
      scope :with_names, lambda {
        details = table_name
        joins("LEFT JOIN master_medical_procedures " \
              "ON #{details}.detail_type = 'procedure' " \
              "AND master_medical_procedures.procedure_code = #{details}.code")
          .joins("LEFT JOIN master_medicines " \
                 "ON #{details}.detail_type = 'medicine' " \
                 "AND master_medicines.medicine_code = #{details}.code")
          .joins("LEFT JOIN master_medical_materials " \
                 "ON #{details}.detail_type = 'material' " \
                 "AND master_medical_materials.material_code = #{details}.code")
          .select(
            "#{details}.*",
            "COALESCE(master_medical_procedures.name, master_medicines.name, " \
            "master_medical_materials.name) AS resolved_name",
            "COALESCE(master_medicines.unit_name, master_medical_materials.unit_name) " \
            "AS resolved_unit_name",
            "(SELECT hc.individual_medicine_code FROM master_hot_codes hc " \
            "WHERE hc.receipt_code_1 = master_medicines.medicine_code " \
            "AND hc.individual_medicine_code <> '' LIMIT 1) AS yj_code",
          )
      }

      # 明細の並び。データセット内は表示順、同順なら登録順。
      scope :in_display_order, lambda {
        order(Arel.sql("#{table_name}.display_order NULLS LAST")).order(:id)
      }
    end
  end
end
