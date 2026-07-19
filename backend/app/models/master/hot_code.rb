module Master
  class HotCode < ApplicationRecord
    self.table_name = "master_hot_codes"

    # hot_code is not unique in the source master: multiple distinct products
    # can share the same HOT code (see MasterImport::HotCodeImporter).
    validates :hot_code, presence: true
  end
end
