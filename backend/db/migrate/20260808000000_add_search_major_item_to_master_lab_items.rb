class AddSearchMajorItemToMasterLabItems < ActiveRecord::Migration[7.0]
  def up
    add_column :master_lab_items, :search_major_item, :string

    say_with_time "backfill master_lab_items.search_major_item" do
      Master::LabItem.reset_column_information
      Master::LabItem.find_each do |record|
        record.update_columns(search_major_item: Master::SearchNormalizer.normalize(record.major_item))
      end
    end
  end

  def down
    remove_column :master_lab_items, :search_major_item
  end
end
