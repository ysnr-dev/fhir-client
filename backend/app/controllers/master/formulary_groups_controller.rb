module Master
  # 院内フォーミュラリの薬効群。一覧は薬剤(entries)を医薬品名・単位・剤形付きで
  # ネストして返す。群は多くて数十件なのでページングしない。
  class FormularyGroupsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::FormularyGroup.all
      scope = scope.where(dosage_form: params[:dosage_form]) if params[:dosage_form].present?
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[master_formulary_groups.name])
      end
      groups = scope.order(Arel.sql("display_order NULLS LAST")).order(:code).to_a

      render json: groups.map { |group| serialize(group, entries_by_group[group.id] || []) }
    end

    def show
      render json: serialize(@record, entries_by_group[@record.id] || [])
    end

    private

    def serialize(group, entries)
      group.as_json.merge("entries" => entries)
    end

    # 全群ぶんの薬剤を一度に引く。医薬品名などは医薬品マスタからコードで外部結合
    # (取込で消えた薬も行は残るので、名称は NULL になりうる)。
    def entries_by_group
      @entries_by_group ||= Master::FormularyEntry
        .joins("LEFT JOIN master_medicines ON master_medicines.medicine_code = master_formulary_entries.medicine_code")
        .joins("LEFT JOIN master_medicine_types ON master_medicine_types.code = LEFT(master_medicines.yakka_code, 4)")
        .select(
          "master_formulary_entries.*",
          "master_medicines.name AS medicine_name",
          "master_medicines.unit_name AS medicine_unit_name",
          "master_medicines.dosage_form AS medicine_dosage_form",
          "master_medicines.generic_name_description AS generic_name",
          "LEFT(master_medicines.yakka_code, 4) AS yakko_code",
          "master_medicine_types.name AS yakko_name",
          "(SELECT hc.individual_medicine_code FROM master_hot_codes hc " \
          "WHERE hc.receipt_code_1 = master_formulary_entries.medicine_code " \
          "AND hc.individual_medicine_code <> '' LIMIT 1) AS yj_code",
        )
        .order(:rank, :id)
        .group_by(&:formulary_group_id)
    end

    def record_params
      permitted = params.permit(:code, :name, :dosage_form, :display_order, :note, yakko_codes: [])
      permitted[:yakko_codes] = [] if params.key?(:yakko_codes) && params[:yakko_codes].nil?
      permitted
    end
  end
end
