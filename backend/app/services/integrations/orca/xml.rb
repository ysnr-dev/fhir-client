require "nokogiri"

module Integrations
  module Orca
    # 日レセ API の xml2 形式の組立と読み取り。
    #
    # 形は 3 つしかない:
    #
    #   スカラ  <Patient_ID type="string">00001</Patient_ID>
    #   レコード <Diagnosis_Information type="record"> ... </Diagnosis_Information>
    #   配列    <Medical_Information type="array">
    #             <Medical_Information_child type="record"> ... </Medical_Information_child>
    #           </Medical_Information>
    #
    # Ruby 側は Hash =レコード / Array =配列 / それ以外 =スカラ で書けるようにする。
    # 配列の子要素名は「親の名前 + _child」で機械的に決まる。
    module Xml
      module_function

      # build("medicalreq", { "Patient_ID" => "1", ... }) => <data><medicalreq ...>
      def build(root_name, attributes)
        doc = Nokogiri::XML::Document.new
        doc.encoding = "UTF-8"
        data = doc.create_element("data")
        doc.root = data
        data.add_child(record_element(doc, root_name, attributes))
        doc.to_xml(indent: 2)
      end

      # 外側の包み。レスポンスは <xmlio2>、リクエストは <data> で包まれている。
      WRAPPERS = %w[xmlio2 data].freeze

      # レスポンス本文 → Hash。包みと最上位の record 名は剥がして中身だけ返す。
      #
      # 値の無い要素は nil ではなく "" になる(ORCA は空要素を頻繁に返し、
      # 呼び側で nil と "" の両方を気にしたくないため)。
      #
      # 必ず Hash を返す。認証に失敗したときの HTML エラーページのように、
      # XML として読めてしまうが中身が違うものを「空の応答」として弾くため
      # (文字列を返すと呼び側の empty? 判定をすり抜ける)。
      def parse(body)
        doc = Nokogiri::XML(body.to_s)
        root = doc.root
        return {} if root.nil?

        # <xmlio2><xxxres type="record"> の 2 段を剥がす。API によっては
        # 包みが無くいきなり res が来ることもあるので、両方に耐えるようにする。
        node = WRAPPERS.include?(root.name) ? root.element_children.first : root
        return {} if node.nil?

        value = read_value(node)
        value.is_a?(Hash) ? value : {}
      end

      # レスポンスの最上位レコード名(例 "medicalres")。どの API から返ったかの記録に使う。
      def response_record_name(body)
        doc = Nokogiri::XML(body.to_s)
        root = doc.root
        return nil if root.nil?

        WRAPPERS.include?(root.name) ? root.element_children.first&.name : root.name
      end

      # ---- 組立 ----

      def record_element(doc, name, attributes)
        element = doc.create_element(name, "type" => "record")
        Array(attributes).each do |key, value|
          child = value_element(doc, key.to_s, value)
          element.add_child(child) if child
        end
        element
      end
      private_class_method :record_element

      def value_element(doc, name, value)
        case value
        when nil then nil
        when Hash then record_element(doc, name, value)
        when Array then array_element(doc, name, value)
        else
          element = doc.create_element(name, "type" => "string")
          element.content = value.to_s
          element
        end
      end
      private_class_method :value_element

      def array_element(doc, name, values)
        element = doc.create_element(name, "type" => "array")
        values.each do |value|
          # 配列の要素はレコードとは限らない(文字列の並びもある)。
          child =
            if value.is_a?(Hash)
              record_element(doc, "#{name}_child", value)
            else
              value_element(doc, "#{name}_child", value)
            end
          element.add_child(child) if child
        end
        element
      end
      private_class_method :array_element

      # ---- 読み取り ----

      def read_value(node)
        case node["type"]
        when "array"
          node.element_children.map { |child| read_value(child) }
        when "record"
          node.element_children.each_with_object({}) do |child, acc|
            acc[child.name] = read_value(child)
          end
        else
          # type 属性が無くても子要素があるならレコードとして読む(実機は type を
          # 必ず付けてくるが、欠けていたときに中身を丸ごと落とさないため)。
          return node.text.to_s if node.element_children.empty?

          node.element_children.each_with_object({}) do |child, acc|
            acc[child.name] = read_value(child)
          end
        end
      end
      private_class_method :read_value
    end
  end
end
