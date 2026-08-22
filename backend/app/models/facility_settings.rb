# 「自院」がどの Organization かを指す単一行モデル。
#
# 本アプリはマルチテナントではなく、スタッフ・診療科・診察室は自院のものしか
# 登録しない。一方で診療情報提供書の送付先候補として他院の医療機関・医師も
# Organization / Practitioner として登録するため、「どれが自院か」を宣言する
# 場所が要る。ここがその唯一の宣言で、backend(処方箋 PDF の医療機関欄)と
# frontend(各マスタの所属既定値・帳票の自院欄)が同じ値を参照する。
#
# 接続設定(FhirConnectionSettings)とは分けている。あちらは「どのサーバーに
# 繋ぐか」というインフラ設定で秘密情報を持ち管理者しか読めないが、こちらは
# 業務設定でログイン済みユーザー全員が読む。
class FacilitySettings < ApplicationRecord
  # 単一行の強制: ガード列は常に 0。一意インデックス(migration)と合わせて 2 行目を弾く。
  attribute :singleton_guard, :integer, default: 0
  validates :singleton_guard, inclusion: { in: [0] }, uniqueness: true

  class << self
    # 単一行を遅延生成して返す。
    def current
      first_or_create!
    end

    # 自院の Organization.id。未設定なら nil(呼び出し側は従来の推測に倒す)。
    def self_organization_id
      current.self_organization_fhir_id.presence
    end
  end
end
