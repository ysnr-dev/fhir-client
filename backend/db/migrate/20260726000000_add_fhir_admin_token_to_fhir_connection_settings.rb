# 上流 FHIR サーバーの管理API(/admin/oauth_clients)を叩くための共有トークン。
#
# ENV だけに置くと、設定画面から base_url を別サーバーへ向け替えたときに黙って
# 古くなり、直すのに再デプロイが必要になる(URL は 1 クリックで変えられるのに)。
# 所属する URL と同じ場所・同じ保存操作で編集できるよう、client_secret と同じく
# 暗号化カラムとして持つ。ENV はフォールバックとして残す。
class AddFhirAdminTokenToFhirConnectionSettings < ActiveRecord::Migration[8.0]
  def change
    # ActiveRecord Encryption(非決定的)で保持するため text。値では検索しない。
    add_column :fhir_connection_settings, :fhir_admin_token, :text
  end
end
