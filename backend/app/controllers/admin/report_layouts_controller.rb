module Admin
  # 帳票レイアウト(.tlf)の CRUD。上流中継ではなく backend DB に保存する。
  # tlf は JSON テキストなので multipart ではなく JSON ボディで受ける
  # (SPA 側は FileReader で読んだ文字列をそのまま送る)。
  class ReportLayoutsController < BaseController
    # 帳票レイアウトの登録・差し替えは日常運用で行うため、ADMIN_TOKEN を設定した
    # 環境でも管理者認証を要求しない。CSRF 検査はセッション認証時のみ意味を持つ
    # ガードなので、認証を外すのに合わせてスキップする。
    skip_before_action :authorize_admin!
    skip_before_action :verify_admin_csrf!

    before_action :set_layout, only: %i[show update destroy]

    # ?canonical=url|version で単一テンプレート分に絞り込める(エクスポート・
    # インポートが全件取得 → find せずに済むように)。
    def index
      layouts = ReportLayout.order(:name, :id)
      layouts = layouts.with_canonical(params[:canonical]) if params[:canonical].present?
      render json: {
        total: layouts.count,
        items: layouts.map { |layout| layout_summary(layout) }
      }
    end

    # tlf・mapping 本文は一覧では返さず、再ダウンロード用に show でのみ返す。
    def show
      render json: layout_summary(@layout).merge(tlf: @layout.tlf, mapping: @layout.mapping)
    end

    def create
      layout = ReportLayout.new(layout_params)
      if layout.save
        render json: layout_summary(layout), status: :created
      else
        render json: { errors: layout.errors.full_messages }, status: :unprocessable_content
      end
    end

    def update
      if @layout.update(layout_params)
        render json: layout_summary(@layout)
      else
        render json: { errors: @layout.errors.full_messages }, status: :unprocessable_content
      end
    end

    def destroy
      @layout.destroy!
      head :no_content
    end

    private

    def set_layout
      @layout = ReportLayout.find(params[:id])
    end

    def layout_params
      params.permit(:name, :questionnaire_url, :questionnaire_version, :tlf, :mapping)
    end

    def layout_summary(layout)
      {
        id: layout.id,
        name: layout.name,
        questionnaire_url: layout.questionnaire_url,
        questionnaire_version: layout.questionnaire_version,
        canonical: layout.canonical,
        tlf_bytesize: layout.tlf.bytesize,
        mapping_set: layout.mapping.present?,
        updated_at: layout.updated_at
      }
    end
  end
end
