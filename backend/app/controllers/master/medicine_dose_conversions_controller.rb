module Master
  class MedicineDoseConversionsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    # 規格単位は販売名単位の HOT をレセプト電算コードで、引けなければ個別医薬品
    # コード(YJ)で引く。DoseConversionBuilder の索引と同じ優先順位。
    STANDARD_UNIT_SQL = <<~SQL.squish.freeze
      COALESCE(
        (SELECT hc.standard_unit FROM master_hot_codes hc
         WHERE hc.receipt_code_1 = master_medicines.medicine_code
         AND hc.standard_unit <> '' LIMIT 1),
        (SELECT hc2.standard_unit FROM master_hot_codes hc2
         WHERE hc2.individual_medicine_code = master_medicines.yakka_code
         AND hc2.standard_unit <> '' LIMIT 1)
      ) AS standard_unit
    SQL

    def index
      scope = conversions_with_medicine
      # 注射オーダーは RP 内の医薬品をまとめて mL 換算するため、カンマ区切りの複数コードと
      # 換算元単位での絞り込みを受け付ける(検査項目マスタの jlac11_code と同じ方式)。
      scope = scope.where(medicine_code: params[:medicine_code].split(",")) if params[:medicine_code].present?
      scope = scope.where(from_unit: params[:from_unit]) if params[:from_unit].present?
      scope = scope.where(source: params[:source]) if params[:source].present?
      scope = scope.where(needs_review: true) if params[:needs_review] == "true"
      scope = scope.where("master_medicines.dosage_form = ?", params[:dosage_form]) if params[:dosage_form].present?
      scope = filter_by_medicine_name(scope, params[:name]) if params[:name].present?

      render json: paginate(scope)
    end

    # 換算行を1件も持たない医薬品。手動メンテの対象一覧。
    def unmapped
      scope = Master::Medicine
        .where("NOT EXISTS (SELECT 1 FROM master_medicine_dose_conversions c " \
               "WHERE c.medicine_code = master_medicines.medicine_code)")
        .select("master_medicines.id", "master_medicines.medicine_code", "master_medicines.name",
                "master_medicines.unit_name", "master_medicines.dosage_form",
                "master_medicines.yakka_code", STANDARD_UNIT_SQL)
      scope = scope.where(dosage_form: params[:dosage_form]) if params[:dosage_form].present?
      scope = filter_by_medicine_name(scope, params[:name]) if params[:name].present?

      render json: paginate(scope)
    end

    # 未紐付けの医薬品に対してだけ換算行を一括生成する。既存行は上書きしない。
    def generate
      result = Master::DoseConversionBuilder.call
      render json: {
        created: result.created_count,
        medicines: result.medicine_count,
        skipped: result.skipped_count,
        unmapped: result.unmapped_count,
        needs_review: result.needs_review_count,
        volume_filled: result.volume_filled_count,
      }
    end

    def create
      record = Master::MedicineDoseConversion.new(record_params)
      record.to_unit = default_to_unit(record.medicine_code) if record.to_unit.blank?
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    private

    # メンテ画面では医薬品名・剤形と、換算の根拠になった規格単位を並べて見る。
    def conversions_with_medicine
      Master::MedicineDoseConversion
        .joins("LEFT JOIN master_medicines ON master_medicines.medicine_code = " \
               "master_medicine_dose_conversions.medicine_code")
        .select(
          "master_medicine_dose_conversions.*",
          "master_medicines.name AS medicine_name",
          "master_medicines.unit_name AS medicine_unit_name",
          "master_medicines.dosage_form AS dosage_form",
          STANDARD_UNIT_SQL,
        )
    end

    # JOIN 後は他テーブルにも search_name があるためテーブル修飾で曖昧さを回避する。
    def filter_by_medicine_name(scope, query)
      flexible_name_match(scope, query,
                          %w[master_medicines.search_name master_medicines.search_kana
                             master_medicines.search_generic])
    end

    def default_to_unit(medicine_code)
      Master::Medicine.where(medicine_code: medicine_code).pick(:unit_name)
    end

    # 画面から登録・修正したものは導出根拠を manual に固定する。
    def record_params
      params
        .permit(Master::MedicineDoseConversion.column_names - %w[id created_at updated_at])
        .merge(source: "manual")
    end
  end
end
