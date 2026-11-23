class AddOutsourceOrganizationToMasterLabOrderItems < ActiveRecord::Migration[8.1]
  def change
    # 外注先(上流の Organization.id)。空なら施設設定の既定の外注先に出す。
    add_column :master_lab_order_items, :outsource_organization_id, :string
  end
end
