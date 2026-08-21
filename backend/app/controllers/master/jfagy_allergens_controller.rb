module Master
  class JfagyAllergensController < BaseController
    include Importable
    def index
      scope = Master::JfagyAllergen.all
      scope = scope.where(jfagy_code: params[:jfagy_code]) if params[:jfagy_code].present?
      # 階層レベル(1〜6)での絞り込み。上位階層のみ表示する用途を想定。
      scope = scope.where(level: params[:level]) if params[:level].present?
      # 領域での絞り込み。メタコード3桁目が F=食品、M=医薬品、N=非食品・非医薬品。
      scope = scope.where("substr(jfagy_code, 3, 1) = ?", params[:domain]) if params[:domain].present?
      # 階層プレフィックス(例: J9FA=農産食品の配下)での絞り込み。
      if params[:code_prefix].present?
        scope = scope.where("jfagy_code LIKE ?", "#{sanitize_like(params[:code_prefix])}%")
      end
      # 主要品目(MAINFLAG=1)のみに絞る。
      scope = scope.where(main_flag: "1") if params[:main_only].present?
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name search_kana])
      end

      render json: paginate(scope)
    end
  end
end
