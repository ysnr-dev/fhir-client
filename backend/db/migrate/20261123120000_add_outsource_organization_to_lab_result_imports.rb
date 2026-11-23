class AddOutsourceOrganizationToLabResultImports < ActiveRecord::Migration[8.1]
  def change
    # 取り込んだ結果を測った外注先(Organization.id)。空なら院内で測った結果。
    add_column :lab_result_imports, :outsource_organization_id, :string
  end
end
