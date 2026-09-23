module Master
  # レセプト電算のコメント関連テーブル(ck_ALL*.csv)の写し。診療行為コードに関係する
  # コメントコードと条件。手動メンテはしない(配布ファイルの全置換)。
  #
  # 条件区分(condition_category): 00 = 記載要領の文言で決まる条件 / 01 = その行為を算定したら
  # 要る / 02 = 入院・入院外のどちらかで算定したら(inpatient_outpatient: 1 入院 2 入院外)/
  # 03 = 複数回算定したら(billing_count 回以上)。配布ファイルにはこれ以外の値もある。
  # 非算定理由コメント(non_billing_reason = 1)は算定しなかったときのコメントで、送信の候補ではない。
  class CommentRelation < ApplicationRecord
    self.table_name = "master_comment_relations"

    NOT_ABOLISHED = "99999999".freeze

    validates :procedure_code, presence: true

    scope :active, -> { where(abolished_on: [nil, "", NOT_ABOLISHED]) }
    # 送るコメントの候補。患者の状態コードだけの行と、非算定理由のコメントは除く。
    scope :sendable, lambda {
      where.not(comment_code: [nil, ""]).where("non_billing_reason IS NULL OR non_billing_reason <> '1'")
    }
  end
end
