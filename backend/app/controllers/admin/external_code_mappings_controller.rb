module Admin
  # カルテのコード ↔ 外部システムのコードの対応表。
  #
  # どの種別を持つか・対応が無いときどうなるかはアダプタが宣言する。
  # 表は製品のコード体系に対する対応なので、製品(system_type)で引く。
  class ExternalCodeMappingsController < BaseController
    before_action :set_definition

    def show
      render json: { items: mappings.order(:kind, :local_key), kinds: code_kinds }
    end

    # 画面はまとめて編集するので、種別ごとに丸ごと置き換える。
    # 部分更新にすると「消したのに残る」が起きやすい。
    def update
      kind = params.require(:kind)
      unless code_kinds.any? { |k| k[:key] == kind }
        return render json: { error: "unknown_kind" }, status: :unprocessable_content
      end

      rows = Array(params[:items]).map do |item|
        item.permit(:local_key, :external_code, :label).to_h
      end.select { |item| item["local_key"].present? && item["external_code"].present? }

      ExternalCodeMapping.transaction do
        mappings.where(kind: kind).delete_all
        rows.each { |row| ExternalCodeMapping.create!(row.merge("system_type" => system_type, "kind" => kind)) }
      end

      render json: { items: mappings.where(kind: kind).order(:local_key) }
    end

    # 対応先の候補。外部システム側のマスタをそのまま返す。
    def candidates
      kind = params.require(:kind)
      render json: { items: adapter.code_candidates(kind) }
    rescue Integrations::NotConfigured => e
      render json: { error: e.message }, status: :service_unavailable
    rescue Integrations::Rejected => e
      render json: { error: e.message }, status: :bad_gateway
    rescue Faraday::ConnectionFailed, Faraday::TimeoutError => e
      render json: { error: "外部システムに接続できませんでした (#{e.class})" }, status: :bad_gateway
    end

    private

    def system_key = params[:external_system_key].to_s

    def set_definition
      @definition = Integrations::ExternalSystems.find!(system_key)
      return if @definition.section?(:code_mappings)

      render json: { error: "not_supported" }, status: :unprocessable_content
    end

    # config は ActionController 自身が持つので別名にする。
    def connection = @connection ||= ExternalSystemConnection.effective(system_key)

    def system_type = connection.system_type.to_s

    def adapter
      klass = @definition.adapter_class(system_type)
      raise Integrations::NotConfigured, "対応していない製品です: #{system_type}" if klass.nil?

      klass.new(connection)
    end

    def mappings = ExternalCodeMapping.where(system_type: system_type)

    def code_kinds = @definition.code_kinds(system_type)
  end
end
