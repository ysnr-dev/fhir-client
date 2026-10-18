module Integrations
  module Cds
    # hook を呼ぶ直前に、提供元の委任クライアント向けの短命トークンを上流から発行する
    # (docs/cds-hooks-design.md §2.6)。応答はそのまま CDS Hooks の fhirAuthorization の形。
    #
    # 発行に失敗しても hook は呼ぶ(fhirAuthorization なしで prefetch だけ渡す)。トークンが
    # 無いことはサービスにとって「自分では読めない」だけで、判断支援そのものを止める理由にならない。
    class Authorization
      PATH = "/admin/delegated_tokens".freeze

      def initialize(gateway: FhirAdminGateway.new)
        @gateway = gateway
      end

      # Returns the fhirAuthorization hash, or nil when none could be issued.
      def issue(provider:, practitioner_id:, patient_id:)
        return nil if provider.client_id.blank?

        response = @gateway.request(:post, PATH, body: {
          client_id: provider.client_id, practitioner_id: practitioner_id, patient_id: patient_id
        }.to_json)
        unless response.status == 201
          log(provider, "failed", status: response.status)
          return nil
        end

        body = JSON.parse(response.body)
        log(provider, "succeeded", status: response.status)
        body.slice("access_token", "token_type", "expires_in", "scope", "subject", "patient")
      rescue FhirAdminGateway::NotConfigured, Faraday::ConnectionFailed, Faraday::TimeoutError, JSON::ParserError => e
        log(provider, "failed", error: e.class.name)
        nil
      end

      private

      def log(provider, outcome, **fields)
        EventLog.for("cds_hooks").write(direction: :out, action: "delegated-token", outcome: outcome,
                                        provider: provider.name, **fields)
      end
    end
  end
end
