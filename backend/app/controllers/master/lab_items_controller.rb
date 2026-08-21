module Master
  class LabItemsController < BaseController
    include Importable
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::LabItem.all
      # カンマ区切りで複数指定可(検査結果編集画面が保存済みコードからマスタ情報を一括復元したり、
      # 検体検査オーダーの JLAC コードから検査結果の項目を展開したりするため)。
      scope = scope.where(jlac11_code: params[:jlac11_code].split(",")) if params[:jlac11_code].present?
      scope = scope.where(jlac10_code: params[:jlac10_code].split(",")) if params[:jlac10_code].present?
      scope = apply_drilldown(scope)
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name search_abbreviation])
      end

      # マスタ収載の標準表示順で並べる(paginate が :id を追加するので同順位内は収載順)。
      # display_order は "100"〜"9200" のゼロ埋めされていない数字文字列で 3〜4 桁が
      # 混在するため、文字列順では 100 < 1000 < 200 になってしまう。LPAD で桁を
      # 揃えて数値順にする(整数キャストは非数値が混入したマスタで SQL エラーになる)。
      scope = scope.order(Arel.sql("LPAD(display_order, 8, '0')"))

      render json: paginate(scope)
    end

    # 検査項目選択モーダルの段階的絞り込み用の選択肢。
    # 区分名称 → 大項目 → 材料 → 測定法 の順に、上位の選択で絞り込んだ
    # distinct な値をマスタ収載順で返す。1リクエストで4リストぶんを返すため、
    # 選択のたびにリスト単位のリクエストが増えない。
    def filter_options
      scope = Master::LabItem.all
      category_names = distinct_ordered(scope, :category_name)

      scope = scope.where(category_name: params[:category_name]) if params[:category_name].present?
      # 名称検索は大項目リストの絞り込みだけに効かせる(下位のリストと結果一覧は
      # あくまで選択された大項目で決まる)。
      # 大項目名そのものも検索対象にする。「グルコース(血糖)」のように、大項目名が
      # 配下の FHIR 項目名称(随時血糖・空腹時血糖など)のどれとも一致しないことがある。
      major_scope = scope
      if params[:name].present?
        major_scope = flexible_name_match(
          major_scope, params[:name], %w[search_major_item search_name search_abbreviation]
        )
      end
      major_items = distinct_ordered(major_scope, :major_item)

      scope = scope.where(major_item: params[:major_item]) if params[:major_item].present?
      specimens = distinct_ordered(scope, :jlac11_specimen)

      scope = scope.where(jlac11_specimen: params[:jlac11_specimen]) if params[:jlac11_specimen].present?
      methods = distinct_ordered(scope, :jlac11_method)

      render json: {
        category_names: category_names,
        major_items: major_items,
        specimens: specimens,
        methods: methods
      }
    end

    private

    # 段階的絞り込み(大項目・材料・測定法)の完全一致フィルタ。
    def apply_drilldown(scope)
      scope = scope.where(category_name: params[:category_name]) if params[:category_name].present?
      scope = scope.where(major_item: params[:major_item]) if params[:major_item].present?
      scope = scope.where(jlac11_specimen: params[:jlac11_specimen]) if params[:jlac11_specimen].present?
      scope = scope.where(jlac11_method: params[:jlac11_method]) if params[:jlac11_method].present?
      scope
    end

    # 指定カラムの distinct な値をマスタ収載順(最初に現れた id 順)で返す。
    # flexible_name_match が付ける ORDER BY は GROUP BY と両立しないため落とす。
    def distinct_ordered(scope, column)
      scope
        .reorder(nil)
        .where.not(column => [nil, ""])
        .group(column)
        .minimum(:id)
        .sort_by { |_value, id| id }
        .map(&:first)
    end
  end
end
