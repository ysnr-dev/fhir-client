# テンプレート(Questionnaire)の分類。FHIR のリソースではなく本アプリ固有の
# マスタで、テンプレート選択プルダウンの見出しと並び順だけを持つ。
#
# どのテンプレートがどのカテゴリかは Questionnaire 側の拡張
# (http://fhir-client.local/StructureDefinition/questionnaire-template-category)
# に code を書いて表す。ここから Questionnaire を参照しないのは、テンプレート
# 本体が上流 FHIR サーバーにあり、backend の DB では参照整合性を保てないため。
class QuestionnaireCategory < ApplicationRecord
  NAME_MAX_LENGTH = 50

  before_validation :assign_code

  validates :code, presence: true, uniqueness: true
  validates :name, presence: true, uniqueness: true, length: { maximum: NAME_MAX_LENGTH }
  validates :display_order, numericality: { only_integer: true }

  scope :ordered, -> { order(:display_order, :id) }

  private

  # code は運用者に入力させず採番する(表示名だけを管理すればよくする)。
  # インポート時に元環境の code をそのまま復元できるよう、指定があれば尊重する。
  def assign_code
    self.code = SecureRandom.uuid if code.blank?
  end
end
