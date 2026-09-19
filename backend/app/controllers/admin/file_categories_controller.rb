module Admin
  # ファイルカテゴリの CRUD。上流中継ではなく backend DB に保存する。
  class FileCategoriesController < BaseController
    # カテゴリ一覧はカルテの「ファイル」タブ(診療画面)からも読むため、
    # 管理者認証ではなく /master・/reports と同じアプリ本体のログイン認証で
    # 保護する(テンプレートカテゴリと同じ扱い。ADMIN_TOKEN 未設定なら認証なし)。
    skip_before_action :authorize_admin!
    skip_before_action :verify_admin_csrf!
    include UserAuthentication
    before_action :authorize_user!
    before_action :verify_user_csrf!

    before_action :set_category, only: %i[update destroy]

    def index
      categories = FileCategory.ordered
      render json: { total: categories.count, items: categories.map { |c| summary(c) } }
    end

    def create
      category = FileCategory.new(category_params)
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

    # カテゴリを消しても DocumentReference.category は残る(上流のファイルを
    # まとめて書き換えないため)。一覧では coding.display に焼き込んだ表示名で
    # 引き続き同じ名前のまま表示される。
    def destroy
      @category.destroy!
      head :no_content
    end

    private

    def set_category
      @category = FileCategory.find(params[:id])
    end

    def category_params
      params.permit(:code, :name, :display_order)
    end

    def next_display_order
      (FileCategory.maximum(:display_order) || 0) + 1
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
