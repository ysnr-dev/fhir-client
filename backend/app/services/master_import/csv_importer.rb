require "csv"

module MasterImport
  # CSV 配布マスタ共通の取込骨格。ファイルを 1 行ずつ読みながら、
  # 1トランザクションで全件洗い替え(delete_all + 1000件ずつ insert_all!)する。
  # 郵便番号マスタのような十数万行のファイルでも全行をメモリに載せないよう、
  # パース結果は配列に溜めずバッチ単位で流す。
  #
  # サブクラスは対象モデルと列定義を宣言するだけでよい:
  #
  #   self.model           = Master::Disease
  #   self.columns         = %i[...]                     # CSV の列順(列数の検査にも使う)
  #   self.encoding        = :cp932 | :utf8              # 既定 :cp932(Shift_JIS 系配布)
  #   self.headers         = true / false                # ヘッダー行の有無(既定 false)
  #   self.search_columns  = { search_name: :name, ... } # 正規化して埋める検索列 ← 元列
  #   self.decimal_columns = %i[price]                   # 空文字を nil に寄せる decimal 列
  #   self.dropped_columns = %i[reserved]                # 列数検査後に捨てる予備列
  #
  # 行ごとの追加加工が必要な importer は row_attrs をオーバーライドする。
  class CsvImporter
    Result = Struct.new(:imported_count, keyword_init: true)

    BATCH_SIZE = 1000

    class_attribute :model, instance_accessor: false
    class_attribute :columns, instance_accessor: false
    class_attribute :encoding, instance_accessor: false, default: :cp932
    class_attribute :headers, instance_accessor: false, default: false
    class_attribute :search_columns, instance_accessor: false, default: {}
    class_attribute :decimal_columns, instance_accessor: false, default: []
    class_attribute :dropped_columns, instance_accessor: false, default: []

    def self.call(file)
      new(file).call
    end

    def initialize(file)
      @file = file
    end

    def call
      model = self.class.model
      imported_count = 0

      ActiveRecord::Base.transaction do
        model.delete_all
        each_row.each_slice(BATCH_SIZE) do |slice|
          model.insert_all!(slice)
          imported_count += slice.size
        end
      end

      Result.new(imported_count: imported_count)
    end

    private

    attr_reader :file

    # 1行分の属性を順に返す。溜め込まないので呼び出し側で each_slice すればよい。
    def each_row
      return enum_for(:each_row) unless block_given?

      now = Time.current
      config = self.class

      open_csv do |csv|
        csv.each.with_index do |row, index|
          values = config.headers ? row.fields : row.to_a

          if values.size != config.columns.size
            # エラーは実ファイル上の行番号で示す(ヘッダー行がある場合は +2)。
            line = index + (config.headers ? 2 : 1)
            raise ImportError, "row #{line}: expected #{config.columns.size} columns, got #{values.size}"
          end

          yield row_attrs(config.columns.zip(values).to_h, now)
        end
      end
    end

    # 1行分の属性。宣言だけで済まない加工を持つ importer はここをオーバーライドする。
    def row_attrs(attrs, now)
      config = self.class
      config.dropped_columns.each { |column| attrs.delete(column) }
      # 空文字のまま decimal 列へ入れると型変換で落ちるので nil に寄せる。
      config.decimal_columns.each { |column| attrs[column] = attrs[column].presence }
      # insert_all! はモデルのコールバックを通らないため、検索用カラムはここで埋める。
      config.search_columns.each do |search_column, source_column|
        attrs[search_column] = Master::SearchNormalizer.normalize(attrs[source_column])
      end
      attrs.merge(created_at: now, updated_at: now)
    end

    # 仕様書の指定どおり Windows-31J(CP932) を、UTF-8 配布は BOM を剥がして読む。
    # 変換は読み出し時に任せ、ファイル全体を文字列に起こさない。
    def open_csv
      mode = self.class.encoding == :cp932 ? "rb:CP932:UTF-8" : "rb:BOM|UTF-8"
      path = file.try(:path)

      if path
        File.open(path, mode) { |io| yield CSV.new(io, headers: self.class.headers) }
      else
        # path を持たない IO(StringIO など)は読み切ってから同じ変換をかける。
        yield CSV.new(StringIO.new(csv_text), headers: self.class.headers)
      end
    end

    def csv_text
      if self.class.encoding == :cp932
        file.read.force_encoding("CP932").encode("UTF-8")
      else
        file.read.force_encoding("UTF-8").delete_prefix("\xEF\xBB\xBF")
      end
    end
  end
end
