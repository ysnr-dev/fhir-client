module Integrations
  module Cds
    # サービスの応答を画面が使う形に写す(docs/cds-hooks-design.md §2.4)。
    #
    # 外部の応答をそのまま描かない: 必須項目の欠けを埋め、指標とリンクの種別を絞り、
    # 余分な項目を落とす。smart リンクは登録済みのアプリに当てはまるものだけ起動できる。
    module Cards
      INDICATORS = %w[info warning critical].freeze
      SUMMARY_MAX = 140
      APP_CONTEXT_MAX_BYTES = 8 * 1024

      module_function

      # response: hook の応答。provider: CdsService。service_id: discovery の id。
      def normalize(response, provider:, service_id:, smart_apps:)
        Array(response["cards"]).filter_map do |card|
          next unless card.is_a?(Hash) && card["summary"].is_a?(String) && card["summary"].present?

          {
            uuid: card["uuid"].presence || SecureRandom.uuid,
            summary: card["summary"].strip.truncate(SUMMARY_MAX),
            detail: card["detail"].is_a?(String) ? card["detail"] : nil,
            indicator: INDICATORS.include?(card["indicator"]) ? card["indicator"] : "info",
            source: source(card["source"], provider),
            links: links(card["links"], smart_apps),
            suggestions: suggestions(card["suggestions"]),
            override_reasons: override_reasons(card["overrideReasons"]),
            service: { id: provider.id, name: provider.name, service: service_id }
          }.compact
        end
      end

      def source(source, provider)
        source = {} unless source.is_a?(Hash)
        {
          label: source["label"].presence || provider.name,
          url: http_url(source["url"]),
          topic: source.dig("topic", "display").presence
        }.compact
      end

      def links(links, smart_apps)
        Array(links).filter_map do |link|
          next unless link.is_a?(Hash) && link["label"].is_a?(String) && link["url"].is_a?(String)

          case link["type"]
          when "absolute"
            url = http_url(link["url"])
            { label: link["label"], type: "absolute", url: url } if url
          when "smart"
            app = smart_apps.find { |candidate| same_launch_url?(candidate.launch_url, link["url"]) }
            context = link["appContext"]
            context = nil unless context.is_a?(String) && context.bytesize <= APP_CONTEXT_MAX_BYTES
            { label: link["label"], type: "smart", url: link["url"], smart_app_id: app&.id, app_context: context }
          end
        end
      end

      def suggestions(suggestions)
        Array(suggestions).filter_map do |suggestion|
          next unless suggestion.is_a?(Hash) && suggestion["label"].is_a?(String)

          actions = Array(suggestion["actions"]).filter_map do |action|
            action["description"] if action.is_a?(Hash) && action["description"].is_a?(String)
          end
          { label: suggestion["label"], actions: actions }
        end
      end

      def override_reasons(reasons)
        Array(reasons).filter_map do |reason|
          next unless reason.is_a?(Hash) && reason["code"].is_a?(String)

          { code: reason["code"], system: reason["system"].presence, display: reason["display"].presence || reason["code"] }
        end
      end

      def http_url(value)
        return nil unless value.is_a?(String)

        uri = URI.parse(value)
        uri.absolute? && %w[http https].include?(uri.scheme) ? value : nil
      rescue URI::InvalidURIError
        nil
      end

      # 登録済みアプリの起動 URL と、クエリを除いて同じか。
      def same_launch_url?(registered, requested)
        strip = lambda do |value|
          uri = URI.parse(value)
          uri.query = nil
          uri.fragment = nil
          uri.to_s.chomp("/")
        end
        strip.call(registered) == strip.call(requested)
      rescue URI::InvalidURIError
        false
      end
    end
  end
end
