module Integrations
  module Cds
    # hook 1 回ぶんの呼び出し全体(docs/cds-hooks-design.md §1)。
    #
    # 有効な提供元ごとに discovery を読み、その hook のサービスに prefetch を添えて呼び、
    # カードをまとめる。提供元 1 つの失敗はその提供元のカードが無いだけで、全体は失敗しない
    # (判断支援の不調で診療を止めない)。
    #
    # context は hook ごとに違う: patient-view は userId・patientId・encounterId、
    # order-select はそれに selections と draftOrders、order-sign は draftOrders が加わる。
    class Invocation
      HOOKS = %w[patient-view order-select order-sign].freeze

      Result = Struct.new(:cards, :services, keyword_init: true)

      def initialize(hook:, providers: CdsService.enabled.ordered.to_a, smart_apps: SmartApp.enabled.to_a,
                     fhir_server: FhirConnectionSettings.effective.public_base_url)
        raise ArgumentError, "unknown hook: #{hook}" unless HOOKS.include?(hook)

        @hook = hook
        @providers = providers
        @smart_apps = smart_apps
        @fhir_server = fhir_server.to_s.chomp("/")
      end

      # extra_context: hook 固有の context(selections / draftOrders)。
      def call(patient_id:, practitioner_id:, encounter_id: nil, extra_context: {})
        context = {
          "userId" => "Practitioner/#{practitioner_id}",
          "patientId" => patient_id,
          "encounterId" => encounter_id.presence
        }.compact.merge(extra_context)

        # prefetch は上流(施設トークン)を読むので主スレッドで済ませ、提供元への送信だけ並列にする。
        calls = providers.flat_map { |provider| prepare(provider, context) }
        threads = calls.map { |call| Thread.new { call[:cards] = invoke(call) } }
        threads.each(&:join)

        Result.new(
          cards: calls.flat_map { |call| call[:cards] || [] },
          services: providers.map { |provider| status_of(provider, calls) }
        )
      end

      private

      attr_reader :hook, :providers, :smart_apps, :fhir_server

      # 提供元のその hook のサービスごとに、送るリクエストを組み立てる。
      def prepare(provider, context)
        services = Discovery.services(provider).select { |service| service["hook"] == hook }
        services.map do |service|
          prefetch = Prefetch.new(context).resolve(service["prefetch"])
          body = {
            "hookInstance" => SecureRandom.uuid,
            "fhirServer" => fhir_server,
            "hook" => hook,
            "context" => context,
            "prefetch" => prefetch
          }
          { provider: provider, service_id: service["id"], body: body, error: nil }
        end
      rescue Integrations::Error => e
        [{ provider: provider, service_id: nil, body: nil, error: e.message }]
      end

      def invoke(call)
        return [] if call[:body].nil?

        response = Client.new(call[:provider]).invoke(call[:service_id], call[:body])
        Cards.normalize(response, provider: call[:provider], service_id: call[:service_id], smart_apps: smart_apps)
      rescue Integrations::Error => e
        call[:error] = e.message
        []
      end

      def status_of(provider, calls)
        own = calls.select { |call| call[:provider].id == provider.id }
        failed = own.find { |call| call[:error] }
        {
          id: provider.id,
          name: provider.name,
          status: failed ? "failed" : "ok",
          error: failed&.dig(:error),
          services: own.count { |call| call[:service_id] }
        }.compact
      end
    end
  end
end
