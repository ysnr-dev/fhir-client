module Master
  # 患者の診療上の注意の区分。実体の注意は上流の FHIR Flag で患者ごとに持ち、
  # このマスタは選択肢(どんな注意があるか)と患者帯の見せ方を決める。
  # seed で初期値 15 件を投入し、以後は画面でメンテする施設マスタ。
  class PatientCaution < ApplicationRecord
    self.table_name = "master_patient_cautions"

    # 注意の区分。患者帯のアイコン色もこれで分ける
    # (安全=赤 / 臨床=橙 / 意思=紫 / 事務=灰)。
    CATEGORIES = %w[safety clinical advance-directive administrative].freeze

    # 患者帯に出すピクトグラムのキー。図柄の実体はフロントエンドの
    # frontend/src/components/icons/cautionPictograms.tsx にあり、
    # そちらが正。ここは打ち間違いを弾くための検証用の写しなので、
    # 図柄を増やすときは両方に足す。
    PICTOGRAMS = %w[
      fall wheelchair hearing vision cognition implant contrast anticoagulant
      dnar no-transfusion violence elopement unpaid privacy alert
    ].freeze

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :category, inclusion: { in: CATEGORIES }
    validates :pictogram, inclusion: { in: PICTOGRAMS }, allow_nil: true

    # 画面の「(帯に出さない)」は空文字で送られてくるので NULL に寄せる
    # (空文字と NULL の 2 通りが混ざると帯の判定が増えるため)。
    before_validation :nullify_blank_pictogram

    private

    def nullify_blank_pictogram
      self.pictogram = nil if pictogram.blank?
    end
  end
end
