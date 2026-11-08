# 持ち主ごとに保存する jsonb の定義(チャート定義・ダッシュボード・診療ダッシュボード・データ抽出の条件・
# 頻用病名)の共通部。モデルは SCOPES・DEFAULT_DEFINITION・DEFINITION_KEYS と、JsonShape の形
# DEFINITION_SHAPE を持つ。形が JsonShape で表せないモデルは definition_shape を上書きする。
# before_validation / validates の行は検証の順を保つためモデル側に書く。
module ScopedDefinition
  extend ActiveSupport::Concern
  include ScopedOwner

  # 欠けたキーを既定値で埋めた定義。読み出しは常にこちらを使う。
  def definition_with_defaults
    stored = definition.is_a?(Hash) ? definition : {}
    self.class::DEFAULT_DEFINITION.merge(stored.slice(*self.class::DEFINITION_KEYS))
  end

  private

  # code は運用者に入力させず採番する。複製やインポートで指定があれば尊重する。
  def assign_code
    self.code = SecureRandom.uuid if code.blank?
  end

  # 先頭(definition そのもの)の文言は「は〜」で始まり、中の項目は位置から始まる。
  def definition_shape
    return if definition.blank?

    JsonShape.errors(self.class::DEFINITION_SHAPE, definition).each do |message|
      errors.add(:definition, message.start_with?("は") ? message : "の #{message}")
    end
  end
end
