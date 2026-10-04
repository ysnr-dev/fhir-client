class CreateMasterNursingCare < ActiveRecord::Migration[8.0]
  def change
    # 看護計画の用語マスタ(docs/nursing-care-plan-design.md §4)。看護診断・看護成果・看護介入を
    # NANDA-I / NOC / NIC と同じ「領域 → 類 → 用語」の 3 階層で持つ。1 行が領域・類・用語のどれか。
    # NANDA-I・NIC・NOC はライセンス物なので同梱せず、施設が手入力するか契約した配布データを取り込む。
    create_table :master_nursing_terms do |t|
      # diagnosis = 看護診断 / outcome = 看護成果 / intervention = 看護介入
      t.string :taxonomy, null: false
      # domain = 領域 / class = 類 / term = 用語
      t.string :level, null: false
      t.string :code, null: false
      # 類なら領域のコード、用語なら類のコード。領域は空。
      t.string :parent_code
      t.string :name, null: false
      t.string :name_kana
      t.string :search_name
      t.string :search_kana
      # 看護診断の種類。problem = 問題焦点型 / risk = リスク型 / health_promotion = ヘルスプロモーション型
      t.string :diagnosis_type
      t.text :definition
      # 看護問題を立てるときに画面へ出す施設のガイダンス。
      t.text :guidance
      # 用語に付随する項目 [{item_type, code, name}]。item_type は看護診断なら
      # defining_characteristic(診断指標) / related_factor(関連因子) / risk_factor(危険因子)、
      # 看護成果なら indicator(指標)、看護介入なら activity(行動)。
      t.jsonb :items, null: false, default: []
      # local = 施設が作った用語 / licensed = 契約した配布データから取り込んだ用語
      t.string :source, null: false, default: "local"
      t.boolean :active, null: false, default: true
      t.integer :display_order

      t.timestamps
    end
    add_index :master_nursing_terms, %i[taxonomy code], unique: true
    add_index :master_nursing_terms, %i[taxonomy parent_code]

    # 標準看護計画。看護診断 1 件に目標と OP(観察)/TP(ケア)/EP(教育)の雛形を結びつける。
    # 看護問題を立てるときに選ぶと、目標と計画の行が写る。
    create_table :master_nursing_standard_plans do |t|
      t.string :code, null: false
      t.string :name, null: false
      t.string :name_kana
      t.string :search_name
      t.string :search_kana
      t.string :diagnosis_code
      # [{text, outcome_code}]
      t.jsonb :goals, null: false, default: []
      # [{activity_type, text, intervention_code, item_kind, code16, manage_no, item_name}]。
      # activity_type は op / tp / ep。item_kind(act / observation)と code16・manage_no は
      # MEDIS 看護実践用語標準マスターの看護行為・看護観察で、紐付けた行は看護指示へ展開できる。
      t.jsonb :activities, null: false, default: []
      t.text :note
      t.boolean :active, null: false, default: true
      t.integer :display_order

      t.timestamps
    end
    add_index :master_nursing_standard_plans, :code, unique: true
    add_index :master_nursing_standard_plans, :diagnosis_code
  end
end
