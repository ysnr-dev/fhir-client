require "csv"

class MakeUrineDipstickResultItemsCoded < ActiveRecord::Migration[8.0]
  # 尿定性(試験紙法)の結果項目をコード型(－/±/＋/2＋…)にする。1:1 の派生で作ったときに
  # オーダー項目の JLAC(定量の mg/dL)から型を写したため、数値型になっていた。
  # 値は同梱 CSV(db/seed_data/lab_result_items.csv)の行を使う。派生したままの行
  # (数値型で選択肢が無い)だけを直し、施設で直した行は触らない。
  CODES = %w[160000310-03 160000310-04 160000310-05].freeze
  COLUMNS = %w[data_type display_unit ucum_unit code_value_list value_code_system decimal_places jlac11_code jlac10_code method_name].freeze

  def up
    Master::LabResultItem.reset_column_information
    rows = CSV.foreach(Rails.root.join("db/seed_data/lab_result_items.csv"), headers: true)
              .select { |row| CODES.include?(row["result_item_code"]) }
    rows.each do |row|
      item = Master::LabResultItem.find_by(result_item_code: row["result_item_code"], data_type: "PQ", code_value_list: nil)
      next if item.nil?

      item.update!(COLUMNS.to_h { |column| [column, row[column].to_s.strip.presence] })
      say "#{item.result_item_code} #{item.name} -> #{item.data_type}", true
    end
  end

  def down
    # 施設で直した結果項目を戻さない。
  end
end
