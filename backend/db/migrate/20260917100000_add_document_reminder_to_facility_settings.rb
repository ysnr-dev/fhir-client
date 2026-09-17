class AddDocumentReminderToFacilitySettings < ActiveRecord::Migration[8.0]
  # 文書作成の督促の設定(退院時サマリーの期限までの日数など)。退院の時点で期限付きの
  # 通知 Task を作るのに使う(期限は Task に焼き付くので、ここを変えても既存の通知は動かない)。
  def change
    add_column :facility_settings, :document_reminder, :jsonb, null: false, default: {}
  end
end
