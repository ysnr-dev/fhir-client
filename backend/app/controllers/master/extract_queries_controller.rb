module Master
  # データ抽出の条件(docs/data-extract-design.md)の登録・参照。チャート定義と同じく現場が
  # 育てる運用データで、持ち主と認可は ScopedDefinitions。抽出の実行は画面が上流を直接引く。
  # 条件はタブ(tab)ごとに形が違い、一覧は tab で絞れる(無ければすべて)。
  class ExtractQueriesController < BaseController
    include ScopedDefinitions

    def index
      records = ExtractQuery.roots_for(
        department_id: params[:department_id].presence,
        practitioner_id: params[:practitioner_id].presence,
      ).ordered
      records = records.where(tab: params[:tab]) if params[:tab].present?
      render json: { total: records.size, items: records.map { |r| detail(r) } }
    end

    private

    def model_class = ExtractQuery

    # タブは作るときだけ受け取る(保存した後は変えない。モデルの attr_readonly)。
    def record_params
      action_name == "create" ? super.merge(params.permit(:tab)) : super
    end

    def detail(record)
      super.merge("tab" => record.tab)
    end
  end
end
