class DeriveMasterLabResultItemsFromOrderItems < ActiveRecord::Migration[8.0]
  # 結果項目マスタの初期投入。本番は Shell が無いため一回限りの処理は migration に畳む。
  # 同梱 CSV(多結果項目の分解)を入れてから、単項目オーダー項目 1 件につき同じコードの
  # 結果項目を 1 件作って対応づける。既存行は上書きしない(何度実行しても同じ)。
  def up
    say_with_time "derive master_lab_result_items from master_lab_order_items" do
      Master::LabResultItem.reset_column_information
      Master::LabOrderItemResult.reset_column_information
      result = Master::LabResultItemDerivation.call
      say "csv items #{result.csv_items}, csv mappings #{result.csv_mappings}, " \
          "created #{result.created}, mapped #{result.mapped}, kept #{result.kept}", true
      result.created
    end
  end

  def down
    # 施設で直した結果項目を消さない。テーブルごと消すのは create migration の down。
  end
end
