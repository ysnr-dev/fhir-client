# 患者フォルダ 1 つ。患者を任意の階層の分類に仕分ける入れ物で、フォルダは子フォルダと
# 患者(PatientFolderMember)の両方を持てる。
#
# 持ち主(scope / owner_id)はオーダーセットと同じ 3 段階で、木は持ち主ごとに独立している
# (親と子の持ち主は必ず同じ)。院内共通は owner_id を持たない。本人のフォルダは本人しか
# 読み書きできない(Master::PatientFolderAccess)。設計は docs/patient-folder-design.md。
class PatientFolder < ApplicationRecord
  SCOPES = %w[facility department practitioner].freeze
  # 循環検出の遡上上限(OrderSet と同じ保険)。
  MAX_DEPTH = 50

  has_many :members, class_name: "PatientFolderMember", dependent: :delete_all

  validates :scope, inclusion: { in: SCOPES }
  validates :name, presence: true, uniqueness: { scope: %i[scope owner_id parent_id] }
  validate :owner_must_match_scope
  validate :parent_must_be_in_same_scope, if: -> { parent_id.present? }
  validate :parent_must_not_cycle, if: -> { parent_id.present? }

  scope :ordered, -> { order(Arel.sql("display_order NULLS LAST"), :id) }

  # 画面が同時に見る 3 つの持ち主(院内共通 + 指定した診療科 + 指定した本人)のフォルダ。
  def self.roots_for(department_id:, practitioner_id:)
    rel = where(scope: "facility")
    rel = rel.or(where(scope: "department", owner_id: department_id)) if department_id.present?
    rel = rel.or(where(scope: "practitioner", owner_id: practitioner_id)) if practitioner_id.present?
    rel
  end

  # 自分と子孫のフォルダの id(「下位フォルダを含める」で患者を集めるため)。
  def self_and_descendant_ids
    ids = [id]
    frontier = [id]
    MAX_DEPTH.times do
      frontier = self.class.where(parent_id: frontier).pluck(:id) - ids
      break if frontier.empty?

      ids.concat(frontier)
    end
    ids
  end

  private

  def owner_must_match_scope
    if scope == "facility"
      errors.add(:owner_id, "は院内共通では指定できません") if owner_id.present?
    elsif owner_id.blank?
      errors.add(:owner_id, "を入力してください")
    end
  end

  # 持ち主をまたぐ木は作らない。
  def parent_must_be_in_same_scope
    parent = self.class.find_by(id: parent_id)
    if parent.nil?
      errors.add(:parent_id, "が見つかりません")
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
