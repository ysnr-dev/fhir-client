module Master
  # 口腔診査情報標準コード仕様(JDAOES Ver.1.02)のコード表。日本歯科医師会の配布ファイルから
  # rake(master_oral_exam_codes:csv)で作った seed CSV を投入する固定のマスタで、画面からは直さない。
  # 患者ごとの診査結果は上流の FHIR Observation に持ち、このマスタは選択肢の名称と
  # 標準プロファイル 26 項目(TF)への対応を引くのに使う。
  class OralExamCode < ApplicationRecord
    self.table_name = "master_oral_exam_codes"

    # 歯の診査情報(部位・基本状態・現在歯の内容・欠損歯の内容・その他・標準プロファイル 26 項目)、
    # 入力種別、口腔全体(口腔内装置等・矯正関係・その他の疾病及び異常・所見)。
    RECORDS = %w[TB TD TP TM TE TF NS KS KK SI SK].freeze

    validates :record, inclusion: { in: RECORDS }
    validates :item, :code, :display, presence: true
    validates :code, uniqueness: { scope: :item }
  end
end
