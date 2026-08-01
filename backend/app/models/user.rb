# アプリ本体(患者・処方等の画面)のログインユーザー。上流 FHIR サーバーの
# Practitioner と 1:1 で対応し、資格情報(login_id / password)だけをローカルに持つ。
# 登録・変更は医療従事者登録ページ(/auth/account)から行う。
#
# 固定ユーザー administrator は DB に置かず、ENV["ADMIN_TOKEN"] と照合する
# (Auth::SessionsController)。そのため login_id としては予約済み。
class User < ApplicationRecord
  has_secure_password

  RESERVED_LOGIN_IDS = %w[administrator].freeze

  validates :login_id, presence: true, uniqueness: true,
                       length: { maximum: 100 },
                       format: { with: /\A[A-Za-z0-9_.\-@]+\z/,
                                 message: "は半角英数字と _ . - @ のみ使用できます" },
                       exclusion: { in: RESERVED_LOGIN_IDS, message: "は予約されています" }
  validates :practitioner_fhir_id, presence: true, uniqueness: true
  # has_secure_password が新規作成時の presence は検証する。ここでは長さのみ。
  validates :password, length: { minimum: 8 }, allow_nil: true
end
