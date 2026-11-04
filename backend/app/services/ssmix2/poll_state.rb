module Ssmix2
  # エージェントが最後に取りに来た時刻。状態表示に出すだけなので、プロセス内に持つ。
  module PollState
    @mutex = Mutex.new
    @last_polled_at = nil

    class << self
      def touch!
        @mutex.synchronize { @last_polled_at = Time.current }
      end

      def last_polled_at
        @mutex.synchronize { @last_polled_at }
      end
    end
  end
end
