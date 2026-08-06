module Master
  # HOTコードマスタの規格単位から、医薬品ごとの投与量換算行を一括生成する。
  #
  # 規格単位で1行も作れない医薬品には、医薬品マスタ側の情報で2段のフォールバックをかける。
  #   1. 医薬品名の規格(「アテノロール２５ｍｇ錠」の 25mg)から作る。規格単位を引けない
  #      一般名収載品と、規格単位に力価が無い貼付剤がここで埋まる。根拠が弱いので要確認。
  #   2. mL 行だけは、規格からも名前からも容量を読めなければ医薬品マスタの注射容量で補う。
  #
  # 既に1行でも換算行を持つ医薬品は対象外にするため、手動でメンテした内容や
  # 前回の生成結果を上書きしない。何度実行しても未紐付けの医薬品だけが埋まる。
  #
  # 例外は上記2の mL 行だけ。点滴の投与速度は RP の総量(mL)から計算するので、力価行しか
  # 持たない注射薬は速度が過小に出てしまう。手動でメンテした医薬品には触れないまま、
  # 自動生成行しか持たない医薬品にだけ後から mL 行を足す。
  class DoseConversionBuilder
    Result = Struct.new(
      :created_count, :medicine_count, :skipped_count, :unmapped_count, :needs_review_count,
      :volume_filled_count,
      keyword_init: true
    )

    INSERT_SLICE = 1000

    def self.call
      new.call
    end

    def call
      mapped = Master::MedicineDoseConversion.distinct.pluck(:medicine_code).to_set
      backfillable = volume_backfillable_codes
      standard_units = build_standard_unit_index

      rows = []
      medicine_count = 0
      skipped_count = 0
      unmapped_count = 0
      needs_review_count = 0
      volume_filled_count = 0

      medicine_columns.each do |code, unit_name, yakka_code, injection_volume, name|
        if mapped.include?(code)
          skipped_count += 1
          if backfillable.include?(code) && fill_volume?([], unit_name, injection_volume)
            volume_filled_count += 1
            rows << row_for(code, unit_name, injection_volume_row(injection_volume), review: false)
          end
          next
        end
        if unit_name.blank?
          unmapped_count += 1
          next
        end

        standard_unit = standard_units[:by_receipt][code] || standard_units[:by_yj][yakka_code]
        spec = standard_unit.presence && StandardUnitParser.parse(standard_unit)
        conversions = spec ? build_conversions(spec) : []

        from_name = conversions.empty?
        if from_name
          spec = StandardUnitParser.parse_name(name, unit_name)
          conversions = build_conversions(spec).map { |from_unit, factor, _| [from_unit, factor, "from_name"] }
        end
        if fill_volume?(conversions, unit_name, injection_volume)
          conversions << injection_volume_row(injection_volume)
        end
        if conversions.empty?
          unmapped_count += 1
          next
        end

        medicine_count += 1
        # 名前から作った行は規格単位ほど確度が高くないので、全件を目視確認に回す。
        review = from_name || needs_review?(spec, unit_name, injection_volume, conversions)
        needs_review_count += 1 if review
        conversions.each { |conversion| rows << row_for(code, unit_name, conversion, review: review) }
      end

      insert(rows)

      Result.new(
        created_count: rows.size, medicine_count: medicine_count, skipped_count: skipped_count,
        unmapped_count: unmapped_count, needs_review_count: needs_review_count,
        volume_filled_count: volume_filled_count
      )
    end

    private

    def medicine_columns
      Master::Medicine.pluck(:medicine_code, :unit_name, :yakka_code, :injection_volume, :name)
    end

    def row_for(code, unit_name, conversion, review:)
      from_unit, factor, source = conversion
      {
        medicine_code: code, from_unit: from_unit, factor: factor,
        to_unit: unit_name, source: source, needs_review: review
      }
    end

    # mL 行を後から足してよい医薬品。mL 行を既に持つものは当然対象外、手動でメンテした
    # 行を1つでも持つ医薬品も、消したのが意図的な可能性があるので触らない。
    def volume_backfillable_codes
      scope = Master::MedicineDoseConversion.select(:medicine_code, :from_unit, :source)
      excluded = Set.new
      codes = Set.new
      scope.each do |row|
        codes << row.medicine_code
        excluded << row.medicine_code if row.from_unit == "mL" || row.source == "manual"
      end
      codes - excluded
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

    # 医薬品マスタの注射容量は1薬価算定単位あたりの mL。規格からも名前からも容量を
    # 読めなかったときだけ使う(「２５０ｍｇ１瓶」の粉末には 0 が入っており対象外)。
    def fill_volume?(conversions, unit_name, injection_volume)
      return false if injection_volume.to_f <= 0
      return false if StandardUnitParser.quantity_unit?(StandardUnitParser.canonical_unit(unit_name))

      conversions.none? { |row| row[0] == "mL" }
    end

    def injection_volume_row(injection_volume)
      ["mL", injection_volume.to_f, "injection_volume"]
    end

    # 薬価算定単位が量そのもの(生薬の g、内用液の mL など)なら、入力量がそのまま
    # 製剤量になる。ただしマスタ単位での入力は換算行が無くても常に可能なので
    # (錠剤に 錠→錠 の行を作っていないのと同じ)、他に換算行を作れた医薬品には作らない。
    # 1行も作れない医薬品にだけ「確認済み・換算不要」の印として残す。
    def identity_row?(spec, rows)
      StandardUnitParser.quantity_unit?(spec.pack_unit) && rows.empty?
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
