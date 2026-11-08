module Admin
  # 表示名と並び順だけを持つカテゴリ(ファイル・テンプレート)の CRUD。モデルは category_class で渡す。
  # カテゴリ一覧は診療画面(カルテの「ファイル」タブ・テンプレート選択プルダウン)からも読むため、
  # 管理者認証ではなく /master・/reports と同じアプリ本体のログイン認証で保護する
  # (帳票レイアウトと同じ扱い。ADMIN_TOKEN 未設定なら認証なし)。
  module CategoryRecords
    extend ActiveSupport::Concern

    included do
      skip_before_action :authorize_admin!
      skip_before_action :verify_admin_csrf!
      include UserAuthentication
      before_action :authorize_user!
      before_action :verify_user_csrf!

      before_action :set_category, only: %i[update destroy]
    end

    def index
      categories = category_class.ordered
      render json: { total: categories.count, items: categories.map { |c| summary(c) } }
    end

    def create
      category = category_class.new(category_params)
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

    # カテゴリを消しても、上流のリソースに書いた分類(code と表示名)は残す(上流をまとめて
    # 書き換えないため)。何が残るかはコントローラのコメントに。
    def destroy
      @category.destroy!
      head :no_content
    end

    private

    def set_category
      @category = category_class.find(params[:id])
    end

    def category_params
      params.permit(:code, :name, :display_order)
    end

    def next_display_order
      (category_class.maximum(:display_order) || 0) + 1
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
