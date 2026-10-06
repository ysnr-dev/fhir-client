module Master
  # データ抽出の条件(docs/data-extract-design.md)の登録・参照。チャート定義と同じく現場が
  # 育てる運用データで、持ち主と認可は ScopedDefinitions。抽出の実行は画面が上流を直接引く。
  class ExtractQueriesController < BaseController
    include ScopedDefinitions

    private

    def model_class = ExtractQuery
  end
end
