module Reports
  # Questionnaire の linkId を ThinReports のアイテム ID へ変換する。
  #
  # linkId(jsp-4)は記号 - . ! # % / : ; ? @ _ ~ を含み得るが、ThinReports Basic
  # Editor のアイテム ID は /^[0-9a-zA-Z][\w]*$/ (先頭英数字 + 英数字・アンダースコア)
  # しか許さないため、以下の規約で変換する:
  #   1. 英数字とアンダースコア以外の文字を 1 文字ずつ "_" に置換する
  #   2. 先頭が英数字でなければ "x" を前置する
  #
  # 変換で別々の linkId が同じ ID に潰れることがある(例: "a-b" と "a.b")。
  # その場合はレイアウトのプレースホルダーがどちらの回答か決められないため、
  # 生成時に IdCollision として拒否する。
  class ItemIdMapper
    class IdCollision < StandardError; end

    def initialize(link_ids)
      @map = {}
      reverse = {}
      link_ids.each do |link_id|
        tlf_id = self.class.convert(link_id)
        if (other = reverse[tlf_id]) && other != link_id
          raise IdCollision,
                "linkId \"#{other}\" と \"#{link_id}\" が同じ帳票アイテムID \"#{tlf_id}\" に変換されます。" \
                "テンプレートの linkId は英数字とアンダースコアのみを推奨します。"
        end
        reverse[tlf_id] = link_id
        @map[link_id] = tlf_id
      end
    end

    # n 回目(n >= 2)の出現は "_n" サフィックス付き ID を返す(繰り返しグループ用)。
    def tlf_id(link_id, occurrence = 1)
      base = @map.fetch(link_id) { self.class.convert(link_id) }
      occurrence >= 2 ? "#{base}_#{occurrence}" : base
    end

    # シェーマ画像用の image block ID。
    def image_id(link_id, occurrence = 1)
      base = "#{tlf_id(link_id)}_img"
      occurrence >= 2 ? "#{base}_#{occurrence}" : base
    end

    def self.convert(link_id)
      converted = link_id.to_s.gsub(/[^0-9a-zA-Z_]/, "_")
      converted = "x#{converted}" unless converted.match?(/\A[0-9a-zA-Z]/)
      converted
    end
  end
end
