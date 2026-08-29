module Master
  # 看護観察編の単位テーブル。読み取り専用。
  class NursingUnitsController < BaseController
    include Importable

    def index
      render json: paginate(Master::NursingUnit.order(:unit_code), max_per: 500)
    end
  end
end
