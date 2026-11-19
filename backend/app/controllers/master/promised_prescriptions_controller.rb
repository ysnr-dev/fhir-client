module Master
  # 約束処方。一覧・詳細とも構成薬(items)を医薬品名付きで同梱し、登録・更新は構成薬ごと受ける。
  class PromisedPrescriptionsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::PromisedPrescription.all
      # active=true は今日使える約束処方(有効期間内)だけに絞る。
      scope = scope.active_on if params[:active] == "true"
      scope = flexible_name_match(scope, params[:name], %w[search_name search_kana]) if params[:name].present?

      page = paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:code))
      records = page[:items].to_a
      items = items_by_prescription(records.map(&:id))
      render json: page.merge(items: records.map { |record| serialize(record, items[record.id] || []) })
    end

    def show
      render json: serialize(@record, items_by_prescription([@record.id])[@record.id] || [])
    end

    def create
      record = Master::PromisedPrescription.new(record_params)
      record.code = next_code if record.code.blank?
      save_with_items(record, :created)
    end

    def update
      @record.assign_attributes(record_params)
      save_with_items(@record, :ok)
    end

    private

    # items を渡したときだけ構成薬を差し替える(ヘッダだけの更新では触らない)。
    def save_with_items(record, status)
      if params.key?(:items)
        record.items.each(&:mark_for_destruction)
        item_params.each_with_index do |item, index|
          record.items.build(item.merge(display_order: index + 1))
        end
      end

      if record.save
        render json: serialize(record, items_by_prescription([record.id])[record.id] || []), status: status
      else
        render_validation_errors(record)
      end
    end

    def serialize(record, items)
      record.as_json(except: %w[search_name search_kana]).merge("items" => items)
    end

    # 医薬品名は医薬品マスタからコードで外部結合(取込で消えた薬も行は残るので、名称は NULL になりうる)。
    def items_by_prescription(ids)
      Master::PromisedPrescriptionItem
        .where(promised_prescription_id: ids)
        .joins("LEFT JOIN master_medicines " \
               "ON master_medicines.medicine_code = master_promised_prescription_items.medicine_code")
        .select("master_promised_prescription_items.*", "master_medicines.name AS medicine_name")
        .order(Arel.sql("master_promised_prescription_items.display_order NULLS LAST"))
        .order(:id)
        .group_by(&:promised_prescription_id)
    end

    def record_params
      params.permit(:code, :name, :name_kana, :base_amount, :unit_name, :mix, :display_order,
                    :valid_from, :valid_to, :note)
    end

    def item_params
      Array(params[:items]).map { |item| item.permit(:medicine_code, :amount, :unit_name).to_h }
    end

    # seed のサンプルが使うコード帯。採番はこれより下で行う。
    SAMPLE_CODE_FLOOR = 900_000

    # 数字だけのコードの最大値の次(手入力の英字混じりコードとサンプルは無視する)。
    def next_code
      max = Master::PromisedPrescription.where("code ~ '^[0-9]+$'").where("code::bigint < ?", SAMPLE_CODE_FLOOR)
                                        .maximum(Arel.sql("code::bigint"))
      ((max || 0) + 1).to_s.rjust(6, "0")
    end
  end
end
