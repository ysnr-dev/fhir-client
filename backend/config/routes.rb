Rails.application.routes.draw do
  scope "fhir", format: false do
    get "metadata", to: "fhir_proxy#relay", defaults: { fhir_path: "metadata" }
    # Transaction/batch Bundle は空パスへの POST として届く。catch-all の
    # "*fhir_path" は空文字にマッチしないため、専用ルートが必要。
    post "", to: "fhir_proxy#relay", defaults: { fhir_path: "" }
    match "*fhir_path", to: "fhir_proxy#relay", via: %i[get post put delete]
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
  end
end
