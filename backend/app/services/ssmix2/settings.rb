module Ssmix2
  # 施設設定 ssmix2 の読み出し。中継の書き込みごとに DB を引かないよう、プロセス内に短く持つ
  # (ExternalSystemConnection のキャッシュと同じ流儀)。
  module Settings
    TTL = 30.seconds

    @mutex = Mutex.new
    @cached = nil
    @cached_at = nil

    class << self
      def current
        @mutex.synchronize do
          if @cached.nil? || @cached_at.nil? || @cached_at < TTL.ago
            @cached = FacilitySettings.ssmix2
            @cached_at = Time.current
          end
          @cached
        end
      end

      def enabled? = current["enabled"] == true

      def root_path = current["root_path"].to_s

      def facility_id = current["facility_id"].to_s

      def patient_id_digits = current["patient_id_digits"].to_i

      def sending_application = current["sending_application"].to_s

      def reset_cache!
        @mutex.synchronize do
          @cached = nil
          @cached_at = nil
        end
      end
    end
  end
end
