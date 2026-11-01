require "rqrcode"

module Reports
  # 処方箋 QR コードの画像(docs/prescription-report-design.md §7)。
  #
  # JAHIS の規約は QR コード モデル 2、誤り訂正レベル L 以上、セル 0.25mm 以上を求める。
  # レイアウトの枠(一辺 120pt ≒ 42mm)に収めるので、版を 30(137 セル)までに抑えてセルを
  # 0.29mm 以上に保ち、入り切らない処方は QR コードの連結(structured append)で分割する。
  # 分割はレコード(行)の境で行い、各シンボルの大きさをなるべく揃える。
  class PrescriptionQrSymbols
    LEVEL = :m
    MAX_VERSION = 30
    # 連結で繋げられるシンボルの上限(QR コードの仕様)。
    MAX_SYMBOLS = 16
    # 連結ヘッダ: モード指示子 4 + シンボル位置 4 + 総数 4 + パリティ 8。
    STRUCTURED_APPEND_BITS = 20
    # 8 ビットバイトモードの文字数指示子(版 10 以上は 16 ビット)。
    BYTE_COUNT_BITS = 16
    MODE_BITS = 4
    # 画像の 1 セルのピクセル数。枠より大きく描いて縮めるので、枠が一辺の実寸になる。
    MODULE_PX = 6
    QUIET_ZONE_MODULES = 4

    # 連結の上限を超える(現実の処方では起きない)。
    class TooLarge < StandardError; end

    # 1 シンボルに入るバイト数。rqrcode は「必要ビット < 上限ビット」で版を決めるので 1 バイト引く。
    def self.capacity
      (RQRCodeCore::QRMAXBITS.fetch(LEVEL)[MAX_VERSION - 1] - MODE_BITS - BYTE_COUNT_BITS - STRUCTURED_APPEND_BITS) / 8 - 1
    end

    # lines: Shift_JIS の行(CRLF 付き)の配列
    def initialize(lines)
      @lines = lines
    end

    # 各シンボルの PNG(バイト列)。
    def pngs
      parts = chunks
      parity = @lines.join.each_byte.reduce(0, :^)
      parts.each_with_index.map do |part, index|
        segment =
          if parts.size == 1
            RQRCodeCore::QRSegment.new(data: part, mode: :byte_8bit)
          else
            StructuredAppendSegment.new(data: part, position: index, total: parts.size, parity: parity)
          end
        RQRCode::QRCode.new(segment, level: LEVEL, max_size: MAX_VERSION)
                       .as_png(module_px_size: MODULE_PX, border_modules: QUIET_ZONE_MODULES).to_s
      end
    end

    # 行をシンボルごとに分ける。まず 1 シンボルの上限いっぱいに詰めてシンボル数を決め、
    # その数のまま各シンボルがなるべく同じ大きさになる目安(1 シンボルあたりのバイト数)を
    # 二分探索で探す。
    def chunks
      capacity = self.class.capacity
      @lines.each { |line| raise TooLarge, "record exceeds a symbol" if line.bytesize > capacity }
      fullest = pack(capacity)
      raise TooLarge, "prescription needs more than #{MAX_SYMBOLS} symbols" if fullest.size > MAX_SYMBOLS
      return fullest if fullest.size <= 1

      low = (@lines.sum(&:bytesize).to_f / fullest.size).ceil
      high = capacity
      while low < high
        middle = (low + high) / 2
        pack(middle).size <= fullest.size ? high = middle : low = middle + 1
      end
      pack(low)
    end

    private

    def pack(target)
      parts = [+""]
      @lines.each do |line|
        parts << +"" if parts.last.bytesize.positive? && parts.last.bytesize + line.bytesize > target
        parts.last << line
      end
      parts.map { |part| part.force_encoding(PrescriptionQrData::ENCODING) }
    end

    # QR コードの連結(structured append)。8 ビットバイトのセグメントの前に連結ヘッダを置く。
    # rqrcode_core は連結を持たないので、セグメントの大きさの計算と書き出しだけを足している。
    class StructuredAppendSegment < RQRCodeCore::QRSegment
      MODE_STRUCTURED_APPEND = 0b0011

      def initialize(data:, position:, total:, parity:)
        super(data: data, mode: :byte_8bit)
        @position = position
        @total = total
        @parity = parity
      end

      def size(version)
        super + STRUCTURED_APPEND_BITS
      end

      def writer
        Writer.new(data, @position, @total, @parity)
      end

      class Writer
        def initialize(data, position, total, parity)
          @data = data
          @position = position
          @total = total
          @parity = parity
        end

        def write(buffer)
          buffer.put(MODE_STRUCTURED_APPEND, 4)
          buffer.put(@position, 4)
          buffer.put(@total - 1, 4)
          buffer.put(@parity, 8)
          RQRCodeCore::QR8bitByte.new(@data).write(buffer)
        end
      end
    end
  end
end
