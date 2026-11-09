module Master
  # 血液浄化器の施設マスタ。画面から手動で登録し、算定に使うレセプト電算の特定器材コードを
  # 紐付ける。一覧・詳細では紐付け先の名称と価格を添えて返すので、画面はコードだけを持てばよい。
  class BloodPurifiersController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = with_receipt_material
      scope = scope.where(kind: params[:kind]) if params[:kind].present?
      # 未紐付けのものだけを洗い出す(算定できない製品の点検用)。
      scope = scope.where(receipt_material_code: [nil, ""]) if params[:unlinked] == "true"
      # active=true は今日採用している製品(有効期間内)だけに絞る。
      scope = scope.active_on if params[:active] == "true"
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name],
                                    %w[master_blood_purifiers.search_name master_blood_purifiers.search_kana])
      end
      if params[:maker].present?
        scope = flexible_name_match(scope, params[:maker], %w[master_blood_purifiers.maker])
      end

      render json: paginate(scope.order(Arel.sql("master_blood_purifiers.display_order NULLS LAST"))
                                 .order(:purifier_code))
    end

    def show
      render json: with_receipt_material.find(@record.id)
    end

    def create
      record = Master::BloodPurifier.new(record_params)
      record.purifier_code = next_purifier_code if record.purifier_code.blank?
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
      Master::BloodPurifier
        .joins("LEFT JOIN master_medical_materials " \
               "ON master_medical_materials.material_code = master_blood_purifiers.receipt_material_code")
        .select(
          "master_blood_purifiers.*",
          "master_medical_materials.name AS receipt_material_name",
          "master_medical_materials.price AS receipt_material_price",
        )
    end

    # 数字だけのコードの最大値の次。
    def next_purifier_code
      max = Master::BloodPurifier.where("purifier_code ~ '^[0-9]+$'")
                                 .maximum(Arel.sql("purifier_code::bigint"))
      ((max || 0) + 1).to_s.rjust(6, "0")
    end

    def set_record
      # id ではなくコードでも引けるようにする。
      @record = Master::BloodPurifier.find_by(purifier_code: params[:id]) || Master::BloodPurifier.find(params[:id])
    end
  end
end
