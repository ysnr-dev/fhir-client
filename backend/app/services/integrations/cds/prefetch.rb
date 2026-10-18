module Integrations
  module Cds
    # サービスの prefetch テンプレートを施設トークンで解決する(docs/cds-hooks-design.md §2.3)。
    #
    # サービスには上流のトークンを渡さないので、ここで同梱した分だけがサービスの見える範囲になる。
    # 読めるのは画面の中継と同じ許可リストの型だけ。満たせないテンプレート(受診が無い・型が
    # 許可外・上流が 2xx 以外)は規格どおり key ごと省く。
    class Prefetch
      TEMPLATE = /\{\{\s*([A-Za-z.]+)\s*\}\}/
      DEFAULT_COUNT = 100

      def initialize(context, gateway: FhirGateway.new)
        @context = context
        @gateway = gateway
      end

      # templates: {"patient" => "Patient/{{context.patientId}}", ...}
      def resolve(templates)
        return {} unless templates.is_a?(Hash)

        templates.each_with_object({}) do |(key, template), prefetch|
          next unless key.is_a?(String) && template.is_a?(String)

          resource = fetch(template)
          prefetch[key] = resource if resource
        end
      end

      private

      attr_reader :context, :gateway

      def fetch(template)
        query_string = substitute(template)
        return nil unless query_string

        path, query = query_string.delete_prefix("/").split("?", 2)
        type = path.to_s.split("/").first
        return nil unless FhirProxyController::ALLOWED_RESOURCE_TYPES.include?(type)

        query = with_default_count(query) if path.exclude?("/")
        response = gateway.forward(method: :get, path: "/#{path}", query: query.presence)
        return nil unless response.status.between?(200, 299)

        JSON.parse(response.body)
      rescue JSON::ParserError, Faraday::ConnectionFailed, Faraday::TimeoutError
        nil
      end

      # 変数が埋まらないテンプレートは nil(省く)。
      def substitute(template)
        template.gsub(TEMPLATE) do
          value = context_value(Regexp.last_match(1))
          return nil if value.blank?

          CGI.escape(value)
        end
      end

      def context_value(name)
        case name
        when "context.patientId" then context["patientId"]
        when "context.userId" then context["userId"]
        when "context.encounterId" then context["encounterId"]
        end
      end

      def with_default_count(query)
        params = Rack::Utils.parse_query(query.to_s)
        params["_count"] = DEFAULT_COUNT.to_s unless params.key?("_count")
        Rack::Utils.build_query(params)
      end
    end
  end
end
