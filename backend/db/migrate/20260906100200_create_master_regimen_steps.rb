class CreateMasterRegimenSteps < ActiveRecord::Migration[8.0]
  # レジメンの投与ステップ。注射オーダーの RP(同じルートから同時に投与する
  # 薬剤のまとまり = 混注)に相当し、順序・相対日・手技・経路・点滴時間はここが持つ。
  # 内服(経口抗がん剤)は用法コードと投与日数を持つステップとして同じ表に置く。
  def change
    create_table :master_regimen_steps do |t|
      t.string :regimen_code, null: false
      t.integer :display_order                   # 投与順序
      t.string :name                             # 任意の見出し(「前投薬」など)
      t.jsonb :days, null: false, default: []    # 相対日の配列 [1, 8, 15](1 始まり)
      t.string :usage_type, null: false          # drip / one-shot / oral
      t.string :route_code                       # 投与経路(JP Core route-codes)
      t.string :method_code                      # 手技(JAMI 注射手技)
      t.string :line_code                        # ライン(末梢/中心 × 本管/側管)
      t.integer :infusion_minutes                # 点滴時間(分)
      t.decimal :rate, precision: 10, scale: 1   # 投与速度(mL/h)
      t.string :device_note                      # 器材(インラインフィルター等)
      t.string :usage_code                       # 内服の用法コード(master_medicine_usages)
      t.integer :dose_days                       # 内服の投与日数
      t.text :note                               # 投与時注意
      t.timestamps
    end
    add_index :master_regimen_steps, %i[regimen_code display_order]
  end
end
