# オーダーセット(よく出すオーダーのひとまとめ)のツリー 1 ノード。kind が folder なら
# 入れ物、set なら entries(オーダー 1 件ぶんのフォーム値)を持つ。
#
# 持ち主(scope / owner_id)は 3 段階で、ツリーは持ち主ごとに独立している(親と子の
# 持ち主は必ず同じ)。院内共通は owner_id を持たない。
# オーダーそのものではない(患者を持たない雛形)ので上流 FHIR には置かず、backend の
# DB に持つ。設計は docs/order-set-design.md。
class OrderSet < ApplicationRecord
  KINDS = %w[folder set].freeze
  SCOPES = %w[facility department practitioner].freeze
  # 循環検出の遡上上限(Master::SchemaCategory と同じ保険)。
  MAX_DEPTH = 50

  has_many :entries, -> { order(Arel.sql("display_order NULLS LAST"), :id) },
           class_name: "OrderSetEntry", dependent: :destroy

  before_validation :assign_code

  validates :code, presence: true, uniqueness: true
  validates :kind, inclusion: { in: KINDS }
  validates :scope, inclusion: { in: SCOPES }
  validates :name, presence: true, uniqueness: { scope: %i[scope owner_id parent_id] }
  validate :owner_must_match_scope
  validate :parent_must_be_folder_in_same_scope, if: -> { parent_id.present? }
  validate :parent_must_not_cycle, if: -> { parent_id.present? }

  scope :ordered, -> { order(Arel.sql("display_order NULLS LAST"), :id) }

  # 画面が同時に見る 3 つのルート(院内共通 + 指定した診療科 + 指定した医師)のノード。
  # 引数が空のルートは含めない。
  def self.roots_for(department_id:, practitioner_id:)
    rel = where(scope: "facility")
    rel = rel.or(where(scope: "department", owner_id: department_id)) if department_id.present?
    rel = rel.or(where(scope: "practitioner", owner_id: practitioner_id)) if practitioner_id.present?
    rel
  end

  def folder? = kind == "folder"

  private

  # code は運用者に入力させず採番する。複製やインポートで指定があれば尊重する。
  def assign_code
    self.code = SecureRandom.uuid if code.blank?
  end

  def owner_must_match_scope
    if scope == "facility"
      errors.add(:owner_id, "は院内共通では指定できません") if owner_id.present?
    elsif owner_id.blank?
      errors.add(:owner_id, "を入力してください")
    end
  end

  # 親はフォルダで、持ち主が同じでなければならない(持ち主をまたぐ木は作らない)。
  def parent_must_be_folder_in_same_scope
    parent = self.class.find_by(id: parent_id)
    if parent.nil?
      errors.add(:parent_id, "が見つかりません")
    elsif !parent.folder?
      errors.add(:parent_id, "にはフォルダを指定してください")
    elsif parent.scope != scope || parent.owner_id != owner_id
      errors.add(:parent_id, "は同じ持ち主のフォルダを指定してください")
    end
  end

  # 自分自身や子孫を親に指定すると木が循環して辿れなくなるため拒否する。
  def parent_must_not_cycle
    current = parent_id
    MAX_DEPTH.times do
      return if current.nil?
      if current == id
        errors.add(:parent_id, "に自分自身または子孫のフォルダは指定できません")
        return
      end
      current = self.class.where(id: current).pick(:parent_id)
    end
    errors.add(:parent_id, "の階層が深すぎます")
  end
end
