require "prawn"
require "stringio"

module Reports
  # 様式テンプレート(DocumentTemplate kind=form)の表示用 PDF。ページ画像を敷き、その上に
  # フィールドの値を描く。値は画面が表示用に整形した文字列をそのまま受け取る
  # (選択肢の表示・チェックの印・和暦などの整形は frontend の fhir/documentFormLayout.ts に一元化)。
  #
  # 座標は layout の px をページ寸法(pt)との比で換算する。文字は箱に収まるよう縮める
  # (shrink_to_fit)ので、画面と PDF で折返し位置が多少違っても箱からはみ出さない。
  class DocumentFormRenderer
    class InvalidRequest < StandardError; end

    FONT_NAME = "IPAPGothic".freeze
    FONT_PATH = Pathname.new(Gem.loaded_specs["thinreports"].full_gem_path).join("fonts", "ipagp.ttf").freeze
    MIN_FONT_SIZE = 5
    # textarea は上揃え、1 行の項目は箱の縦中央に置く(紙の罫線の中に入るように)。
    MULTILINE_TYPES = %w[textarea].freeze
    MAX_TEXT_LENGTH = 5_000

    # values: { field id => 表示文字列 }
    def initialize(template:, values:)
      @template = template
      @values = values
    end

    def render
      pdf = Prawn::Document.new(skip_page_creation: true, margin: 0, compress: true)
      pdf.font_families.update(FONT_NAME => { normal: FONT_PATH.to_s })

      fields_by_page = @template.fields.group_by { |field| field["page"] }
      @template.pages.ordered.each do |page|
        width = page.width_pt.to_f
        height = page.height_pt.to_f
        pdf.start_new_page(size: [ width, height ], margin: 0)
        # フォントの切り替えはページが無いと例外になるので、最初のページを作ってから行う。
        pdf.font(FONT_NAME)
        pdf.image(StringIO.new(page.data), at: [ 0, height ], width: width, height: height)

        scale = width / page.width_px
        (fields_by_page[page.page_number] || []).each do |field|
          draw_field(pdf, field, scale, height)
        end
      end
      pdf.render
    end

    private

    def draw_field(pdf, field, scale, page_height)
      text = @values[field["id"]].to_s
      at = [ field["x"] * scale, page_height - field["y"] * scale ]
      width = field["w"] * scale
      height = field["h"] * scale
      # 塗りつぶしの項目は、値が空でも枠内の雛形の印字を隠す(入力画面と同じ見た目にする)。
      mask(pdf, at, width, height) if field["mask"]
      return if text.empty?

      raise InvalidRequest, "値が長すぎます(#{field['id']})" if text.length > MAX_TEXT_LENGTH

      pdf.text_box(
        text,
        at: at,
        width: width,
        height: height,
        size: field["font_size"].to_f,
        align: (field["align"] || "left").to_sym,
        valign: MULTILINE_TYPES.include?(field["type"]) ? :top : :center,
        overflow: :shrink_to_fit,
        min_font_size: MIN_FONT_SIZE
      )
    end

    def mask(pdf, at, width, height)
      pdf.save_graphics_state do
        pdf.fill_color "FFFFFF"
        pdf.fill_rectangle at, width, height
      end
      pdf.fill_color "000000"
    end
  end
end
