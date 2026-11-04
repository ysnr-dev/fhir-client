module Ssmix2
  # 上流から読んだリソースの短命キャッシュ。同じ患者の transaction が続くときに患者・医師・病棟を
  # 読み直さないため(上流のレート制限は backend の 1 トークンで 300 件/分)。プロセス内に持ち、
  # 患者を書いた transaction は Materializer が書いた内容で上書きする。
  class ResourceCache
    TTL = 5.minutes
    MAX_ENTRIES = 2000

    class << self
      def shared = (@shared ||= new)
    end

    def initialize(ttl: TTL, max_entries: MAX_ENTRIES)
      @ttl = ttl
      @max_entries = max_entries
      @mutex = Mutex.new
      @entries = {}
    end

    def fetch(key)
      @mutex.synchronize do
        entry = @entries[key]
        return nil if entry.nil?
        return @entries.delete(key) && nil if entry[:at] < @ttl.ago

        entry[:value]
      end
    end

    def put(key, value)
      @mutex.synchronize do
        @entries.delete(key)
        @entries[key] = { value: value, at: Time.current }
        @entries.shift while @entries.size > @max_entries
      end
      value
    end

    def clear
      @mutex.synchronize { @entries.clear }
    end
  end
end
