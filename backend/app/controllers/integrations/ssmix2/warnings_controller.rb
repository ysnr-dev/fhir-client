module Integrations
  module Ssmix2
    # warning の付いたメッセージの一覧(「SS-MIX2 出力の確認」画面)。書き出しはできたが、診療科コードや HOT が
    # 引けずに一部を落としたもの。メッセージの保持期間(書けたものは 14 日)の分だけ見られる。
    class WarningsController < ActionController::API
      include UserAuthentication

      LIMIT = 200

      before_action :authorize_user!

      def index
        messages = Ssmix2Message.where("cardinality(warnings) > 0").order(created_at: :desc, id: :desc).limit(LIMIT + 1).to_a
        render json: {
          messages: messages.first(LIMIT).map { |m| m.summary_json },
          truncated: messages.size > LIMIT
        }
      end
    end
  end
end
