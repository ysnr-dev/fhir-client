module Master
  # HOTコードマスタの規格単位から、医薬品ごとの投与量換算行を一括生成する。
  #
  # 既に1行でも換算行を持つ医薬品は対象外にするため、手動でメンテした内容や
  # 前回の生成結果を上書きしない。何度実行しても未紐付けの医薬品だけが埋まる。
  class DoseConversionBuilder
    Result = Struct.new(
      :created_count, :medicine_count, :skipped_count, :unmapped_count, :needs_review_count,
      keyword_init: true
    )

    INSERT_SLICE = 1000

    def self.call
      new.call
    end

    def call
      mapped = Master::MedicineDoseConversion.distinct.pluck(:medicine_code).to_set
      standard_units = build_standard_unit_index

      rows = []
      medicine_count = 0
      skipped_count = 0
      unmapped_count = 0
      needs_review_count = 0

      medicine_columns.each do |code, unit_name, yakka_code, injection_volume|
        if mapped.include?(code)
          skipped_count += 1
          next
        end
        if unit_name.blank?
          unmapped_count += 1
          next
        end

        standard_unit = standard_units[:by_receipt][code] || standard_units[:by_yj][yakka_code]
        spec = standard_unit.presence && StandardUnitParser.parse(standard_unit)
        conversions = spec ? build_conversions(spec) : []
        if conversions.empty?
          unmapped_count += 1
          next
        end

        medicine_count += 1
        review = needs_review?(spec, unit_name, injection_volume, conversions)
        needs_review_count += 1 if review
        conversions.each do |from_unit, factor, source|
          rows << {
            medicine_code: code, from_unit: from_unit, factor: factor,
            to_unit: unit_name, source: source, needs_review: review
          }
        end
      end

      insert(rows)

      Result.new(
        created_count: rows.size, medicine_count: medicine_count, skipped_count: skipped_count,
        unmapped_count: unmapped_count, needs_review_count: needs_review_count
      )
    end

    private

    def medicine_columns
      Master::Medicine.pluck(:medicine_code, :unit_name, :yakka_code, :injection_volume)
    end

    # 規格単位はレセプト電算コード → 個別医薬品コード(YJ)の順に引く。統一名収載の
    # レコードなど販売名単位の HOT が無いものは、どちらでも引けず未紐付けになる。
    def build_standard_unit_index
      by_receipt = {}
      by_yj = {}
      Master::HotCode.where.not(standard_unit: [nil, ""])
                     .pluck(:receipt_code_1, :individual_medicine_code, :standard_unit)
                     .each do |receipt_code, yj_code, standard_unit|
        by_receipt[receipt_code] ||= standard_unit if receipt_code.present?
        by_yj[yj_code] ||= standard_unit if yj_code.present?
      end
      { by_receipt: by_receipt, by_yj: by_yj }
    end

    # 1医薬品ぶんの [入力単位, 係数, 導出根拠] の配列を返す。
    def build_conversions(spec)
      quantity = spec.pack_quantity.to_f
      return [] if quantity <= 0

      rows = []
      rows << strength_row(spec, quantity)
      rows << volume_row(spec, quantity)
      rows.compact!
      rows << [spec.pack_unit, 1.0, "identity"] if identity_row?(spec, rows)
      rows
    end

    # 力価行。規格単位に力価量が明示されていればそれを、無ければ濃度%から算出する。
    def strength_row(spec, quantity)
      return [spec.strength_unit, spec.strength_value / quantity, "explicit"] if spec.strength_value
      return nil if spec.concentration_pct.nil?

      # 濃度は %(w/v または w/w) なので 1% = 10mg/mL = 10mg/g。基準となる量は
      # 規格の容量、それが無ければ薬価算定単位そのもの(「２％１ｇ」など)。
      base = spec.volume_ml
      base ||= quantity if StandardUnitParser.quantity_unit?(spec.pack_unit)
      return nil if base.nil?

      ["mg", spec.concentration_pct * 10 * base / quantity, "from_percent"]
    end

    # 容量行。薬価算定単位が個数のときだけ意味を持つ(「２５０ｍＬ１袋」→ 250mL/袋)。
    def volume_row(spec, quantity)
      return nil if spec.volume_ml.nil? || StandardUnitParser.quantity_unit?(spec.pack_unit)

      ["mL", spec.volume_ml / quantity, "volume"]
    end

    # 薬価算定単位が量そのもの(生薬の g、内用液の mL など)なら、入力量がそのまま
    # 製剤量になる。同じ単位の行が既にある場合は作らない。
    def identity_row?(spec, rows)
      StandardUnitParser.quantity_unit?(spec.pack_unit) && rows.none? { |row| row[0] == spec.pack_unit }
    end

    def needs_review?(spec, unit_name, injection_volume, conversions)
      parsed = StandardUnitParser.canonical_unit(spec.pack_unit)
      return true if parsed != StandardUnitParser.canonical_unit(unit_name)

      # 医薬品マスタの注射容量と規格単位の容量が食い違うものは目視確認に回す。
      volume = injection_volume.to_f
      return false if volume.zero? || spec.volume_ml.nil?
      return false if conversions.none? { |row| row[0] == "mL" }

      (spec.volume_ml - volume).abs > 0.001
    end

    def insert(rows)
      return if rows.empty?

      now = Time.current
      timestamped = rows.map { |row| row.merge(created_at: now, updated_at: now) }
      Master::MedicineDoseConversion.transaction do
        timestamped.each_slice(INSERT_SLICE) { |slice| Master::MedicineDoseConversion.insert_all!(slice) }
      end
    end
  end
end
