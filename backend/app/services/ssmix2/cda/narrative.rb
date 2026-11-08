module Ssmix2
  module Cda
    # 診療記録のセクション本文(FHIR Narrative の XHTML)を CDA の説明ブロック(NarrativeBlock)に写す。
    # 段落・改行・装飾・箇条書き・表を対応する要素にし、埋め込み画像(data: URI)は renderMultiMedia にして
    # observationMedia の entry に回す(経過記録規約 4.2.7)。規約に無い装飾(色・大きさ・取り消し線・リンク)は文字だけ残す。
    class Narrative
      PARAGRAPHS = %w[p blockquote pre].freeze
      HEADINGS = %w[h1 h2 h3 h4 h5 h6].freeze
      STYLES = { "strong" => "Bold", "b" => "Bold", "em" => "Italics", "i" => "Italics", "u" => "Underline" }.freeze
      PLAIN_INLINE = %w[s del strike code span a mark small kbd var cite q abbr time font].freeze
      LISTS = { "ul" => "unordered", "ol" => "ordered" }.freeze
      TABLE_ELEMENTS = %w[table thead tbody tfoot tr th td caption].freeze
      CELL_ATTRIBUTES = %w[colspan rowspan].freeze
      DATA_IMAGE = %r{\Adata:(image/[\w.+-]+);base64,(.+)\z}m

      Image = Struct.new(:id, :media_type, :data, keyword_init: true)

      # xml は組み立て中の Nokogiri::XML::Builder(section/text の中で呼ぶ)。images に見つけた画像を足す。
      # counter は文書全体で画像の ID(MM1, MM2, …)を重ねないための Enumerator。
      def initialize(xml, images:, warnings:, counter:)
        @xml = xml
        @images = images
        @warnings = warnings
        @counter = counter
      end

      def render(div)
        root = parse(div)
        return if root.nil?

        root.children.each { |child| emit(child) }
      end

      private

      attr_reader :xml

      # frontend は XMLSerializer で well-formed な XHTML を書くが、他システム由来の narrative は HTML として読み直す。
      def parse(div)
        return nil if div.blank?

        Nokogiri::XML(div, &:strict).root
      rescue Nokogiri::XML::SyntaxError
        Nokogiri::HTML::DocumentFragment.parse(div)
      end

      def emit(node)
        case node
        when Nokogiri::XML::Text then emit_text(node)
        when Nokogiri::XML::Element then emit_element(node)
        end
      end

      def emit_text(node)
        text = node.text
        return if text.strip.empty? && text.include?("\n")

        xml.text(text)
      end

      def emit_element(node)
        name = node.name.downcase
        case name
        when "br" then xml.br
        when "hr" then nil
        when "img" then emit_image(node)
        when *PARAGRAPHS then xml.paragraph { children(node) }
        when *HEADINGS then xml.paragraph(styleCode: "Bold") { children(node) }
        when *STYLES.keys then xml.content(styleCode: STYLES[name]) { children(node) }
        when *PLAIN_INLINE then xml.content { children(node) }
        when *LISTS.keys then xml.list(listType: LISTS[name]) { list_items(node) }
        when "li" then xml.item { children(node) }
        when "sub", "sup" then xml.send(name) { children(node) }
        when *TABLE_ELEMENTS then xml.send(name, cell_attributes(node)) { children(node) }
        else children(node)
        end
      end

      def children(node)
        node.children.each { |child| emit(child) }
      end

      # list の直下は item だけ。li 以外の子は item で包む。
      def list_items(node)
        node.children.each do |child|
          if child.is_a?(Nokogiri::XML::Element) && child.name.downcase == "li"
            emit(child)
          elsif child.is_a?(Nokogiri::XML::Element) || !child.text.strip.empty?
            xml.item { emit(child) }
          end
        end
      end

      def warn(message)
        @warnings << message unless @warnings.include?(message)
      end

      def cell_attributes(node)
        CELL_ATTRIBUTES.each_with_object({}) do |attribute, attrs|
          attrs[attribute] = node[attribute] if node[attribute].present?
        end
      end

      def emit_image(node)
        match = node["src"].to_s.match(DATA_IMAGE)
        if match.nil?
          warn("埋め込みでない画像は出力しませんでした: #{node['src'].to_s.first(80)}")
          return
        end

        image = Image.new(id: "MM#{@counter.next}", media_type: match[1], data: match[2].gsub(/\s+/, ""))
        @images << image
        xml.renderMultiMedia(referencedObject: image.id)
      end
    end
  end
end
