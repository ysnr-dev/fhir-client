module Integrations
  module Orca
    # 中立の会計明細 → 日レセの Medical_Information。
    #
    # 診療種別区分(Medical_Class)は日レセが剤をまとめる単位で、点数表の部に対応する。
    # 手技の行は点数表の区分番号(章記号)から区分を決め、薬剤・材料・コメントの行は
    # 直前の手技の区分に付ける(処置の薬剤は処置の剤に入る)。1 つの剤の中で区分が
    # 変わったら剤を切る(手術の実施記録に並ぶ麻酔 L 章は 540 の別の剤になる)。
    # 手技の行が無い剤は、種別の既定の区分に落ちる。
    module MedicalMessage
      # 日レセの上限(reference/record/xml_medicalv2req.db)。
      MAX_CLASSES = 40
      MAX_LINES = 40

      # 種別の既定の区分。手技の区分番号が引けないときの落としどころ。
      MEDICAL_CLASS = {
        oral: "210", as_needed: "220", topical: "230",
        treatment: "400", surgery: "500",
        lab: "600", micro: "600", physio: "600", endoscopy: "600",
        rad: "700"
      }.freeze

      # 点数表の章 → 診療種別区分(実機の点数マスタ srysyukbn で確認)。
      # A(初・再診)は Medical_Fee_Auto で日レセが算定するので送らない。
      # F(投薬)と G(注射)は剤の組み方が別なので章では決めない。
      CHAPTER_CLASS = {
        "B" => "130", "C" => "140", "D" => "600", "E" => "700", "H" => "800", "I" => "830",
        "J" => "400", "K" => "500", "L" => "540", "M" => "840", "N" => "640"
      }.freeze
      # 手術の章のうち輸血(K920〜K924)は 510。
      TRANSFUSION_SECTIONS = ("K920".."K924").to_a.freeze

      # 注射の区分。手技(JAMI 詳細用法コードの注射手技)で決め、点滴は 330、
      # 中心静脈は 350。手技が無ければ投与経路(JP Core route-codes)から、それも無ければ
      # その他注射 340。手技料(静脈内注射など)は区分から日レセが算定するので送らない。
      INJECTION_METHOD_CLASS = {
        "30" => "320", # 静脈注射
        "31" => "350", # 中心静脈注射
        "32" => "310", # 皮下注射
        "33" => "310", # 筋肉内注射
        "34" => "310"  # 皮内注射
      }.freeze
      INJECTION_ROUTE_CLASS = { "IV" => "320", "IM" => "310", "SC" => "310", "ID" => "310" }.freeze
      INJECTION_DRIP = "drip".freeze

      CLASS_NAMES = {
        "110" => "初診", "120" => "再診", "130" => "医学管理", "140" => "在宅",
        "210" => "内服", "220" => "頓服", "230" => "外用",
        "310" => "皮下筋肉内注射", "320" => "静脈内注射", "330" => "点滴注射",
        "340" => "その他注射", "350" => "中心静脈注射",
        "400" => "処置", "500" => "手術", "510" => "輸血", "540" => "麻酔",
        "600" => "検査", "640" => "病理診断", "700" => "画像診断",
        "800" => "リハビリ", "830" => "精神科専門療法", "840" => "放射線治療"
      }.freeze

      # コメントコードの送り方はコードの先頭 3 桁で決まる(仕様書 comment842-830-bui-api)。
      NUMBER_COMMENT_PREFIX = "842".freeze
      TEXT_COMMENT_PREFIX = "830".freeze
      FREE_COMMENT_CODE = "810000001".freeze
      TEXT_COMMENT_CHARS = 50
      FREE_COMMENT_BYTES = 80

      # 剤 1 つ。lines は中立の BillingLine。
      Group = Struct.new(:item, :medical_class, :lines, keyword_init: true)

      module_function

      # 送れない明細は捨てず、理由つきで second の配列に返す。
      def build(items)
        groups, dropped = split(items)
        classes = groups.map do |group|
          {
            "Medical_Class" => group.medical_class,
            "Medical_Class_Name" => group.item.name,
            "Medical_Class_Number" => group.item.count.presence || group.item.days.presence || "1",
            "Medication_info" => group.lines.first(MAX_LINES).flat_map { |line| medications(line, group.item) }
          }
        end

        if classes.length > MAX_CLASSES
          classes[MAX_CLASSES..].each do |entry|
            dropped << { kind: "剤", name: entry["Medical_Class_Name"],
                         reason: "1 回に送れる剤は #{MAX_CLASSES} までです" }
          end
          classes = classes.first(MAX_CLASSES)
        end

        [classes, dropped]
      end

      # 中立の剤を日レセの剤(区分ごと)に分ける。画面の表示にも使う。
      def split(items)
        groups = []
        dropped = []

        items.each do |item|
          default_class = item.category == :injection ? injection_class(item) : MEDICAL_CLASS[item.category]
          current = nil

          item.lines.each do |line|
            medical_class = class_of(line, current&.medical_class, default_class)
            if medical_class.nil?
              dropped << { kind: item.category.to_s, name: line.name.presence || item.name,
                           reason: drop_reason(line) }
              next
            end

            if current.nil? || current.medical_class != medical_class
              current = Group.new(item: item, medical_class: medical_class, lines: [])
              groups << current
            end
            current.lines << line
          end
        end

        [groups, dropped]
      end

      def class_name(medical_class) = CLASS_NAMES[medical_class] || medical_class

      def injection_class(item)
        return "350" if item.method == "31"
        return "330" if item.usage_type == INJECTION_DRIP
        return INJECTION_METHOD_CLASS[item.method] || "340" if item.method.present?

        INJECTION_ROUTE_CLASS[item.route] || "340"
      end

      # 手技は区分番号の章で決め、それ以外は直前の手技(無ければ既定)に付ける。
      def class_of(line, previous_class, default_class)
        return previous_class || default_class unless line.kind == :procedure && line.section.present?

        chapter = line.section[0]
        return nil if chapter == "A"
        return "510" if TRANSFUSION_SECTIONS.include?(line.section)

        CHAPTER_CLASS[chapter] || default_class
      end

      def drop_reason(line)
        if line.kind == :procedure && line.section.to_s.start_with?("A")
          "初診・再診料は日レセが自動算定するため送りません"
        else
          "日レセの診療種別区分に対応がありません"
        end
      end

      def medications(line, item)
        return [medication(line, item)] unless line.kind == :comment

        comment_medications(line)
      end

      # Medication_Usage_Code は medicalmodv2 の公開仕様書のリクエスト項目に無い。実機の
      # レコード定義(reference/record/xml_medicalv2req.db)には在り、電子処方箋の 16 桁用法
      # コードがそのまま通ることを確認して使っている。仕様どおりに用法コードを明細 1 行として
      # 送るには日レセ側の用法マスタに同じコードが要り、無ければ M01 で行ごと落ちる。
      def medication(line, item)
        {
          "Medication_Code" => line.code,
          "Medication_Name" => line.name,
          "Medication_Usage_Code" => item.usage_code,
          "Medication_Number" => line.quantity
        }.compact_blank
      end

      # 842 は数値を Medication_Number に、830 は文だけを Medication_Name に(全角 50 文字
      # ごとに明細を分けて連続設定)、フリーコメントは 80 バイトまで(超過分は切る)。
      def comment_medications(line)
        code = line.code.to_s
        if code.start_with?(NUMBER_COMMENT_PREFIX)
          [{ "Medication_Code" => code, "Medication_Name" => line.name, "Medication_Number" => line.quantity }.compact_blank]
        elsif code.start_with?(TEXT_COMMENT_PREFIX)
          line.name.to_s.scan(/.{1,#{TEXT_COMMENT_CHARS}}/m).map do |chunk|
            { "Medication_Code" => code, "Medication_Name" => chunk }
          end
        else
          [{ "Medication_Code" => code, "Medication_Name" => truncate_bytes(line.name.to_s, FREE_COMMENT_BYTES) }]
        end
      end

      # 日レセは全角を 2 バイトで数える。UTF-8 のバイト数ではなく、ASCII を 1、それ以外を 2 で数える。
      def truncate_bytes(text, limit)
        used = 0
        text.each_char.take_while do |char|
          used += char.ascii_only? ? 1 : 2
          used <= limit
        end.join
      end
    end
  end
end
