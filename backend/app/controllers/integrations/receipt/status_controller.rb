module Integrations
  module Receipt
    # 連携が使える状態かだけを返す。フロントはこれを見て連携UIの出し分けをする。
    class StatusController < BaseController
      skip_before_action :require_receipt_enabled!

      def show
        config = receipt_config
        render json: {
          enabled: config.usable?,
          system_type: config.system_type,
          base_url: config.base_url
        }
      end
    end
  end
end
