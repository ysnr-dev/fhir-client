# カルテ右ペインの頻用メニュー(docs/features/karte.md)。医療従事者ごとに 1 つ。
#
# menu_keys は表示順に並べたメニューのキーの配列。キーの一覧はフロントの registry
# (frontend/src/components/karteMenu.ts)が正典で、ここでは形だけを守る(知らないキーは画面が落とす)。
class KartePaneFavorite < ApplicationRecord
  MAX_KEYS = 100
  KEY_FORMAT = /\A[a-z0-9][a-z0-9-]{0,63}\z/

  validates :practitioner_id, presence: true, uniqueness: true
  validate :menu_keys_shape

  private

  def menu_keys_shape
    unless menu_keys.is_a?(Array)
      errors.add(:menu_keys, "は配列で指定してください")
      return
    end

    errors.add(:menu_keys, "は #{MAX_KEYS} 件までです") if menu_keys.size > MAX_KEYS
    errors.add(:menu_keys, "に不正なキーがあります") unless menu_keys.all? { |k| k.is_a?(String) && KEY_FORMAT.match?(k) }
    errors.add(:menu_keys, "が重複しています") if menu_keys.uniq.size != menu_keys.size
  end
end
