class AddSearchGenericToMasterMedicines < ActiveRecord::Migration[7.0]
  def up
    add_column :master_medicines, :search_generic, :string

    say_with_time "backfill master_medicines.search_generic" do
      Master::Medicine.reset_column_information
      Master::Medicine.find_each do |record|
        record.update_columns(search_generic: Master::SearchNormalizer.normalize(record.generic_name_description))
      end
    end
  end

  def down
    remove_column :master_medicines, :search_generic
  end
end
