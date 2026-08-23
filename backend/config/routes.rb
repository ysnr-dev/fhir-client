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

  # アプリ本体のログイン(ID/パスワード)。医療従事者のログインアカウントは
  # 医療従事者登録ページから /auth/account で管理する。
  namespace :auth do
    resource :session, only: %i[show create destroy]
    resource :account, only: %i[show update destroy]
  end

  # 管理用: 上流 FHIR サーバーへの接続設定(SMART Backend Services)。
  # 単数リソース(単一行設定) + 接続テスト。
  namespace :admin do
    # 管理UIのログイン(ADMIN_TOKEN をパスフレーズにして HttpOnly セッションを張る)
    resource :session, only: %i[show create destroy]

    resource :fhir_connection_settings, only: %i[show update] do
      post :test, on: :collection
    end

    # 「自院」の Organization 指定(書き込み)。読み取りは全ユーザー向けに
    # トップレベルの /facility_settings がある。
    resource :facility_settings, only: %i[show update]

    # 上流 FHIR サーバーの管理API(/admin/oauth_clients、/admin/scopes)への中継。
    # ブラウザから上流を直接叩けない(CORS無効)ため、ここでサーバー間中継する。
    resources :oauth_clients, only: %i[index create destroy]
    get "scopes", to: "scopes#show"

    # 帳票レイアウト(.tlf)の管理。Questionnaire の canonical と紐付けて保存する。
    resources :report_layouts, only: %i[index show create update destroy]

    # テンプレートカテゴリ(独自マスタ)。Questionnaire 側は拡張に code を持つ。
    resources :questionnaire_categories, only: %i[index create update destroy]
  end

  # 「自院」がどの Organization かの参照(ログイン済みユーザー全員が読む)。
  # 変更は管理者だけなので /admin/facility_settings 側。
  resource :facility_settings, only: :show

  # 帳票出力(QuestionnaireResponse の PDF 化)。FHIR リソースではないため
  # /fhir とは別のプレーン JSON / PDF エンドポイント。
  namespace :reports do
    get "layouts", to: "layouts#show"
    get "questionnaire_responses/:id/pdf", to: "questionnaire_response_pdfs#show"
    # 検体ラベル(オーダー 1 件ぶん。1 ページ = 採取管 1 本)
    get "lab_labels/:order_id/pdf", to: "lab_label_pdfs#show"
    # 処方箋(オーダー 1 件ぶん。院外は様式第2号、それ以外は院内の簡易様式)
    get "prescriptions/:order_id/pdf", to: "prescription_pdfs#show"
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
    # 投与量の単位換算。配布ファイルではなく規格単位から生成 + 手動メンテするため
    # 取込ではなく generate を持つ。
    resources :medicine_dose_conversions, only: %i[index show create update destroy] do
      collection do
        post :generate
        get :unmapped
      end
    end
    resources :lab_items, only: %i[index show create update destroy] do
      collection do
        post :import
        get :filter_options
      end
    end
    # 検体検査オーダーのマスタ群。
    resources :lab_order_items, only: %i[index show create update destroy]
    resources :lab_panel_items, only: %i[index create update destroy]
    resources :lab_specimens, only: %i[index show create update destroy] do
      collection do
        post :import
        get :categories
      end
    end
    resources :lab_containers, only: %i[index show create update destroy]
    resources :lab_order_item_layouts, only: %i[index show create update destroy]
    resources :lab_order_item_layout_cells, only: %i[create update destroy]
    # 放射線検査オーダーのマスタ群。
    # JJ1017 の部品コード。標準コードは取込、施設拡張コードは画面から登録する。
    resources :rad_jj1017_codes, only: %i[index create update destroy] do
      collection do
        post :import
        get :elements
        get :catalog
      end
    end
    # 頻用コード表は項目マスタの一括作成の選択元なので検索と取込だけ。
    resources :rad_frequent_codes, only: %i[index] do
      collection { post :import }
    end
    resources :rad_items, only: %i[index show create update destroy] do
      collection { post :bulk_create_from_frequent }
    end
    resources :rad_set_items, only: %i[index create update destroy]
    resources :rad_item_layouts, only: %i[index show create update destroy]
    resources :rad_item_layout_cells, only: %i[create update destroy]
    # 放射線検査で使う器材の施設マスタ。実際の製品を登録し、算定に使うレセプト電算の
    # 特定器材コードを紐付ける(配布マスタは medical_materials 側)。
    resources :rad_materials, only: %i[index show create update destroy]
    # 実施入力用データセット。手技料・造影剤・器材の組み合わせに名前を付けて
    # 撮影項目に紐付けておく(master_rad_items.dataset_code)と、実施入力モーダルの
    # 初期明細として展開される。
    resources :rad_datasets, only: %i[index show create update destroy]
    resources :rad_dataset_details, only: %i[index create update destroy]
    # 生理検査オーダーのマスタ群。放射線と同じ構成だが、生理検査は JJ1017 に
    # 収載されていないため部品コード・頻用コードを持たず、モダリティの代わりに
    # 施設が定義する「検査種別」(physio_exam_types)を持つ。
    resources :physio_exam_types, only: %i[index show create update destroy]
    resources :physio_items, only: %i[index show create update destroy]
    resources :physio_set_items, only: %i[index create update destroy]
    resources :physio_item_layouts, only: %i[index show create update destroy]
    resources :physio_item_layout_cells, only: %i[create update destroy]
    # 実施入力用データセット。放射線と違い器材の参照先は特定保険医療材料
    # (master_medical_materials)そのもので、施設内の器材マスタは持たない。
    resources :physio_datasets, only: %i[index show create update destroy]
    resources :physio_dataset_details, only: %i[index create update destroy]
    # 特定器材(特定保険医療材料)と医科診療行為(手技料)。どちらもレセプト電算の
    # 配布マスタを全置換で取り込むだけで、手動メンテはしない。
    resources :medical_materials, only: %i[index] do
      collection { post :import }
    end
    resources :medical_procedures, only: %i[index] do
      collection { post :import }
    end
    # 細菌検査オーダーのマスタ群。JANIS 由来の2つは標準コードを取込で洗い替え、
    # 画面からは施設追加分(と病原体の頻用フラグ)だけを書ける。
    resources :micro_specimen_types, only: %i[index create update destroy] do
      collection { post :import }
    end
    resources :micro_organisms, only: %i[index create update destroy] do
      collection { post :import }
    end
    # 細菌検査結果のマスタ群。JANIS 由来の2つは標準コードを取込で洗い替え、
    # 画面からは施設追加分(と抗菌薬の頻用フラグ)だけを書ける。
    resources :micro_antimicrobials, only: %i[index create update destroy] do
      collection { post :import }
    end
    resources :micro_susceptibility_methods, only: %i[index create update destroy] do
      collection { post :import }
    end
    # 独自マスタ3種(検査項目・採取部位・採取方法)。seed の初期値を画面でメンテする。
    resources :micro_order_items, only: %i[index create update destroy]
    resources :micro_collection_sites, only: %i[index create update destroy]
    resources :micro_collection_methods, only: %i[index create update destroy]
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
    # 剤形・規格・銘柄不明コード(J-FAGY医薬品領域)も検索専用(取込で全件洗い替え)。
    resources :jfagy_drugs, only: %i[index] do
      collection { post :import }
    end
    # シェーマ(診療記録に描き込む台紙画像)。カテゴリは parent_id の隣接リストで
    # 任意の深さの階層を持つ。
    resources :schema_categories, only: %i[index show create update destroy]
    resources :schemas, only: %i[index show create update destroy]
  end
end
