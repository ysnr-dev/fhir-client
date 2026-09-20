module Integrations
  module Orca
    # 日レセ API の応答の成否判定。
    #
    # Api_Result の桁数は API ごとに違う(system01lstv2 は 2 桁、incomeinfv2 や
    # 帳票印刷は 4 桁)。"00" との比較を焼き付けると 4 桁系を必ず失敗扱いにしてしまうので、
    # 「ゼロだけで構成されていれば成功」で判定する。
    #
    # さらに medicalmodv2 は Api_Result が 00 でも、診療行為側(Medical_Result)と
    # 病名側(Disease_Result)で別々に部分失敗する。3 層を全部見ないと「登録できた」と
    # 誤って表示してしまう。
    class ApiResult
      # 他端末使用中。待てば直るのでこれだけ再送する。
      BUSY = "90".freeze
      # 部分失敗を別々に返してくる層(medicalmodv2)。
      LAYERS = %w[Medical Disease].freeze

      attr_reader :code, :message, :warnings

      # accepted_codes は「ゼロではないが登録は行われた」コード。
      # acceptmodv2 の K 系(K3 = 受付登録終了)のように、API ごとに独自の
      # 成功コードがあるので、呼び側が明示する。
      def initialize(code:, message:, warnings: [], accepted_codes: [])
        @code = code.to_s
        @message = message.to_s
        @warnings = warnings
        @accepted_codes = accepted_codes.map(&:to_s)
      end

      # 応答 Hash から組み立てる。medicalmodv2 のような多層のものは
      # 下位の Result / Warning も畳み込む。
      def self.from(body, accepted_codes: [])
        warnings = LAYERS.flat_map { |layer| layer_messages(body, layer) } + api_warnings(body)

        new(
          code: body["Api_Result"],
          message: body["Api_Result_Message"],
          warnings: warnings,
          accepted_codes: accepted_codes
        )
      end

      # API 全体に対する注意書き(acceptmodv2 の「診療内容情報を自動設定しました」など)。
      # 層ごとの警告とは別の入れ物で返ってくる。
      def self.api_warnings(body)
        Array(body["Api_Warning_Message_Information"]).filter_map do |entry|
          next unless entry.is_a?(Hash)

          message = entry["Api_Warning_Message"].to_s
          next if message.empty?

          { "layer" => "Api", "code" => "", "message" => message }
        end
      end
      private_class_method :api_warnings

      # 層ごとの結果と警告。medicalmodv2 では Medical_Result / Disease_Result は
      # *_Message_Information の中に入っている(reference/record/xml_medicalv2res.db)が、
      # 直下に返す API もあるので、入れ子が無ければ最上位を見る。
      def self.layer_messages(body, layer)
        container = body["#{layer}_Message_Information"]
        source = container.is_a?(Hash) ? container : body
        messages = []

        result = source["#{layer}_Result"].to_s
        unless result.empty? || zero?(result)
          messages << {
            "layer" => layer,
            "code" => result,
            "message" => source["#{layer}_Result_Message"].to_s
          }
        end

        Array(source["#{layer}_Warning_Info"]).each do |entry|
          next unless entry.is_a?(Hash)

          messages << {
            "layer" => layer,
            "code" => entry["#{layer}_Warning"].to_s,
            "message" => entry["#{layer}_Warning_Message"].to_s,
            # 何番目の剤・明細・病名で起きたか。入院期間中エラーのように位置に
            # 関係しない警告では ORCA が省いてくるので、空なら落とす。
            "position" => entry["#{layer}_Warning_Item_Position"].to_s.presence,
            # 原因になったコード(診療行為コード / 病名コード)。
            "target_code" => entry["#{layer}_Warning_Code"].to_s.presence,
            "target_name" => entry["#{layer}_Warning_Name"].to_s.presence
          }.compact
        end

        messages
      end
      private_class_method :layer_messages

      def self.zero?(code)
        value = code.to_s
        !value.empty? && value.match?(/\A0+\z/)
      end

      def ok?
        self.class.zero?(code) || accepted_codes.include?(code)
      end

      # 登録自体は通ったが一部が落ちた状態。画面には成功と区別して出す。
      def warning?
        ok? && (warnings.any? || accepted_codes.include?(code))
      end

      def busy?
        code == BUSY
      end

      def status
        return "failed" unless ok?

        warning? ? "warning" : "succeeded"
      end

      private

      attr_reader :accepted_codes
    end
  end
end
