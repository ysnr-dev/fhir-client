require "faraday"

module Integrations
  module Cds
    # CDS Hooks のサービス提供元 1 つとの HTTP。discovery・hook の呼び出し・feedback。
    #
    # 判断支援は診療の動線の上で待たれるので、短い制限時間で 1 回だけ呼び、再送しない
    # (遅いサービスは「カード無し」になるだけ)。失敗は Integrations::Error に寄せる。
    class Client
      DISCOVERY_PATH = "/cds-services".freeze
      OPEN_TIMEOUT = 2
      TIMEOUT = 10

      def initialize(provider)
        @provider = provider
      end

      # Returns the `services` array of the discovery document.
      def discover
        body = request(:get, DISCOVERY_PATH, action: "discover")
        services = body["services"]
        raise Rejected, "discovery に services がありません" unless services.is_a?(Array)

        services.select { |service| service.is_a?(Hash) && service["id"].present? }
      end

      # Returns the parsed hook response ({"cards" => [...]}).
      def invoke(service_id, body)
        request(:post, "#{DISCOVERY_PATH}/#{service_id}", body: body, action: body["hook"], service: service_id)
      end

      def feedback(service_id, body)
        request(:post, "#{DISCOVERY_PATH}/#{service_id}/feedback", body: body, action: "feedback", service: service_id)
        true
      end

      private

      attr_reader :provider

      def request(method, path, action:, body: nil, service: nil)
        started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        response = connection.run_request(method, path, body&.to_json, headers)
        elapsed_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round
        parsed = parse(response)
        log(action, service, outcome: response.success? ? "succeeded" : "failed", status: response.status,
                             elapsed_ms: elapsed_ms, request: body, response: parsed)
        raise Rejected, "#{provider.name} が HTTP #{response.status} を返しました" unless response.success?
        raise Rejected, "#{provider.name} の応答が JSON ではありません" if parsed.nil?

        parsed
      rescue Faraday::ConnectionFailed, Faraday::TimeoutError => e
        log(action, service, outcome: "failed", error: e.class.name)
        raise Unreachable, "#{provider.name} に接続できませんでした (#{e.class})"
      end

      def parse(response)
        body = response.body.to_s
        return {} if body.blank?

        parsed = JSON.parse(body)
        parsed.is_a?(Hash) ? parsed : nil
      rescue JSON::ParserError
        nil
      end

      def headers
        headers = { "Content-Type" => "application/json", "Accept" => "application/json" }
        headers["Authorization"] = "Bearer #{provider.auth_token}" if provider.auth_token.present?
        headers
      end

      def connection
        @connection ||= Faraday.new(url: provider.base_url) do |f|
          f.options.open_timeout = OPEN_TIMEOUT
          f.options.timeout = TIMEOUT
          f.adapter Faraday.default_adapter
        end
      end

      def log(action, service, outcome:, request: nil, response: nil, **fields)
        bodies = EventLog.bodies? ? { request: request, response: response } : {}
        EventLog.for("cds_hooks").write(
          direction: :out, action: action, outcome: outcome,
          provider: provider.name, service: service, **fields, **bodies
        )
      end
    end
  end
end
