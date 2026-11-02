module Master
  # 施設が条件式(FHIRPath)で定義する警告の規則(docs/advisory-design.md §2.9・§3.6)。
  # 式はフロントエンドが患者の文脈(テンプレートの % 変数)で評価し、真のとき警告の器に「施設の規則」として出す。
  class AdvisoryRule < ApplicationRecord
    self.table_name = "master_advisory_rules"

    # 施設の規則に付けられる重さ。止める(block)は付けさせない(式の誤りで登録が止まらないように)。
    SEVERITIES = %w[info warning].freeze

    # 規則を出す場所。正はフロントエンドの frontend/src/fhir/advisoryRuleHelpers.ts の
    # ADVISORY_RULE_CONTEXTS で、ここは打ち間違いを弾くための写し。場所を増やすときは両方に足す。
    CONTEXTS = %w[
      patient-view prescription injection rad-order radiotherapy physio endoscopy meal-order
      transfusion-order transfusion-dispense transfusion-perform autologous-collection medical-management
      regimen-apply regimen-cycle
    ].freeze

    validates :code, presence: true, uniqueness: true, format: { with: /\A[a-z0-9][a-z0-9-]*\z/ }
    validates :name, :expression, :message, presence: true
    validates :severity, inclusion: { in: SEVERITIES }
    validate :contexts_known

    private

    def contexts_known
      values = contexts
      unless values.is_a?(Array) && values.any? && values.all? { |value| CONTEXTS.include?(value) }
        errors.add(:contexts, "は出す場所を 1 つ以上、既知の値で指定してください")
      end
    end
  end
end
