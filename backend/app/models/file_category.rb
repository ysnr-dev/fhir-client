# カルテに取り込んだファイル(DocumentReference)の分類。FHIR のリソースではなく
# 本アプリ固有のマスタで、表示名と並び順だけを持つ。
#
# どのファイルがどのカテゴリかは上流の DocumentReference.category に
# system: http://fhir-client.local/CodeSystem/file-category の code として書く。
# ここから DocumentReference を参照しないのは、ファイル本体が上流 FHIR サーバーに
# あり、backend の DB では参照整合性を保てないため。
class FileCategory < ApplicationRecord
  NAME_MAX_LENGTH = 50

  before_validation :assign_code

  validates :code, presence: true, uniqueness: true
  validates :name, presence: true, uniqueness: true, length: { maximum: NAME_MAX_LENGTH }
  validates :display_order, numericality: { only_integer: true }

  scope :ordered, -> { order(:display_order, :id) }

  private

  # code は運用者に入力させず採番する(表示名だけを管理すればよくする)。
  def assign_code
    self.code = SecureRandom.uuid if code.blank?
  end
end
