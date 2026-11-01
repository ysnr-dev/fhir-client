module Reports
  # 院外処方箋の QR コードに記録する CSV(JAHIS 院外処方箋2次元シンボル記録条件規約 Ver.1.11、
  # JAHIS 技術文書 26-101。docs/prescription-report-design.md §7)。
  #
  # 1 レコード = 1 行(カンマ区切り、CRLF 終端)で、先頭はバージョン、続いて医療機関/医師/患者/保険/
  # 交付日/備考、RP ごとに 剤形(101)・用法(111)・用法補足(181)・薬品(201)・不均等(221)・
  # 1回服用量(241)・薬品補足(281)。文字コードは Shift_JIS(Windows-31J)。
  #
  # 紙の処方箋に書いていない情報は入れない(規約の前提条件)。保険情報は扱っていないので、
  # 保険者番号(22)は「番号なし」、記号番号(23)は記号・番号を空にした必須レコードだけを置く。
  class PrescriptionQrData
    VERSION = "JAHIS11".freeze
    CRLF = "\r\n".freeze
    ENCODING = "Windows-31J".freeze
    # Windows-31J に無い文字の置き換え(規約の外字の扱いと同じ「■」)。
    REPLACEMENT = "■".freeze
    # Unicode と Windows-31J で対応がずれる記号を寄せてから符号化する。
    NORMALIZE = { "〜" => "～", "−" => "－", "‖" => "∥", "¢" => "￠", "£" => "￡", "¬" => "￢" }.freeze

    # 剤形区分(101)。
    FORM_ORAL = 1
    FORM_AS_NEEDED = 2
    FORM_TOPICAL = 3
    FORM_INJECTION = 5
    FORM_UNKNOWN = 9
    # 用法マスタの基本用法区分コード → 剤形区分。「注入」は規約に無いので不明(名称付き)。
    FORM_BY_USAGE_CATEGORY = { "1" => FORM_ORAL, "2" => FORM_TOPICAL, "3" => FORM_INJECTION }.freeze
    USAGE_CATEGORY_NAMES = { "4" => "注入" }.freeze
    # 用法コード種別(111): 2 = JAMI 用法コード(厚労省 電子処方箋用法マスタの 16 桁)。
    USAGE_CODE_JAMI = 2
    USAGE_CODE_NONE = 1
    # 用法補足区分(181)。調剤指示の一包化・粉砕は区分を持ち、別包化・混合は不明(空)で名称だけ。
    DISPENSE_SUPPLEMENT_KINDS = { "OP" => 2, "C" => 4 }.freeze
    SUPPLEMENT_JAMI = 8
    # 薬品コード種別(201)。
    CODE_KIND_NONE = 1
    CODE_KIND_RECEIPT = 2
    CODE_KIND_GENERIC = 7
    # 情報区分(201)。レセプト電算コードの先頭 7 は特定器材。
    INFO_MEDICINE = 1
    INFO_MATERIAL = 2
    # 力価フラグ(201)。
    DOSE_PRICE_UNIT = 1
    DOSE_POTENCY = 2
    # 薬品補足区分(281)。
    SUBSTITUTION_SUPPLEMENTS = {
      PrescriptionReport::MEDICAL_NECESSITY => [3, "後発品変更不可"],
      PrescriptionReport::PATIENT_REQUEST => [8, "先発医薬品患者希望"]
    }.freeze
    GENDER_CODES = { "male" => 1, "female" => 2 }.freeze
    UNDER_SIX = 3
    INSURED_SELF = 1
    # 桁数(文字数)の上限。超えた分は切る。
    LIMITS = {
      hospital_name: 60, address: 50, department: 40, doctor: 20, patient_name: 20, patient_kana: 40,
      remark: 50, usage_name: 50, supplement: 50, medicine_name: 40, unit: 6
    }.freeze

    def initialize(order:, patient:, organization:, rps:)
      @order = order
      @patient = patient
      @organization = organization || {}
      @rps = rps
    end

    # レコードの配列(各レコードは項目の配列)。spec と records_sjis の元。
    def records
      [[VERSION]] + institution_records + patient_records + insurance_records +
        [[51, ymd(PrescriptionMeta.issue_date(@order))]] + remark_records + @rps.flat_map { |rp| rp_records(rp) }
    end

    # Shift_JIS に符号化した行(CRLF 付き)の配列。QR への分割はレコードの境で行う。
    def lines
      records.map { |record| encode(record.map { |field| field_text(field) }.join(",") + CRLF) }
    end

    def to_s
      lines.join
    end

    private

    # ---- 医療機関/医師 ----

    def institution_records
      number = PrescriptionMeta.institution_number(@organization)
      address = @organization.dig("address", 0) || {}
      records = [
        [1, number[:table_no], number[:inst_no], number[:pref_no], cut(@organization["name"], :hospital_name)]
      ]
      postal = postal_code(address["postalCode"])
      if postal.present? || address["text"].present?
        records << [2, postal, cut(address["text"], :address)]
      end
      tel = PrescriptionMeta.telecom_value(@organization, "phone")
      records << [3, tel, PrescriptionMeta.telecom_value(@organization, "fax"), ""] if tel.present?
      department = PrescriptionMeta.department_name(@order)
      records << [4, 1, "", cut(department, :department)] if department.present?
      records << [5, "", "", cut(PrescriptionMeta.doctor_name(@order), :doctor)]
    end

    # 郵便番号は「数字 3 桁-数字 4 桁」。
    def postal_code(value)
      digits = value.to_s.delete("^0-9")
      return "#{digits[0, 3]}-#{digits[3, 4]}" if digits.length == 7

      value.to_s.strip
    end

    # ---- 患者 ----

    def patient_records
      records = [
        [11, PatientMeta.identifier(@patient), cut(PatientMeta.display_name(@patient), :patient_name),
         cut(HalfWidthKana.convert(PatientMeta.display_kana(@patient)), :patient_kana)],
        [12, GENDER_CODES[@patient["gender"]]],
        [13, ymd(@patient["birthDate"])]
      ]
      records << [14, UNDER_SIX] if under_six?
      records
    end

    # 交付日時点で 6 歳未満(患者一部負担区分の必須出力)。
    def under_six?
      birth = Date.iso8601(@patient["birthDate"].to_s)
      issue = Date.iso8601(PrescriptionMeta.issue_date(@order))
      birth.next_year(6) > issue
    rescue Date::Error
      false
    end

    # ---- 保険 ----

    def insurance_records
      [[22, ""], [23, "", "", INSURED_SELF, ""]]
    end

    # ---- 備考 ----

    def remark_records
      chunks = PrescriptionMeta.remark_lines(@order).flat_map do |text|
        text.to_s.split(/\r?\n/).flat_map { |line| line.strip.each_char.each_slice(LIMITS[:remark]).map(&:join) }
      end
      chunks.compact_blank.each_with_index.map { |chunk, i| [81, i + 1, "", chunk] }
    end

    # ---- RP ----

    def rp_records(rp)
      form, form_name = dosage_form(rp)
      times = PrescriptionDose.as_needed?(rp.usage_code) ? nil : PrescriptionDose.times_per_day(rp.usage_code)
      code_kind = rp.usage_code.present? ? USAGE_CODE_JAMI : USAGE_CODE_NONE
      records = [
        [101, rp.rp_number, form, form_name, dispense_quantity(rp, form)],
        [111, rp.rp_number, code_kind, rp.usage_code, cut(rp.usage_name, :usage_name), times]
      ]
      usage_supplements(rp).each_with_index do |(kind, text, code), i|
        records << [181, rp.rp_number, i + 1, kind, cut(text, :supplement), code, ""]
      end
      rp.medicines.each { |medicine| records.concat(medicine_records(rp, medicine, form, times)) }
      records
    end

    # 頓用は用法コードの 3 桁目、それ以外は用法の基本区分で決める。
    def dosage_form(rp)
      return [FORM_AS_NEEDED, ""] if PrescriptionDose.as_needed?(rp.usage_code)

      form = FORM_BY_USAGE_CATEGORY[rp.usage_category_code]
      form ? [form, ""] : [FORM_UNKNOWN, USAGE_CATEGORY_NAMES.fetch(rp.usage_category_code, "")]
    end

    # 調剤数量: 内服は投与日数、頓服は投与回数。外用などは薬品の用量に全量を記録するので 1。
    def dispense_quantity(rp, form)
      case form
      when FORM_ORAL then rp.dose_days.presence || 1
      when FORM_AS_NEEDED then rp.dose_count.presence || 1
      else 1
      end
    end

    # 用法補足(181)。補足用法(I/W/D/C)はコード付き、用法コメントと調剤指示は名称で記録する。
    def usage_supplements(rp)
      supplements = rp.supplement_codes.map { |code, display| [SUPPLEMENT_JAMI, display, code] }
      supplements << [nil, rp.usage_comment, ""] if rp.usage_comment.present?
      rp.dispense_codes.each do |code|
        label = PrescriptionReport::DISPENSE_INSTRUCTION_LABELS[code]
        supplements << [DISPENSE_SUPPLEMENT_KINDS[code], label, ""] if label
      end
      supplements
    end

    def medicine_records(rp, medicine, form, times)
      code_kind, code = medicine_code(medicine)
      info = code.to_s.start_with?("7") ? INFO_MATERIAL : INFO_MEDICINE
      records = [
        [201, rp.rp_number, medicine.order_in_rp, info, code_kind, code, cut(medicine.name, :medicine_name),
         number(medicine.dose), medicine.potency ? DOSE_POTENCY : DOSE_PRICE_UNIT, cut(medicine.unit, :unit)]
      ]
      uneven = uneven_doses(medicine)
      if uneven.any?
        records << [221, rp.rp_number, medicine.order_in_rp, *uneven.map(&:first), *uneven.map(&:last)]
      elsif form == FORM_ORAL && medicine.single.present?
        records << [241, rp.rp_number, medicine.order_in_rp, number(medicine.single), times]
      end
      medicine_supplements(medicine).each_with_index do |(kind, text), i|
        records << [281, rp.rp_number, medicine.order_in_rp, i + 1, kind, cut(text, :supplement), ""]
      end
      records
    end

    def medicine_code(medicine)
      return [CODE_KIND_GENERIC, medicine.code] if medicine.general
      return [CODE_KIND_RECEIPT, medicine.code] if medicine.code.present?

      [CODE_KIND_NONE, ""]
    end

    # 不均等(221)。補足用法 V コード(V + 回目 + 量、8 桁。空きは N)から各回の量を取り、
    # 回目の順に 5 つ分の量と 5 つ分のコードを並べる。
    def uneven_doses(medicine)
      codes = medicine.uneven_codes.map(&:first).select { |code| code.match?(/\AV[1-5]/) }.sort
      return [] if codes.empty?

      (1..5).map do |n|
        code = codes.find { |c| c[1] == n.to_s }
        code ? [code[2..].delete("N"), code] : ["", ""]
      end
    end

    def medicine_supplements(medicine)
      supplements = []
      supplements << SUBSTITUTION_SUPPLEMENTS[medicine.substitution_block] if medicine.substitution_block
      supplements << [nil, medicine.comment] if medicine.comment.present?
      supplements
    end

    # ---- 書式 ----

    # 日付を YYYYMMDD に。年月・年だけの値はその桁数のまま。
    def ymd(value)
      value.to_s.delete("-")
    end

    # 数値: 整数の前と小数の後ろの 0 を省く(1.50 → 1.5、3.0 → 3)。
    def number(value)
      return "" if value.nil?
      return value.to_s if value.is_a?(Integer)

      text = format("%.5f", value.to_f)
      text.sub(/0+\z/, "").sub(/\.\z/, "")
    end

    def cut(value, limit_key)
      value.to_s.strip[0, LIMITS.fetch(limit_key)]
    end

    # 項目の書式: 前後の空白を落とし、区切りの半角カンマは全角に、改行は全角空白にする。
    def field_text(field)
      field.to_s.strip.tr(",", "，").gsub(/\r?\n/, "　")
    end

    def encode(text)
      text.gsub(/[#{NORMALIZE.keys.join}]/) { |char| NORMALIZE[char] }
          .encode(ENCODING, invalid: :replace, undef: :replace, replace: REPLACEMENT)
    end
  end
end
