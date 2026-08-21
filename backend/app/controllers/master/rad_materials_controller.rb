module Master
  # 放射線検査で使う器材の施設マスタ。画面から手動で登録し、算定に使うレセプト電算の
  # 特定器材コードを紐付ける。一覧・詳細では紐付け先の名称と価格を添えて返すので、
  # 画面はコードだけを持てばよい。
  class RadMaterialsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = with_receipt_material
      # カンマ区切りで複数指定可(保存済みの実施情報から器材名を一括復元するため)。
      scope = scope.where(material_code: params[:material_code].split(",")) if params[:material_code].present?
      if params[:receipt_material_code].present?
        scope = scope.where(receipt_material_code: params[:receipt_material_code])
      end
      # 未紐付けのものだけを洗い出す(算定できない器材の点検用)。
      scope = scope.where(receipt_material_code: [nil, ""]) if params[:unlinked] == "true"
      # active=true は今日採用している器材(有効期間内)だけに絞る。
      scope = scope.active_on if params[:active] == "true"
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name],
                                    %w[master_rad_materials.search_name master_rad_materials.search_kana])
      end
      if params[:maker].present?
        scope = flexible_name_match(scope, params[:maker], %w[master_rad_materials.maker])
      end

      render json: paginate(scope.order(Arel.sql("master_rad_materials.display_order NULLS LAST"))
                                 .order(:material_code))
    end

    def show
      render json: with_receipt_material.find(@record.id)
    end

    def create
      record = Master::RadMaterial.new(record_params)
      record.material_code = next_material_code if record.material_code.blank?
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    private

    # 紐付け先(レセプト電算の特定器材)の名称・価格を添える。FK が無いのでコードで
    # LEFT JOIN する。配布マスタが未取込・廃止コードでも一覧は出せるよう外部結合にする。
    def with_receipt_material
      Master::RadMaterial
        .joins("LEFT JOIN master_medical_materials " \
               "ON master_medical_materials.material_code = master_rad_materials.receipt_material_code")
        .select(
          "master_rad_materials.*",
          "master_medical_materials.name AS receipt_material_name",
          "master_medical_materials.price AS receipt_material_price",
        )
    end

    # 数字だけの器材コードの最大値の次。手入力の英字混じりコードは無視する
    # (放射線オーダー項目マスタと同じ採番)。
    def next_material_code
      max = Master::RadMaterial.where("material_code ~ '^[0-9]+$'")
                               .maximum(Arel.sql("material_code::bigint"))
      ((max || 0) + 1).to_s.rjust(6, "0")
    end

    def set_record
      # id ではなく器材コードでも引けるようにする。
      @record = Master::RadMaterial.find_by(material_code: params[:id]) || Master::RadMaterial.find(params[:id])
    end
  end
end
