module Master
  # 検体(材料)。JLAC11 の材料コード一覧から取り込む。
  # 既定採取管(default_container_code)は master_lab_containers.container_code を指す。
  class LabSpecimen < ApplicationRecord
    self.table_name = "master_lab_specimens"

    # JLAC11 の材料コードは3桁。
    SPECIMEN_CODE_LENGTH = 3

    validates :specimen_code, presence: true, uniqueness: true,
                              length: { is: SPECIMEN_CODE_LENGTH }
    validates :name, presence: true

    before_save :set_search_columns

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
