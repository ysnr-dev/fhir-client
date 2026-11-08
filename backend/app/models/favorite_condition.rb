# 頻用病名 1 件(docs/features/patient-profile.md「頻用病名」)。
#
# よく使う「接頭語+病名+接尾語(疑いを含む)」の組み合わせを、持ち主(院内共通 / 診療科 / 医師)ごとに
# 持つ。病名フォームの入力方法「頻用病名」から選ぶと、フォームの病名・修飾語にそのまま入る。
# 区分(保険病名 / プロブレム / 既往歴)や経過は患者ごとの値なので持たない。
#
# definition は jsonb で、画面のフォーム値(masterClient の Disease / Modifier)をそのまま入れる
# (オーダーセットのエントリと同じ考え方。backend は中身を解釈せず、画面が読むのに要る
# キーがあることだけを確かめる)。
#
#   { "schema_version": 1,
#     "disease": { "management_number": "...", "name": "...", "icd10_2013": "...", ... },
#     "prefixModifiers": [ { "management_number": "...", "name": "...", ... } ],
#     "postfixModifiers": [ ... ] }
#
# name は連結した表示名(接頭語+病名+接尾語)で、同じ持ち主の中で重ならない。
class FavoriteCondition < ApplicationRecord
  include ScopedDefinition

  SCOPES = %w[facility department practitioner].freeze
  SCHEMA_VERSION = 1
  MODIFIER_LIST_KEYS = %w[prefixModifiers postfixModifiers].freeze
  DEFINITION_KEYS = (%w[schema_version disease] + MODIFIER_LIST_KEYS).freeze
  CODED_KEYS = %w[management_number name].freeze

  DEFAULT_DEFINITION = {
    "schema_version" => SCHEMA_VERSION,
    "disease" => nil,
    "prefixModifiers" => [],
    "postfixModifiers" => []
  }.freeze

  before_validation :assign_code

  validates :code, presence: true, uniqueness: true
  validates :scope, inclusion: { in: SCOPES }
  validates :name, presence: true, uniqueness: { scope: %i[scope owner_id] }
  validate :owner_must_match_scope
  validate :definition_shape

  private

  def definition_shape
    unless definition.is_a?(Hash)
      errors.add(:definition, "は連想配列で指定してください")
      return
    end
    version = definition["schema_version"]
    errors.add(:definition, "の schema_version は #{SCHEMA_VERSION} で指定してください") if version.present? && version != SCHEMA_VERSION
    errors.add(:definition, "の disease は管理番号と名称を持つ病名で指定してください") unless coded?(definition["disease"])
    MODIFIER_LIST_KEYS.each do |key|
      list = definition.fetch(key, [])
      next if list.is_a?(Array) && list.all? { |m| coded?(m) }

      errors.add(:definition, "の #{key} は管理番号と名称を持つ修飾語の配列で指定してください")
    end
  end

  def coded?(value)
    value.is_a?(Hash) && CODED_KEYS.all? { |key| value[key].is_a?(String) && value[key].present? }
  end
end
