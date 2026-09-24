class CreateMasterClinicalNoteTitles < ActiveRecord::Migration[8.0]
  # 診療記録のタイトルのマスタ。タイトルごとに記載形式(と、テンプレートなら
  # 既定のテンプレート)を決めておき、選んだときにフォームへ当てる。
  # role_code はログイン中の医療従事者の職種と突き合わせ、新規記録の初期値にする
  # タイトルを選ぶためのもの(NULL は職種を問わない)。
  def change
    create_table :master_clinical_note_titles do |t|
      t.string :title, null: false
      t.string :mode, null: false, default: "soap" # soap / free / template
      t.string :template_canonical                 # mode = template のときの既定テンプレート
      t.string :role_code                          # PractitionerRole.code(practitioner-role 体系)
      t.integer :display_order

      t.timestamps
    end
  end
end
