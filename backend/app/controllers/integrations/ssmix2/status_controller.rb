module Integrations
  module Ssmix2
    # 施設設定画面に出す出力の状態。ログイン認証(エージェント向けのトークンではない)。
    class StatusController < ActionController::API
      include UserAuthentication

      before_action :authorize_user!

      def show
        today = ::Ssmix2::Hl7::Stamp.now.beginning_of_day
        render json: {
          enabled: ::Ssmix2::Settings.enabled?,
          pending: Ssmix2Transaction.where(status: %w[pending building]).count + Ssmix2Message.where(status: %w[pending leased]).count,
          failed: Ssmix2Transaction.where(status: "failed").count + Ssmix2Message.where(status: "failed").count,
          written_today: Ssmix2Message.where(status: "written").where(written_at: today..).count,
          warnings_today: Ssmix2Message.where(created_at: today..).where("cardinality(warnings) > 0").count,
          last_written_at: Ssmix2Message.where(status: "written").maximum(:written_at),
          last_polled_at: ::Ssmix2::PollState.last_polled_at,
          recent_failures: recent_failures
        }
      end

      private

      def recent_failures
        transactions = Ssmix2Transaction.where(status: "failed").order(processed_at: :desc).limit(5).map do |t|
          { kind: "transaction", id: t.id, occurred_at: t.occurred_at, error: t.error }
        end
        messages = Ssmix2Message.where(status: "failed").order(updated_at: :desc).limit(5).map do |m|
          { kind: "message", id: m.id, occurred_at: m.created_at, data_kind: m.data_kind, patient_id: m.patient_id, error: m.error }
        end
        (transactions + messages).sort_by { |f| f[:occurred_at] }.reverse.first(5)
      end
    end
  end
end
