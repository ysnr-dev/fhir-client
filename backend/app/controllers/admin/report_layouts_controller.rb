module Admin
  # 帳票レイアウト(.tlf)の CRUD。上流中継ではなく backend DB に保存する。
  # tlf は JSON テキストなので multipart ではなく JSON ボディで受ける
  # (SPA 側は FileReader で読んだ文字列をそのまま送る)。
  class ReportLayoutsController < BaseController
    before_action :set_layout, only: %i[show update destroy]

    def index
      layouts = ReportLayout.order(:name, :id)
      render json: {
        total: layouts.count,
        items: layouts.map { |layout| layout_summary(layout) }
      }
    end

    # tlf 本文は一覧では返さず、再ダウンロード用に show でのみ返す。
    def show
      render json: layout_summary(@layout).merge(tlf: @layout.tlf)
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
      params.permit(:name, :questionnaire_url, :questionnaire_version, :tlf)
    end

    def layout_summary(layout)
      {
        id: layout.id,
        name: layout.name,
        questionnaire_url: layout.questionnaire_url,
        questionnaire_version: layout.questionnaire_version,
        canonical: layout.canonical,
        tlf_bytesize: layout.tlf.bytesize,
        updated_at: layout.updated_at
      }
    end
  end
end
