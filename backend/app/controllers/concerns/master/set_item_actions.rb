module Master
  # セット(1オーダー → 複数の項目)の構成のアクション。オーダー項目の詳細画面から
  # 編集する。構成項目のモデルは名前の規約で引く(PhysioSetItem → PhysioItem)。
  # 名称のほかに添える構成項目の列は member_columns で宣言する。
  module SetItemActions
    extend ActiveSupport::Concern

    included do
      before_action :set_record, only: %i[update destroy]
    end

    def index
      scope = model_class.all
      # どちらもカンマ区切りで複数指定可(オーダー画面が選択中のセットの構成を
      # まとめて引くため)。
      if params[:set_item_code].present?
        scope = scope.where(set_item_code: params[:set_item_code].split(","))
      end
      if params[:member_item_code].present?
        scope = scope.where(member_item_code: params[:member_item_code].split(","))
      end

      # 構成項目の名称を添える(オーダー画面がセットの中身を並べて見せるため)。
      set_items = model_class.table_name
      items = item_model.table_name
      scope = scope
        .joins("LEFT JOIN #{items} ON #{items}.item_code = #{set_items}.member_item_code")
        .select(
          "#{set_items}.*",
          "#{items}.name AS member_name",
          "#{items}.short_name AS member_short_name",
          *member_columns.map { |column| "#{items}.#{column} AS member_#{column}" },
        )

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")))
    end

    def create
      record = model_class.new(record_params)
      # 追加順に並べる(明示されていれば従う)。
      record.display_order ||= next_display_order(record.set_item_code)
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    private

    def item_model
      "#{model_class.name.delete_suffix('SetItem')}Item".constantize
    end

    # 名称に加えて構成項目から添える列。
    def member_columns
      []
    end

    def next_display_order(set_item_code)
      (model_class.where(set_item_code: set_item_code).maximum(:display_order) || 0) + 1
    end
  end
end
