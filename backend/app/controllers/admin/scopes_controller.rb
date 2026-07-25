module Admin
  # 上流 FHIR サーバーのスコープ選択肢(/admin/scopes)への中継。
  # 対応リソース型と日本語ラベルは上流が持っている(こちらに写すとずれる)。
  class ScopesController < BaseController
    include UpstreamAdminRelay

    def show
      relay(:get, "/admin/scopes")
    end
  end
end
