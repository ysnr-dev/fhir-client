# 持ち主(scope / owner_id)ごとに持つ運用データ(チャート定義・ダッシュボード・オーダーセット・
# 患者フォルダなど)の共通部。持ち主は院内共通(facility。owner_id を持たない)・診療科・医師と、
# 持てるモデルだけチームで、モデルは SCOPES にどれを持つかを並べる。
# scope / owner_id の検証(validates / validate の行)は検証の順を保つためモデル側に書く。
module ScopedOwner
  extend ActiveSupport::Concern

  included do
    scope :ordered, -> { order(Arel.sql("display_order NULLS LAST"), :id) }
  end

  class_methods do
    # 画面が同時に見る持ち主(院内共通 + 指定した診療科 + 指定した医師 + 自分のチーム)の行。
    # 引数が空の持ち主は含めない。チームを持たないモデルは team_ids を受けるだけで使わない
    # (ScopedDefinitions#index が常に渡してくる)。
    def roots_for(department_id:, practitioner_id:, team_ids: [])
      rel = where(scope: "facility")
      rel = rel.or(where(scope: "department", owner_id: department_id)) if department_id.present?
      rel = rel.or(where(scope: "practitioner", owner_id: practitioner_id)) if practitioner_id.present?
      rel = rel.or(where(scope: "team", owner_id: team_ids)) if self::SCOPES.include?("team") && team_ids.present?
      rel
    end
  end

  private

  def owner_must_match_scope
    if scope == "facility"
      errors.add(:owner_id, "は院内共通では指定できません") if owner_id.present?
    elsif owner_id.blank?
      errors.add(:owner_id, "を入力してください")
    end
  end
end
