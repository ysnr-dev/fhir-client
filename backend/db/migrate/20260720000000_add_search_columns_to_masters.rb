class AddSearchColumnsToMasters < ActiveRecord::Migration[7.0]
  def up
    add_column :master_medicines, :search_name, :string
    add_column :master_medicines, :search_kana, :string
    add_column :master_medicine_usages, :search_name, :string

    say_with_time "backfill master_medicines search columns" do
      Master::Medicine.reset_column_information
      Master::Medicine.find_each do |record|
        record.update_columns(
          search_name: Master::SearchNormalizer.normalize(record.name),
          search_kana: Master::SearchNormalizer.normalize(record.name_kana)
        )
      end
    end

    say_with_time "backfill master_medicine_usages search columns" do
      Master::MedicineUsage.reset_column_information
      Master::MedicineUsage.find_each do |record|
        record.update_columns(search_name: Master::SearchNormalizer.normalize(record.usage_name))
      end
    end
  end

  def down
    remove_column :master_medicines, :search_name
    remove_column :master_medicines, :search_kana
    remove_column :master_medicine_usages, :search_name
  end
end
