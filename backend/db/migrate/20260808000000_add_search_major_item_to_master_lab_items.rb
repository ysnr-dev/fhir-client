class AddSearchMajorItemToMasterLabItems < ActiveRecord::Migration[7.0]
  # backfill 用。アプリのモデル(Master::JlacItem)は改名後のテーブルを指すので、
  # この時点のテーブル名を持つ移行専用のクラスで引く。
  class LabItem < ActiveRecord::Base
    self.table_name = "master_lab_items"
  end

  def up
    add_column :master_lab_items, :search_major_item, :string

    say_with_time "backfill master_lab_items.search_major_item" do
      LabItem.reset_column_information
      LabItem.find_each do |record|
        record.update_columns(search_major_item: Master::SearchNormalizer.normalize(record.major_item))
      end
    end
  end

  def down
    remove_column :master_lab_items, :search_major_item
  end
end
