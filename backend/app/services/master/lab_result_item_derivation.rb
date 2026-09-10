require "csv"

module Master
  # 検体検査の結果項目(master_lab_result_items)と、オーダー項目 → 結果項目の対応
  # (master_lab_order_item_results)の初期投入。migration(本番は Shell が無いので
  # 一回限りの処理は migration に畳む)と db/seeds.rb の両方から呼ぶ。
  #
  # 手順は 2 段。何度実行しても既存の行は上書きしない(施設で直した内容を戻さない)。
  #   A. 同梱 CSV の取込。単項目なのに複数の結果を返すオーダー項目(尿沈渣・血液ガス分析
  #      など)の分解を、結果項目と対応表の CSV で用意している。
  #   B. 1:1 の派生。対応表に 1 行も無い単項目オーダー項目から、同じコードの結果項目を
  #      作って対応づける。包括項目の構成項目(末梢血液一般検査 → 白血球数…)は seed で
  #      「コード-枝番」の単項目になっているので、これで CBC の各結果も覆える。
  #      オーダー項目に JLAC があれば、配布の共有項目JLACコードマスタからデータ型・単位・
  #      選択肢を写す。A で対応づいた項目には 1:1 の placeholder を作らない。
  class LabResultItemDerivation
    Result = Struct.new(:csv_items, :csv_mappings, :created, :mapped, :kept, keyword_init: true)

    ITEMS_CSV = "db/seed_data/lab_result_items.csv".freeze
    MAPPINGS_CSV = "db/seed_data/lab_order_item_results.csv".freeze

    # JLAC11 17 桁のうち材料コードの位置(10〜12 桁目)。
    JLAC11_LENGTH = 17
    SPECIMEN_CODE_RANGE = (9...12)

    ITEM_COLUMNS = %w[
      name short_name name_kana category specimen_code data_type display_unit ucum_unit
      code_value_list value_code_system decimal_places jlac11_code jlac10_code loinc_code
      valid_from valid_to display_order note
    ].freeze

    def self.call(items_csv: Rails.root.join(ITEMS_CSV), mappings_csv: Rails.root.join(MAPPINGS_CSV))
      new(items_csv, mappings_csv).call
    end

    def initialize(items_csv, mappings_csv)
      @items_csv = items_csv
      @mappings_csv = mappings_csv
      @result = Result.new(csv_items: 0, csv_mappings: 0, created: 0, mapped: 0, kept: 0)
    end

    def call
      ActiveRecord::Base.transaction do
        import_items_csv
        import_mappings_csv
        derive_one_to_one
      end
      @result
    end

    private

    def import_items_csv
      return unless File.exist?(@items_csv)

      CSV.foreach(@items_csv, headers: true) do |row|
        code = row["result_item_code"].to_s.strip
        next if code.blank? || row["name"].to_s.strip.blank?
        next if Master::LabResultItem.exists?(result_item_code: code)

        attrs = ITEM_COLUMNS.to_h { |column| [column, row[column].to_s.strip.presence] }
        attrs["data_type"] ||= "PQ"
        attrs["decimal_places"] = attrs["decimal_places"]&.to_i
        attrs["display_order"] = attrs["display_order"]&.to_i
        Master::LabResultItem.create!(attrs.merge("result_item_code" => code))
        @result.csv_items += 1
      end
    end

    def import_mappings_csv
      return unless File.exist?(@mappings_csv)

      CSV.foreach(@mappings_csv, headers: true) do |row|
        order_code = row["order_item_code"].to_s.strip
        result_code = row["result_item_code"].to_s.strip
        next if order_code.blank? || result_code.blank?
        next if Master::LabOrderItemResult.exists?(order_item_code: order_code, result_item_code: result_code)

        Master::LabOrderItemResult.create!(
          order_item_code: order_code,
          result_item_code: result_code,
          display_order: row["display_order"].to_s.strip.presence&.to_i
        )
        @result.csv_mappings += 1
      end
    end

    def derive_one_to_one
      Master::LabOrderItem.where(kind: "single").find_each do |order_item|
        code = order_item.order_item_code
        if Master::LabOrderItemResult.exists?(order_item_code: code)
          @result.kept += 1
          next
        end

        unless Master::LabResultItem.exists?(result_item_code: code)
          Master::LabResultItem.create!(result_item_attributes(order_item))
          @result.created += 1
        end
        Master::LabOrderItemResult.create!(order_item_code: code, result_item_code: code, display_order: 1)
        @result.mapped += 1
      end
    end

    def result_item_attributes(order_item)
      attrs = {
        result_item_code: order_item.order_item_code,
        name: order_item.name,
        short_name: order_item.short_name,
        name_kana: order_item.name_kana,
        category: order_item.category,
        specimen_code: order_item.specimen_code,
        valid_from: order_item.valid_from,
        valid_to: order_item.valid_to,
        display_order: order_item.display_order,
      }
      case order_item.jlac_code_system
      when "jlac11" then attrs[:jlac11_code] = order_item.jlac_code.presence
      when "jlac10" then attrs[:jlac10_code] = order_item.jlac_code.presence
      end
      apply_distributed_master(attrs, lab_item_for(order_item))
      if attrs[:specimen_code].blank? && attrs[:jlac11_code].to_s.length == JLAC11_LENGTH
        attrs[:specimen_code] = attrs[:jlac11_code][SPECIMEN_CODE_RANGE]
      end
      attrs
    end

    # 配布マスタの引き当て。JLAC10 はマスタ上で一意ではないので収載順で先に来たものを採る。
    def lab_item_for(order_item)
      return nil if order_item.jlac_code.blank?

      case order_item.jlac_code_system
      when "jlac11" then Master::LabItem.find_by(jlac11_code: order_item.jlac_code)
      when "jlac10" then Master::LabItem.where(jlac10_code: order_item.jlac_code).order(:id).first
      end
    end

    def apply_distributed_master(attrs, lab_item)
      return if lab_item.nil?

      attrs[:data_type] = lab_item.data_type.presence || "PQ"
      attrs[:display_unit] = lab_item.display_unit.presence
      attrs[:ucum_unit] = lab_item.xml_unit.presence
      attrs[:code_value_list] = lab_item.code_value_list.presence
      attrs[:value_code_system] = lab_item.code_oid.presence
      attrs[:jlac10_code] ||= lab_item.jlac10_code.presence
      attrs[:short_name] ||= lab_item.abbreviation.presence
    end
  end
end
