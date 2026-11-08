module Reports
  # Composition.section.text.div(XHTML)を帳票に刷る段落の配列にする。
  # 文字の装飾(太字・色・大きさ)は落とし、段落・改行・箇条書き・表の行だけを残す。
  # 画像は帳票に貼らず「［画像］」と書いて、本文に画像があったことだけ分かるようにする。
  module XhtmlText
    BLOCK_ELEMENTS = %w[p div h1 h2 h3 h4 h5 h6 blockquote pre table tr ul ol].freeze
    IMAGE_MARK = "［画像］".freeze

    module_function

    # 段落の配列。空の段落(空行)は 1 つにまとめ、先頭と末尾の空行は落とす。
    def paragraphs(div)
      return [] if div.blank?

      lines = [+""]
      walk(Nokogiri::XML.fragment(div.to_s), lines)
      squeeze(lines.map { |line| line.gsub(/[ \t\r\n]+/, " ").strip })
    end

    def walk(node, lines)
      node.children.each do |child|
        if child.text?
          lines.last << child.text
          next
        end
        next unless child.element?

        name = child.name.downcase
        case name
        when "br"
          lines << +""
        when "img"
          lines.last << IMAGE_MARK
        when "li"
          break_line(lines)
          lines.last << list_marker(child)
          walk(child, lines)
          break_line(lines)
        when "td", "th"
          lines.last << "　" unless lines.last.empty?
          walk(child, lines)
        else
          block = BLOCK_ELEMENTS.include?(name)
          break_line(lines) if block
          walk(child, lines)
          if block
            # 中身の無い段落は空行として残す(本文の段落の間の空行)。
            lines << +"" if lines.last.empty? && name == "p"
            break_line(lines)
          end
        end
      end
    end

    def break_line(lines)
      lines << +"" unless lines.last.empty?
    end

    def list_marker(item)
      return "・" unless item.parent&.name&.downcase == "ol"

      "#{item.parent.element_children.index(item).to_i + 1}. "
    end

    def squeeze(lines)
      result = []
      lines.each do |line|
        next if line.empty? && (result.empty? || result.last.empty?)

        result << line
      end
      result.pop while result.last&.empty?
      result
    end
  end
end
