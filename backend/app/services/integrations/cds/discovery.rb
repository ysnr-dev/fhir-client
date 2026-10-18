module Integrations
  module Cds
    # 提供元ごとの discovery(GET /cds-services)。カルテを開くたびに読むので、
    # プロセス内に短時間だけ持つ(ExternalSystemConnection と同じ考え方)。
    class Discovery
      CACHE_TTL = 5.minutes

      @cache = {}
      @mutex = Mutex.new

      class << self
        # Returns the provider's services. fresh: true bypasses the cache (admin の「探索」)。
        def services(provider, fresh: false)
          key = [provider.id, provider.base_url]
          unless fresh
            cached = @mutex.synchronize { @cache[key] }
            return cached[:services] if cached && cached[:at] > CACHE_TTL.ago
          end

          services = Client.new(provider).discover
          @mutex.synchronize { @cache[key] = { services: services, at: Time.current } }
          services
        end

        def reset!
          @mutex.synchronize { @cache = {} }
        end
      end
    end
  end
end
