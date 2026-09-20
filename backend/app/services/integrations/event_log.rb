module Integrations
  # 外部システム連携の記録。1 行 1 イベントの JSON Lines。
  #
  # 送信履歴をテーブルに持つと、そのテーブルが状態(患者番号・送信済み判定)の置き場に
  # なって連携先と二重管理になる。記録は記録に徹してログに出し、状態は常に
  # カルテ本体(上流 FHIR)と連携先から引く。
  class EventLog
    @loggers = {}
    @mutex = Mutex.new

    class << self
      def for(system_key)
        @mutex.synchronize { @loggers[system_key] ||= new(system_key) }
      end

      def reset!
        @mutex.synchronize { @loggers = {} }
      end
    end

    def initialize(system_key)
      @system_key = system_key
      @logger = build_logger
    end

    # direction は :in(外部 → カルテ)か :out(カルテ → 外部)。
    def write(direction:, action:, outcome:, **fields)
      entry = {
        ts: Time.current.iso8601(3),
        system: system_key,
        direction: direction.to_s,
        action: action.to_s,
        outcome: outcome.to_s
      }.merge(fields.compact)

      logger.info(entry.to_json)
      entry
    end

    # 電文そのものは患者氏名・保険情報を含むので、既定では残さない。
    def self.bodies?
      ENV["INTEGRATION_LOG_BODIES"] == "true"
    end

    private

    attr_reader :system_key, :logger

    def build_logger
      formatter = ->(_severity, _time, _progname, msg) { "#{msg}\n" }

      if log_to_stdout?
        logger = ActiveSupport::Logger.new($stdout)
        logger.formatter = ->(_s, _t, _p, msg) { "[integrations.#{system_key}] #{msg}\n" }
        return logger
      end

      path = Rails.root.join("log", "integrations")
      FileUtils.mkdir_p(path)
      logger = ActiveSupport::Logger.new(path.join("#{system_key}.log"), 10, 10.megabytes)
      logger.formatter = formatter
      logger
    end

    def log_to_stdout?
      ENV["RAILS_LOG_TO_STDOUT"].present? || Rails.env.production?
    end
  end
end
