module Admin
  # 文書テンプレート(Word / Excel の様式ファイル)の CRUD。上流中継ではなく backend DB に保存する。
  # 本体は base64 にして JSON ボディで受ける(帳票レイアウトと同じく multipart を使わない)。
  class DocumentTemplatesController < BaseController
    # テンプレートの一覧と本体はカルテの「文書作成」(診療画面)からも読むため、
    # 管理者認証ではなく /master・/reports と同じアプリ本体のログイン認証で
    # 保護する(帳票レイアウトと同じ扱い。ADMIN_TOKEN 未設定なら認証なし)。
    skip_before_action :authorize_admin!
    skip_before_action :verify_admin_csrf!
    include UserAuthentication
    before_action :authorize_user!
    before_action :verify_user_csrf!

    before_action :set_template, only: %i[update destroy file]

    # ?active=true で有効なものだけに絞る(文書作成の選択肢)。
    def index
      templates = DocumentTemplate.without_data.includes(:file_category).ordered
      templates = templates.where(active: true) if params[:active] == "true"
      items = templates.to_a
      render json: { total: items.size, items: items.map { |t| summary(t) } }
    end

    def show
      render json: summary(DocumentTemplate.without_data.find(params[:id]))
    end

    def create
      template = DocumentTemplate.new(template_params)
      # 並び順の指定が無ければ末尾に置く(カラムのデフォルトは 0 なので、
      # 値ではなくパラメータの有無で判断する)。
      template.display_order = next_display_order if params[:display_order].blank?
      if template.save
        render json: summary(template), status: :created
      else
        render json: { errors: template.errors.full_messages }, status: :unprocessable_content
      end
    end

    # file_data を送らなければ本体は差し替えない(名称やカテゴリだけの変更)。
    def update
      if @template.update(template_params)
        render json: summary(@template)
      else
        render json: { errors: @template.errors.full_messages }, status: :unprocessable_content
      end
    end

    # 削除しても、作成済みの文書(上流の DocumentReference と Binary)は残る。
    def destroy
      @template.destroy!
      head :no_content
    end

    def file
      send_data @template.data,
                filename: @template.file_name,
                type: @template.content_type,
                disposition: "attachment"
    end

    private

    def set_template
      @template = DocumentTemplate.find(params[:id])
    end

    # 本体のパラメータ名を file_data にしているのは、ログのフィルタ(:file)に
    # かけて base64 を書き出さないため。
    def template_params
      permitted = params.permit(:name, :file_category_id, :file_name, :display_order, :active)
      if params[:file_data].present?
        permitted[:data] = Base64.decode64(params[:file_data].to_s)
      end
      permitted
    end

    def next_display_order
      (DocumentTemplate.maximum(:display_order) || 0) + 1
    end

    def summary(template)
      {
        id: template.id,
        code: template.code,
        name: template.name,
        file_category_id: template.file_category_id,
        file_category_code: template.file_category&.code,
        file_category_name: template.file_category&.name,
        file_name: template.file_name,
        content_type: template.content_type,
        byte_size: template.byte_size,
        display_order: template.display_order,
        active: template.active,
        updated_at: template.updated_at
      }
    end
  end
end
