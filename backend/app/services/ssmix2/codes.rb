module Ssmix2
  # コードの対応。FHIR の値を SS-MIX2 のコード表(HL7 表・使用者定義表・JAHIS 表・MERIT-9)に写す。
  module Codes
    GENDER = { "male" => "M", "female" => "F", "other" => "O", "unknown" => "U" }.freeze

    # MERIT-9 処方オーダ 表 4 単位略号(コード表 表 99)。薬剤マスタの単位名から引く。
    MR9P_UNITS = {
      "錠" => "TAB", "カプセル" => "CAP", "g" => "G", "ｇ" => "G", "mg" => "MG", "ｍｇ" => "MG", "μg" => "MCG", "µg" => "MCG",
      "mL" => "ML", "ml" => "ML", "ｍＬ" => "ML", "L" => "L", "包" => "PCK", "本" => "HON", "瓶" => "BTL", "個" => "KO",
      "枚" => "SHT", "アンプル" => "AMP", "管" => "TUBE", "バイアル" => "VIL", "単位" => "UNT", "国際単位" => "IUNT",
      "千単位" => "TUNT", "万単位" => "TTUN", "袋" => "BAG", "キット" => "KIT", "回" => "TIME", "滴" => "DROP",
      "筒" => "PIPE", "シリンジ" => "SYRG", "噴霧" => "SPRY", "吸入" => "INHL", "丸" => "PILL", "巻" => "ROLL",
      "セット" => "SET", "シート" => "SHET", "組" => "PAIR", "缶" => "CAN", "箱" => "BOX", "kg" => "KG", "cm" => "CM",
      "mEq" => "MEQ", "μL" => "MCL", "トローチ" => "TROC", "mL/h" => "ML"
    }.freeze
    LOCAL_UNIT_SYSTEM = "99ZUN".freeze

    # MERIT-9 処方オーダ 表 7 処方区分(コード表 表 102)。入外区分と処方区分の組み合わせから引く。
    MR9P_SETTING = { "inpatient" => %w[IHP 入院処方], "outpatient" => %w[OHP 外来処方] }.freeze
    MR9P_PRESCRIPTION_CATEGORY = {
      "external" => %w[OHO 院外処方], "internal" => %w[OHI 院内処方], "regular" => %w[ORD 定期処方],
      "continuous" => %w[ORD 定期処方], "temporary" => %w[XTR 臨時処方], "emergency" => %w[XTR 臨時処方],
      "discharge" => %w[DCG 退院処方]
    }.freeze
    INJECTION_CATEGORY_SYSTEM = "99ZIC".freeze

    # 用法の基本区分(電子処方箋用法マスタの 1 桁目)→ 投薬経路(使用者定義表 0162)。
    USAGE_ROUTE = { "1" => %w[PO 口], "2" => %w[AP 外用], "4" => %w[NG 経口径内腔] }.freeze
    OTHER_ROUTE = %w[OTH その他].freeze

    # 病名の転帰。Condition.clinicalStatus → JHSD 表 0006(治癒だけは JHSD0006 に無いので HL7 表 0241)。
    CONDITION_OUTCOME = {
      "active" => %w[C 継続 JHSD0006], "remission" => %w[M 寛解 JHSD0006], "inactive" => %w[I 中止 JHSD0006],
      "resolved" => %w[F 完全に回復した HL70241]
    }.freeze

    # アレルゲン分類(使用者定義表 0127)。
    ALLERGEN_TYPE = {
      "food" => %w[FA 食物アレルギー], "medication" => %w[DA 薬物アレルギー], "environment" => %w[EA 環境アレルギー],
      "biologic" => %w[MC 種々の禁忌]
    }.freeze
    # 重症度(使用者定義表 0128)。FHIR は criticality しか持たないので近似する。
    ALLERGY_SEVERITY = { "high" => %w[SV 重度], "low" => %w[MI 軽度], "unable-to-assess" => %w[U 不明] }.freeze

    # 検査結果の報告状態(HL7 表 0085)。
    RESULT_STATUS = { "final" => "F", "corrected" => "C", "amended" => "C", "preliminary" => "P", "registered" => "I",
                      "cancelled" => "X", "entered-in-error" => "X" }.freeze
    # 異常フラグ(使用者定義表 0078)。FHIR の v3 ObservationInterpretation と同じ記号。
    ABNORMAL_FLAGS = %w[H L HH LL N A AA].freeze

    module_function

    def gender(fhir_gender) = GENDER.fetch(fhir_gender.to_s, "U")

    # 患者 ID。施設設定の桁数に足りなければ前ゼロで埋める(ガイドライン表 2.3-1)。
    def patient_id(number, digits)
      text = number.to_s.strip
      return text if text.empty? || text.length >= digits

      text.rjust(digits, "0")
    end

    # ファイル名に使う診療科コード。無ければ "-"(ガイドライン表 3.1-3)。
    def file_department_code(code) = code.presence || "-"

    # 単位の CWE。MR9P に無い単位はローカル。
    def unit_cwe(unit_name)
      return "" if unit_name.blank?

      code = MR9P_UNITS[unit_name.to_s.strip]
      code ? Hl7::Types.cwe(code, unit_name, "MR9P") : Hl7::Types.cwe(unit_name, unit_name, LOCAL_UNIT_SYSTEM)
    end

    # RXE-21 処方区分。入外区分と処方区分の 2 つを繰返しで並べる。
    def prescription_category_cwe(setting, category)
      parts = []
      parts << Hl7::Types.cwe(*MR9P_SETTING[setting], "MR9P") if MR9P_SETTING.key?(setting)
      parts << Hl7::Types.cwe(*MR9P_PRESCRIPTION_CATEGORY[category], "MR9P") if MR9P_PRESCRIPTION_CATEGORY.key?(category)
      Hl7::Types.repeats(*parts)
    end

    def injection_category_cwe(setting, category, display)
      parts = []
      parts << Hl7::Types.cwe(*MR9P_SETTING[setting], "MR9P") if MR9P_SETTING.key?(setting)
      parts << Hl7::Types.cwe(category, display, INJECTION_CATEGORY_SYSTEM) if category.present?
      Hl7::Types.repeats(*parts)
    end

    def usage_route_cwe(usage_code)
      code, name = USAGE_ROUTE.fetch(usage_code.to_s[0].to_s, OTHER_ROUTE)
      Hl7::Types.cwe(code, name, "HL70162")
    end

    def condition_outcome_cwe(clinical_status)
      parts = CONDITION_OUTCOME[clinical_status.to_s]
      parts ? Hl7::Types.cwe(*parts) : ""
    end

    def allergen_type_cwe(category)
      parts = ALLERGEN_TYPE[category.to_s]
      parts ? Hl7::Types.cwe(*parts, "HL70127") : ""
    end

    def allergy_severity_cwe(criticality)
      parts = ALLERGY_SEVERITY[criticality.to_s]
      parts ? Hl7::Types.cwe(*parts, "HL70128") : ""
    end

    def result_status(fhir_status) = RESULT_STATUS.fetch(fhir_status.to_s, "F")

    def abnormal_flag(interpretation_code)
      code = interpretation_code.to_s
      ABNORMAL_FLAGS.include?(code) ? code : ""
    end

    # 医薬品の HOT9。レセ電コード(9 桁)から HOT コードマスタを引く。無ければ nil。
    def hot9_for_receipt_code(receipt_code)
      return nil if receipt_code.blank?

      Master::HotCode.where(receipt_code_1: receipt_code).or(Master::HotCode.where(receipt_code_2: receipt_code))
                     .limit(1).pick(:hot_code)
    end

    # 医薬品の HOT9。個別医薬品コード(YJ コード)から引く。
    def hot9_for_yj(yj_code)
      return nil if yj_code.blank?

      Master::HotCode.where(individual_medicine_code: yj_code).limit(1).pick(:hot_code)
    end
  end
end
