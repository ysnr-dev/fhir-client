module Master
  # 術式の種別(分類)のメンテナンス。生理検査の PhysioExamTypesController に当たるが、
  # 分類が入れ子になる(点数表 第10部の「款 → 区分」)ので親子を扱う。
  # 配布マスタは無く、点数表の款・区分を seed で入れたあとは画面で足していく。
  class SurgeryCategoriesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    # 選択肢は木に組み立てて表示するので、画面は常に全件をまとめて引く。
    # 点数表の款・区分を seed した時点で 70 件前後になるため、1 ページの上限を
    # 既定の 100 件より広げておく。
    OPTIONS_MAX_PER = 500

    def index
      scope = Master::SurgeryCategory.all
      # カンマ区切りで複数指定可(術式一覧に載っている分類の名称をまとめて引くため)。
      if params[:category_code].present?
        scope = scope.where(category_code: params[:category_code].split(","))
      end
      # 直下の子だけを引く。parent_code="" は最上位(親なし)を指す。
      if params.key?(:parent_code)
        scope = params[:parent_code].presence ? scope.where(parent_code: params[:parent_code])
                                              : scope.where(parent_code: nil)
      end
      # active=true は今日使える分類(有効期間内)だけに絞る。
      scope = scope.active_on if params[:active] == "true"
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name search_kana])
      end

      render json: paginate(ordered(scope), max_per: OPTIONS_MAX_PER)
    end

    def create
      record = Master::SurgeryCategory.new(record_params)
      record.category_code = next_category_code(record.parent_code) if record.category_code.blank?
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    # 外部キーを張っていないので、参照している術式の分類を外してから消す。
    # 配下に分類がある場合は消さない(まとめて消えると事故になるうえ、親を失った
    # 分類は一覧の木から外れて画面から触れなくなるため)。
    def destroy
      if Master::SurgeryCategory.exists?(parent_code: @record.category_code)
        return render json: { errors: ["配下の分類があるため削除できません"] },
                      status: :unprocessable_content
      end

      code = @record.category_code
      Master::SurgeryCategory.transaction do
        Master::SurgeryItem.where(category_code: code).update_all(category_code: nil)
        @record.destroy!
      end
      head :no_content
    end

    private

    # 同じ親の中では表示順、その次はコード順。木に組み立てるのは画面側なので、
    # ここでは兄弟同士の並びが決まっていれば足りる。
    def ordered(scope)
      scope.order(Arel.sql("display_order NULLS LAST")).order(:category_code)
    end

    # 親のコードに 2 桁を足したものを採番する("09" の配下 → "0901", "0902" …)。
    # 最上位は 2 桁。数字だけのコードの最大値の次で、手入力の英字混じりコードは
    # 無視する。同じ親に 99 件を超えたら手入力してもらう。
    def next_category_code(parent_code)
      prefix = parent_code.to_s
      siblings = Master::SurgeryCategory.where(parent_code: parent_code.presence)
                                       .where("category_code ~ ?", "^#{prefix}[0-9]{2}$")
                                       .pluck(:category_code)
      max = siblings.map { |code| code[prefix.length, 2].to_i }.max || 0
      "#{prefix}#{(max + 1).to_s.rjust(2, '0')}"
    end

    def set_record
      # id ではなく分類コードでも引けるようにする。
      @record = Master::SurgeryCategory.find_by(category_code: params[:id]) ||
                Master::SurgeryCategory.find(params[:id])
    end
  end
end
