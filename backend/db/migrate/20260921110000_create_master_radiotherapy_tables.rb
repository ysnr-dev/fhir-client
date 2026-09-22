class CreateMasterRadiotherapyTables < ActiveRecord::Migration[8.0]
  # 放射線治療の施設固有マスタ(docs/radiotherapy-order-design.md §3)。
  #
  # 保有する装置・実施できる照射技法・定型の線量分割は施設ごとに違うので、選択肢は
  # マスタで持つ。いずれも画面から手で入れる単純編集型で、配布マスタの取込は無い
  # (JP Core にも JJ1017 にも治療処方の語彙は無い)。初期値は db:seed で入れる。
  def change
    # 照射モダリティ(X線・電子線・陽子線…)。
    create_table :master_radiotherapy_modalities do |t|
      t.string :code, null: false
      t.string :name, null: false
      # 線量の単位。体外照射・小線源は Gy。
      t.string :dose_unit, null: false, default: "Gy"
      # 標準コードとの対応(参考)。mCODE の値セットは SNOMED CT。オーダーには焼かない。
      t.string :reference_system
      t.string :reference_code
      t.boolean :enabled, null: false, default: true
      t.integer :display_order
      t.text :note
      t.timestamps
    end
    add_index :master_radiotherapy_modalities, :code, unique: true

    # 照射技法(3D-CRT・IMRT・VMAT・SBRT…)。
    create_table :master_radiotherapy_techniques do |t|
      t.string :code, null: false
      t.string :name, null: false
      t.string :abbreviation
      # この技法を選べるモダリティのコード。空ならどのモダリティでも選べる。
      t.jsonb :modality_codes, null: false, default: []
      t.string :reference_system
      t.string :reference_code
      t.boolean :enabled, null: false, default: true
      t.integer :display_order
      t.text :note
      t.timestamps
    end
    add_index :master_radiotherapy_techniques, :code, unique: true

    # 治療装置(リニアック・小線源治療装置…)。
    create_table :master_radiotherapy_devices do |t|
      t.string :code, null: false
      t.string :name, null: false
      # linac / tomotherapy / stereotactic / particle / brachytherapy / other
      t.string :device_type, null: false, default: "linac"
      t.jsonb :modality_codes, null: false, default: []
      t.boolean :enabled, null: false, default: true
      t.integer :display_order
      t.text :note
      t.timestamps
    end
    add_index :master_radiotherapy_devices, :code, unique: true

    # 休止・中止の理由。
    create_table :master_radiotherapy_stop_reasons do |t|
      t.string :code, null: false
      t.string :name, null: false
      # suspend = 休止 / terminate = 中止 / both = どちらにも出す
      t.string :kind, null: false, default: "both"
      t.boolean :enabled, null: false, default: true
      t.integer :display_order
      t.timestamps
    end
    add_index :master_radiotherapy_stop_reasons, :code, unique: true

    # 治療プロトコル(定型処方)。標的と Phase(線量分割)をひとまとめにした施設の定型で、
    # 処方フォームで選ぶと展開される。標的・Phase は数件で、単独で検索も集計もしないので
    # 子テーブルに分けず jsonb で持つ。
    create_table :master_radiotherapy_protocols do |t|
      t.string :code, null: false
      t.string :name, null: false
      t.string :name_kana
      # curative / neoadjuvant / adjuvant / palliative / prophylactic
      t.string :intent
      # [{ key, label, volume_type, body_part_code, body_part_name }]
      t.jsonb :volumes, null: false, default: []
      # [{ label, modality_code, technique_code, device_code, fractions, fractions_per_week,
      #    doses: [{ volume_key, fraction_dose }] }]
      t.jsonb :phases, null: false, default: []
      t.boolean :enabled, null: false, default: true
      t.integer :display_order
      t.text :note
      t.string :search_name
      t.string :search_kana
      t.timestamps
    end
    add_index :master_radiotherapy_protocols, :code, unique: true
  end
end
