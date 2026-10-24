module Admin
  # 文書テンプレートの CRUD。上流中継ではなく backend DB に保存する。
  # 本体(Word / Excel のファイル、様式のページ画像)は base64 にして JSON ボディで受ける
  # (帳票レイアウトと同じく multipart を使わない)。
  class DocumentTemplatesController < BaseController
    # テンプレートの一覧と本体はカルテの「文書作成」(診療画面)からも読むため、
    # 管理者認証ではなく /master・/reports と同じアプリ本体のログイン認証で
    # 保護する(帳票レイアウトと同じ扱い。ADMIN_TOKEN 未設定なら認証なし)。
    skip_before_action :authorize_admin!
    skip_before_action :verify_admin_csrf!
    include UserAuthentication
    before_action :authorize_user!
    before_action :verify_user_csrf!

    before_action :set_template, only: %i[update destroy file page]

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
      template.code = params[:code].to_s if template.form? && params[:code].present?
      replace_pages(template) if params.key?(:pages)
      # 並び順の指定が無ければ末尾に置く(カラムのデフォルトは 0 なので、
      # 値ではなくパラメータの有無で判断する)。
      template.display_order = next_display_order if params[:display_order].blank?
      if template.save
        render json: summary(template), status: :created
      else
        render json: { errors: template.errors.full_messages }, status: :unprocessable_content
      end
    end

    # file_data / pages を送らなければ本体は差し替えない(名称やカテゴリ、配置だけの変更)。
    def update
      @template.assign_attributes(template_params)
      replace_pages(@template) if params.key?(:pages)
      if @template.save
        render json: summary(@template)
      else
        render json: { errors: @template.errors.full_messages }, status: :unprocessable_content
      end
    end

    # 削除しても、作成済みの文書(上流の DocumentReference と Binary、QuestionnaireResponse)は残る。
    def destroy
      @template.destroy!
      head :no_content
    end

    def file
      return head :not_found unless @template.office?

      send_data @template.data,
                filename: @template.file_name,
                type: @template.content_type,
                disposition: "attachment"
    end

    # 様式のページ画像。差し替えると URL(updated_at)が変わるので長くキャッシュさせてよい。
    def page
      page = @template.pages.find_by(page_number: params[:number])
      return head :not_found unless page

      expires_in 1.year, public: false
      send_data page.data, type: page.content_type, disposition: "inline"
    end

    private

    def set_template
      @template = DocumentTemplate.find(params[:id])
    end

    # 本体のパラメータ名を file_data にしているのは、ログのフィルタ(:file)に
    # かけて base64 を書き出さないため。layout は jsonb のネストなので丸ごと受け取る
    # (形の検証はモデルの layout_shape が担う)。
    def template_params
      permitted = params.permit(:name, :file_category_id, :file_name, :display_order, :active,
                                :kind, :content_type, :questionnaire_url, :questionnaire_version)
      if params[:file_data].present?
        permitted[:data] = Base64.decode64(params[:file_data].to_s)
      end
      if params.key?(:layout)
        raw = params[:layout]
        permitted[:layout] = raw.respond_to?(:to_unsafe_h) ? raw.to_unsafe_h : raw
      end
      permitted
    end

    # ページ画像を丸ごと置き換える。保存はモデル側の transaction(has_many autosave)で
    # 本体と一緒に行われるので、検証に失敗すれば旧ページも残る。
    def replace_pages(template)
      raw = params[:pages]
      raw = raw.respond_to?(:to_unsafe_h) ? raw.to_unsafe_h.values : raw
      items = raw.is_a?(Array) ? raw : []
      template.pages.each(&:mark_for_destruction)
      items.each do |item|
        attrs = item.respond_to?(:to_unsafe_h) ? item.to_unsafe_h : item.to_h
        template.pages.build(
          page_number: attrs["page_number"],
          content_type: attrs["content_type"],
          data: Base64.decode64(attrs["data"].to_s),
          width_px: attrs["width_px"],
          height_px: attrs["height_px"],
          width_pt: attrs["width_pt"],
          height_pt: attrs["height_pt"]
        )
      end
    end

    def next_display_order
      (DocumentTemplate.maximum(:display_order) || 0) + 1
    end

    def summary(template)
      {
        id: template.id,
        code: template.code,
        kind: template.kind,
        name: template.name,
        file_category_id: template.file_category_id,
        file_category_code: template.file_category&.code,
        file_category_name: template.file_category&.name,
        file_name: template.file_name,
        content_type: template.content_type,
        byte_size: template.byte_size,
        display_order: template.display_order,
        active: template.active,
        layout: template.form? ? template.layout : nil,
        questionnaire_url: template.questionnaire_url,
        questionnaire_version: template.questionnaire_version,
        pages: template.form? ? page_summaries(template) : [],
        updated_at: template.updated_at
      }
    end

    def page_summaries(template)
      template.pages.without_data.ordered.map do |page|
        {
          page_number: page.page_number,
          content_type: page.content_type,
          byte_size: page.byte_size,
          width_px: page.width_px,
          height_px: page.height_px,
          width_pt: page.width_pt.to_f,
          height_pt: page.height_pt.to_f
        }
      end
    end
  end
end
