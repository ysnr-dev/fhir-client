Rails.application.routes.draw do
  # ホスティング環境(Render 等)のヘルスチェック用。DB 到達性は見ない軽量応答。
  get "up" => "rails/health#show", as: :rails_health_check

  # 画面から明示的にサーバーを起こすためのエンドポイント(backend + 上流の状態)。
  get "wakeup", to: "wakeup#show"

  scope "fhir", format: false do
    get "metadata", to: "fhir_proxy#relay", defaults: { fhir_path: "metadata" }
    # Transaction/batch Bundle は空パスへの POST として届く。catch-all の
    # "*fhir_path" は空文字にマッチしないため、専用ルートが必要。
    post "", to: "fhir_proxy#relay", defaults: { fhir_path: "" }
    match "*fhir_path", to: "fhir_proxy#relay", via: %i[get post put delete]
  end

  # 管理用: 上流 FHIR サーバーへの接続設定(SMART Backend Services)。
  # 単数リソース(単一行設定) + 接続テスト。
  namespace :admin do
    # 管理UIのログイン(ADMIN_TOKEN をパスフレーズにして HttpOnly セッションを張る)
    resource :session, only: %i[show create destroy]

    resource :fhir_connection_settings, only: %i[show update] do
      post :test, on: :collection
    end

    # 上流 FHIR サーバーの管理API(/admin/oauth_clients、/admin/scopes)への中継。
    # ブラウザから上流を直接叩けない(CORS無効)ため、ここでサーバー間中継する。
    resources :oauth_clients, only: %i[index create destroy]
    get "scopes", to: "scopes#show"

    # 帳票レイアウト(.tlf)の管理。Questionnaire の canonical と紐付けて保存する。
    resources :report_layouts, only: %i[index show create update destroy]
  end

  # 帳票出力(QuestionnaireResponse の PDF 化)。FHIR リソースではないため
  # /fhir とは別のプレーン JSON / PDF エンドポイント。
  namespace :reports do
    get "layouts", to: "layouts#show"
    get "questionnaire_responses/:id/pdf", to: "questionnaire_response_pdfs#show"
  end

  # 国内マスタデータ（FHIR リソースではないプレーンな JSON REST）
  namespace :master do
    resources :hot_codes, only: %i[index show create update destroy] do
      collection { post :import }
    end
    resources :medicines, only: %i[index show create update destroy] do
      collection { post :import }
    end
    resources :medicine_usages, only: %i[index show create update destroy] do
      collection do
        post :import
        get :categories
      end
    end
    resources :medicine_types, only: %i[index show create update destroy] do
      collection { get :options }
    end
    resources :lab_items, only: %i[index show create update destroy] do
      collection do
        post :import
        get :categories
      end
    end
    resources :diseases, only: %i[index show create update destroy] do
      collection { post :import }
    end
    resources :modifiers, only: %i[index show create update destroy] do
      collection { post :import }
    end
    # 索引テーブルは検索専用(取込で全件洗い替え)のため CRUD は持たない。
    resources :disease_indexes, only: %i[index] do
      collection { post :import }
    end
    # J-FAGYアレルゲンコードも検索専用(取込で全件洗い替え)のため CRUD は持たない。
    resources :jfagy_allergens, only: %i[index] do
      collection { post :import }
    end
  end
end
