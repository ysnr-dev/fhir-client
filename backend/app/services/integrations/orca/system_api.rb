module Integrations
  module Orca
    # system01lstv2(システム管理情報)。診療科とドクターの一覧を取る。
    #
    # コード対応付け画面の候補と、接続テストに使う。ORCA 側のマスタなので
    # 1 リクエスト中で何度も引かないよう、呼び側でまとめて取得する。
    class SystemApi
      PATH = "/api01rv2/system01lstv2".freeze

      # Request_Number。01=診療科 02=ドクター 04=医療機関基本情報。
      DEPARTMENT = "01".freeze
      PHYSICIAN = "02".freeze
      INSTITUTION = "04".freeze

      Department = Struct.new(:code, :name, :receipt_code, keyword_init: true)
      Physician = Struct.new(:code, :name, :kana, :license_number, keyword_init: true)

      def initialize(gateway)
        @gateway = gateway
      end

      def departments
        body = fetch(DEPARTMENT)
        Array(body["Department_Information"]).map do |row|
          Department.new(
            code: row["Code"],
            name: row["WholeName"].presence || row["Name1"],
            receipt_code: row["Receipt_Code"]
          )
        end
      end

      def physicians
        body = fetch(PHYSICIAN)
        Array(body["Physician_Information"]).map do |row|
          Physician.new(
            code: row["Code"],
            name: row["WholeName"],
            kana: row["WholeName_inKana"],
            license_number: row["Physician_Permission_Id"]
          )
        end
      end

      # 医療機関基本情報。接続テストで「どこに繋がっているか」を見せるために使う。
      def institution
        info = fetch(INSTITUTION)["Medical_Information"]
        return {} unless info.is_a?(Hash)

        {
          name: info["Institution_WholeName"].presence,
          # 保険医療機関番号は 10 桁 = 都道府県 2 + 点数表 1 + 医療機関コード 7。
          # ORCA は 3 つに分けて持っているので、自院 Organization の identifier と
          # 突き合わせられる形に組み直す。
          institution_number: institution_number(info),
          institution_code: info["Institution_Code"].presence
        }.compact
      end

      private

      def institution_number(info)
        prefecture = info["Prefectures_Number"].to_s
        point_list = info["Point_list"].to_s
        code = info["Institution_Code"].to_s
        return nil if prefecture.empty? || point_list.empty? || code.empty?

        "#{prefecture.rjust(2, '0')}#{point_list}#{code.rjust(7, '0')}"
      end

      attr_reader :gateway

      def fetch(request_number)
        result = gateway.post(PATH, "system01_managereq", { "Request_Number" => request_number })
        # 11 は「対象がありません」。職員未登録の初期状態なので空配列として扱う。
        return {} if result.api_result.code == "11"
        raise Gateway::InvalidResponse, result.api_result.message unless result.ok?

        result.body
      end
    end
  end
end
