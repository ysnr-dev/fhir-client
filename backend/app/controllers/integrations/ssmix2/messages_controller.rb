module Integrations
  module Ssmix2
    # エージェントのポーリング。index で未処理の transaction をメッセージに起こして渡し、ack で結果を受ける。
    class MessagesController < BaseController
      MAX_LIMIT = 100

      def index
        ::Ssmix2::PollState.touch!
        return render json: { enabled: false, messages: [] } unless ::Ssmix2::Settings.enabled?

        materialize
        messages = lease(limit)
        render json: {
          enabled: true,
          storage: { root_path: ::Ssmix2::Settings.root_path, facility_id: ::Ssmix2::Settings.facility_id },
          messages: messages.map { |message| message_json(message) }
        }
      end

      def ack
        written_ids = Array(params[:written]).map(&:to_i)
        failed = Array(params[:failed]).map { |f| f.respond_to?(:permit) ? f.permit(:id, :error).to_h : f.to_h }
        now = Time.current
        Ssmix2Message.where(id: written_ids).update_all(status: "written", written_at: now, leased_at: nil, error: nil)
        failed.each do |entry|
          message = Ssmix2Message.find_by(id: entry["id"].to_i)
          next if message.nil?

          attempts = message.attempts + 1
          message.update!(status: attempts >= Ssmix2Message::MAX_ATTEMPTS ? "failed" : "pending", attempts: attempts,
                          leased_at: nil, error: entry["error"].to_s.first(1000))
        end
        head :no_content
      end

      private

      def limit
        requested = params[:limit].to_i
        requested.positive? ? [requested, MAX_LIMIT].min : 20
      end

      def materialize
        ::Ssmix2::Materializer.new.run
        purge
      rescue StandardError => e
        # 組み立てが落ちても、既に起こしたメッセージは渡す。
        Rails.logger.error("[ssmix2] 組み立てに失敗しました: #{e.class}: #{e.message}")
      end

      # 1 日 1 回だけ古い行を消す。
      def purge
        return if @purged_today == Date.current

        Ssmix2Message.purge_written!
        Ssmix2Transaction.purge_processed!
        @purged_today = Date.current
      end

      def lease(count)
        Ssmix2Message.release_stale!
        Ssmix2Message.transaction do
          ids = Ssmix2Message.pending.order(:id).limit(count).lock("FOR UPDATE SKIP LOCKED").pluck(:id)
          Ssmix2Message.where(id: ids).update_all(status: "leased", leased_at: Time.current)
          Ssmix2Message.where(id: ids).order(:id).to_a
        end
      end

      def message_json(message)
        {
          id: message.id,
          patient_id: message.patient_id,
          service_date: message.service_date,
          data_kind: message.data_kind,
          order_no: message.order_no,
          process: message.process,
          department_code: message.department_code,
          transaction_at: message.transaction_at,
          body_base64: Base64.strict_encode64(message.body)
        }
      end
    end
  end
end
