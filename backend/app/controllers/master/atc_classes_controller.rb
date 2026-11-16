module Master
  # ATC 分類(2〜4 階層目)。規則の登録画面が全件を候補に出すのでページングしない。
  # docs/drug-check-master-design.md
  class AtcClassesController < BaseController
    include Importable

    def index
      render json: Master::AtcClass.order(:code).pluck(:code, :name).map { |code, name| { code: code, name: name } }
    end
  end
end
