class CreateReportLayouts < ActiveRecord::Migration[8.0]
  def change
    create_table :report_layouts do |t|
      t.string :name, null: false
      t.string :questionnaire_url, null: false
      # version なしの canonical は空文字で表す。NULL にすると PG の一意インデックスが
      # NULL 同士を重複とみなさず、同一 url のレイアウトを二重登録できてしまう。
      t.string :questionnaire_version, null: false, default: ""
      # ThinReports のレイアウトファイル(.tlf)の JSON 本文
      t.text :tlf, null: false

      t.timestamps
    end

    add_index :report_layouts, %i[questionnaire_url questionnaire_version],
              unique: true, name: "index_report_layouts_on_canonical"
  end
end
