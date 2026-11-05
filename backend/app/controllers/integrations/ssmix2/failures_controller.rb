module Integrations
  module Ssmix2
    # 出力に失敗した行の一覧と、再実行・破棄(施設設定から開く「SS-MIX2 出力の確認」画面)。
    # 組み立ての失敗は transaction、エージェントが書けなかった失敗はメッセージに残っている。
    class FailuresController < ActionController::API
      include UserAuthentication

      LIMIT = 200

      before_action :authorize_user!
      before_action :verify_user_csrf!

      def index
        transactions = Ssmix2Transaction.where(status: "failed").order(processed_at: :desc, id: :desc).limit(LIMIT)
        messages = Ssmix2Message.where(status: "failed").order(updated_at: :desc, id: :desc).limit(LIMIT)
        render json: {
          transactions: transactions.map { |t| transaction_json(t) },
          messages: messages.map { |m| m.summary_json }
        }
      end

      def rerun
        render json: {
          transactions: Ssmix2Transaction.retry!(transaction_ids),
          messages: Ssmix2Message.retry!(message_ids)
        }
      end

      def discard
        render json: {
          transactions: Ssmix2Transaction.discard!(transaction_ids),
          messages: Ssmix2Message.discard!(message_ids)
        }
      end

      private

      def transaction_ids = Array(params[:transaction_ids]).map(&:to_i)

      def message_ids = Array(params[:message_ids]).map(&:to_i)

      def transaction_json(transaction)
        {
          id: transaction.id,
          occurred_at: transaction.occurred_at,
          failed_at: transaction.processed_at,
          method: transaction.method,
          path: transaction.path,
          resource_types: transaction.resource_types,
          attempts: transaction.attempts,
          error: transaction.error
        }
      end
    end
  end
end
