module Reports
  # 様式テンプレートの表示用 PDF。画面が整形した値を受け取り、ページ画像の上に描いて返す。
  # 上流へはアクセスしない(保存は画面が Binary + DocumentReference として行う)。
  class DocumentFormPdfsController < BaseController
    class NotFormTemplate < StandardError; end

    rescue_from ActiveRecord::RecordNotFound do
      render json: { error: "template_not_found" }, status: :not_found
    end

    rescue_from NotFormTemplate do
      render json: { error: "not_form_template" }, status: :unprocessable_content
    end

    rescue_from DocumentFormRenderer::InvalidRequest do |error|
      render json: { error: error.message }, status: :unprocessable_content
    end

    # POST /reports/document_forms/:template_id/pdf  { fields: [{ link_id, text, image }, ...] }
    # image は画像項目の data URL(PNG / JPEG)。
    def create
      template = DocumentTemplate.without_data.find(params[:template_id])
      raise NotFormTemplate unless template.form?

      pdf = DocumentFormRenderer.new(template: template, values: values_param).render
      send_data pdf,
                filename: "#{template.name}.pdf",
                type: "application/pdf",
                disposition: "inline"
    end

    private

    def values_param
      raw = params[:fields]
      raw = raw.respond_to?(:to_unsafe_h) ? raw.to_unsafe_h.values : raw
      return {} unless raw.is_a?(Array)

      raw.each_with_object({}) do |item, acc|
        attrs = item.respond_to?(:to_unsafe_h) ? item.to_unsafe_h : item.to_h
        id = attrs["link_id"]
        next unless id.is_a?(String)

        acc[id] = { "text" => attrs["text"].to_s, "image" => attrs["image"].presence }
      end
    end
  end
end
