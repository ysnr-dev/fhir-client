# 文書テンプレート(Word / Excel の様式ファイル)。FHIR のリソースではなく本アプリ固有の
# マスタで、プレースホルダー入りのファイル本体を持つ(docs/document-template-design.md)。
#
# カルテの値の差し込みはブラウザ側で行うので、ここは本体を預かって返すだけ。
# どのテンプレートから作った文書かは、上流の DocumentReference.type に
# system: http://fhir-client.local/CodeSystem/document-template の code として書く。
class DocumentTemplate < ApplicationRecord
  NAME_MAX_LENGTH = 100
  # 差し込み後のファイルを患者ファイル(1 件 7MB まで)として保存できるよう、余白を残す。
  DATA_MAX_BYTESIZE = 5.megabytes
  CONTENT_TYPES = {
    ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }.freeze
  ZIP_SIGNATURE = "PK\x03\x04".b.freeze

  belongs_to :file_category, optional: true

  before_validation :assign_code
  before_validation :assign_file_attributes

  validates :code, presence: true, uniqueness: true
  validates :name, presence: true, uniqueness: true, length: { maximum: NAME_MAX_LENGTH }
  validates :file_name, presence: true
  validates :data, presence: true
  validates :display_order, numericality: { only_integer: true }
  validate :file_must_be_office_document

  scope :ordered, -> { order(:display_order, :id) }
  # 一覧では本体(数 MB)を読み込まない。
  scope :without_data, -> { select(column_names - [ "data" ]) }

  def extension
    File.extname(file_name.to_s).downcase
  end

  private

  # code は運用者に入力させず採番する(表示名だけを管理すればよくする)。
  def assign_code
    self.code = SecureRandom.uuid if code.blank?
  end

  # 種類とサイズは送られてきた値を信用せず、ファイル名と本体から決める。
  def assign_file_attributes
    return unless has_attribute?(:data)

    self.content_type = CONTENT_TYPES[extension].to_s
    self.byte_size = data.to_s.bytesize
  end

  def file_must_be_office_document
    return unless has_attribute?(:data)
    return if file_name.blank? || data.blank?

    unless CONTENT_TYPES.key?(extension)
      errors.add(:file_name, "は .docx または .xlsx のファイルを指定してください")
      return
    end
    errors.add(:data, "は Word / Excel のファイルではありません") unless data.b.start_with?(ZIP_SIGNATURE)
    if data.bytesize > DATA_MAX_BYTESIZE
      errors.add(:data, "は #{DATA_MAX_BYTESIZE / 1.megabyte}MB 以下にしてください")
    end
  end
end
