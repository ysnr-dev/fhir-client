module Master
  # 重症度、医療・看護必要度の A・C 項目に当たるレセプト電算処理システム用コード(別表1)と、
  # 「A3 注射薬剤3種類以上の管理」の種類数から除く薬剤(別表2)。厚生労働省が診療報酬改定の
  # ページで配布する Excel を取り込み、看護必要度の評価で実施記録のコードと突き合わせる。
  class NursingAcuityCode < ApplicationRecord
    self.table_name = "master_nursing_acuity_codes"

    KINDS = %w[item a3_exclusion].freeze

    validates :kind, inclusion: { in: KINDS }
    validates :item_code, presence: true
    validates :code, presence: true, format: { with: /\A\d{9}\z/ }
  end
end
