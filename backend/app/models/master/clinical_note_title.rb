module Master
  # 診療記録のタイトル。選んだときに記載形式(テンプレートなら既定のテンプレート)を
  # フォームへ当て、職種(role_code)がログイン中の医療従事者と一致するものを
  # 新規記録の初期値にする。職種のコード表はフロントエンドが持つ
  # (frontend/src/fhir/practitionerRoleHelpers.ts。backend は職種を知らない)。
  class ClinicalNoteTitle < ApplicationRecord
    self.table_name = "master_clinical_note_titles"

    MODES = %w[soap free template].freeze

    validates :title, presence: true
    validates :mode, inclusion: { in: MODES }
    validates :template_canonical, presence: true, if: -> { mode == "template" }

    # テンプレート以外の記載形式では既定テンプレートを持たない。画面の「(職種を問わない)」は
    # 空文字で送られてくるので NULL に寄せる。
    before_validation :normalize_blanks

    private

    def normalize_blanks
      self.template_canonical = nil if mode != "template" || template_canonical.blank?
      self.role_code = nil if role_code.blank?
    end
  end
end
