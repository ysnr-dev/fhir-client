class CreateMasterWardMaps < ActiveRecord::Migration[8.0]
  # 病棟マップのレイアウト(設備・病室・ベッドの配置)。
  #
  # 病棟・病室・ベッドは上流 FHIR の Location にあるが、ナースステーションや階段の
  # ような設備は FHIR に置き場が無く、座標も Location の本来の情報ではない。
  # 「病棟の間取りをどう描くか」は施設の表示設定なので、他のマスタと同じ
  # backend のテーブルに置く。1 病棟 1 行で、レイアウト全体を jsonb に持つ
  # (エディタは全体を一括で保存するので、行に分けても得るものが無い)。
  #
  # ベッドの実体(何床あるか)は Location だけを正とする。ここに置くのは
  # 「その Location をどこに描くか」だけで、消えた Location は読む側が欠番として扱う。
  def change
    create_table :master_ward_maps do |t|
      # 病棟。FHIR Location(physicalType=wa)の id。FHIR リソースは上流にあり DB を
      # 跨げないので FK は張らない(手術室ブロックと同じ扱い)。
      t.string :ward_location_id, null: false
      t.string :ward_name # 表示用の写し。病棟が消えても行の意味が読める

      # レイアウト本体。形は Master::WardMap の layout_shape が守る。
      t.jsonb :layout, null: false, default: {}
      t.text :note

      t.timestamps
    end

    add_index :master_ward_maps, :ward_location_id, unique: true
  end
end
