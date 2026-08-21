module Admin
  # テンプレートカテゴリの CRUD。上流中継ではなく backend DB に保存する。
  class QuestionnaireCategoriesController < BaseController
    # カテゴリ一覧はテンプレート選択プルダウン(診療画面)からも読むため、
    # 管理者認証ではなく /master・/reports と同じアプリ本体のログイン認証で
    # 保護する(帳票レイアウトと同じ扱い。ADMIN_TOKEN 未設定なら認証なし)。
    skip_before_action :authorize_admin!
    skip_before_action :verify_admin_csrf!
    include UserAuthentication
    before_action :authorize_user!
    before_action :verify_user_csrf!

    before_action :set_category, only: %i[update destroy]

    def index
      categories = QuestionnaireCategory.ordered
      render json: { total: categories.count, items: categories.map { |c| summary(c) } }
    end

    def create
      category = QuestionnaireCategory.new(category_params)
      # 並び順の指定が無ければ末尾に置く(カラムのデフォルトは 0 なので、
      # 値ではなくパラメータの有無で判断する)。
      category.display_order = next_display_order if params[:display_order].blank?
      if category.save
        render json: summary(category), status: :created
      else
        render json: { errors: category.errors.full_messages }, status: :unprocessable_content
      end
    end

    def update
      if @category.update(category_params)
        render json: summary(@category)
      else
        render json: { errors: @category.errors.full_messages }, status: :unprocessable_content
      end
    end

    # カテゴリを消しても Questionnaire 側の拡張は残る(上流のテンプレートを
    # まとめて書き換えないため)。選択プルダウンでは拡張に埋まった表示名で
    # 引き続きグループ化される。
    def destroy
      @category.destroy!
      head :no_content
    end

    private

    def set_category
      @category = QuestionnaireCategory.find(params[:id])
    end

    def category_params
      params.permit(:code, :name, :display_order)
    end

    def next_display_order
      (QuestionnaireCategory.maximum(:display_order) || 0) + 1
    end

    def summary(category)
      {
        id: category.id,
        code: category.code,
        name: category.name,
        display_order: category.display_order,
        updated_at: category.updated_at
      }
    end
  end
end
