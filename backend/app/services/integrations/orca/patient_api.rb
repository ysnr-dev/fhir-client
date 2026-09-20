module Integrations
  module Orca
    # 患者基本情報(patientgetv2)と全保険組合せ(patientlst6v2)。
    #
    # 日レセの応答は「保険組合せの一覧」で、1 つの組合せの中に主保険が直接、
    # 公費が配列で入っている。同じ保険が複数の組合せに現れるので、ここで
    # 保険・公費の実体と「組合せ = 請求セット」に分けて中立の形に直す。
    class PatientApi
      include ReceiptComputer::Records

      GET_PATH = "/api01rv2/patientgetv2".freeze
      LIST_PATH = "/api01rv2/patientlst6v2".freeze

      # 患者番号に該当する患者が存在しない(patientgetv2 は 2 桁の 10 を返す)。
      PATIENT_NOT_FOUND = "10".freeze
      # 対象の保険組合せが存在しない。保険未登録の患者では普通に起きる。
      NO_COMBINATION = "E20".freeze

      SEX = { "1" => "male", "2" => "female" }.freeze

      def initialize(gateway)
        @gateway = gateway
      end

      def fetch(patient_number)
        patient = fetch_patient(patient_number)
        rows = fetch_combinations(patient_number)

        coverages = {}
        sets = rows.map { |row| build_set(row, coverages) }

        PatientSnapshot.new(patient: patient, coverages: coverages.values, coverage_sets: sets)
      end

      private

      attr_reader :gateway

      def fetch_patient(patient_number)
        result = gateway.get(GET_PATH, { "id" => patient_number })
        raise ReceiptComputer::NotFound, "患者 #{patient_number} が見つかりません" if result.api_result.code == PATIENT_NOT_FOUND
        raise ReceiptComputer::Rejected, result.api_result.message unless result.ok?

        info = result.body["Patient_Information"]
        info = info.first if info.is_a?(Array)
        raise ReceiptComputer::NotFound, "患者 #{patient_number} が見つかりません" unless info.is_a?(Hash)

        family, given = split_name(info["WholeName"])
        family_kana, given_kana = split_name(info["WholeName_inKana"])

        PatientRecord.new(
          number: info["Patient_ID"].presence || patient_number,
          family: family, given: given,
          family_kana: family_kana, given_kana: given_kana,
          birth_date: info["BirthDate"].presence,
          gender: SEX[info["Sex"].to_s],
          postal_code: info.dig("Home_Address_Information", "Address_ZipCode").presence,
          address: home_address(info),
          phone: home_phone(info)
        )
      end

      def fetch_combinations(patient_number)
        # 処理区分の項目名は ORCA の定義で Reqest_Number(u が無い)。正しい綴りで
        # 送ると Api_Result=E91「処理区分未設定」になる。
        result = gateway.post(LIST_PATH, "patientlst6req",
                              { "Reqest_Number" => "01", "Patient_ID" => patient_number })
        return [] if result.api_result.code == NO_COMBINATION
        raise ReceiptComputer::Rejected, result.api_result.message unless result.ok?

        Array(result.body["HealthInsurance_Information"])
      end

      # 1 つの組合せから、主保険と公費の実体を coverages に積み、請求セットを返す。
      def build_set(row, coverages)
        members = []

        insurance = build_insurance(row)
        if insurance
          coverages[insurance.external_key] ||= insurance
          members << insurance.external_key
        end

        Array(row["PublicInsurance_Information"]).each do |pi|
          public_cov = build_public(pi)
          next if public_cov.nil?

          coverages[public_cov.external_key] ||= public_cov
          members << public_cov.external_key
        end

        percent = InsuranceCodes.copay_percent(row["InsuranceCombination_Rate_Outpatient"])
        CoverageSet.new(
          key: row["Insurance_Combination_Number"],
          label: set_label(row, percent),
          member_keys: members,
          copay_percent: percent
        )
      end

      def build_insurance(row)
        return nil if row["InsuranceProvider_Class"].blank? && row["InsuranceProvider_Number"].blank?

        CoverageRecord.new(
          external_key: key_for("ins", row["InsuranceProvider_Class"], row["InsuranceProvider_Number"],
                                row["HealthInsuredPerson_Symbol"], row["HealthInsuredPerson_Number"],
                                row["HealthInsuredPerson_Branch_Number"], row["Certificate_StartDate"]),
          kind: :insurance,
          type_code: row["InsuranceProvider_Class"].presence,
          type_name: row["InsuranceProvider_WholeName"].presence,
          insurer_number: row["InsuranceProvider_Number"].presence,
          insurer_name: row["InsuranceProvider_WholeName"].presence,
          symbol: row["HealthInsuredPerson_Symbol"].presence,
          number: row["HealthInsuredPerson_Number"].presence,
          branch: row["HealthInsuredPerson_Branch_Number"].presence,
          relationship: InsuranceCodes.relationship(row["RelationToInsuredPerson"]),
          period_start: InsuranceCodes.date(row["Certificate_StartDate"]),
          period_end: InsuranceCodes.date(row["Certificate_ExpiredDate"]),
          copay_percent: InsuranceCodes.copay_percent(row["InsuranceCombination_Rate_Outpatient"])
        )
      end

      def build_public(pi)
        return nil if pi["PublicInsurance_Class"].blank? && pi["PublicInsurer_Number"].blank?

        CoverageRecord.new(
          external_key: key_for("pub", pi["PublicInsurance_Class"], pi["PublicInsurer_Number"],
                                pi["PublicInsuredPerson_Number"], pi["Certificate_IssuedDate"]),
          kind: :public,
          type_code: pi["PublicInsurance_Class"].presence,
          type_name: pi["PublicInsurance_Name"].presence,
          insurer_number: pi["PublicInsurer_Number"].presence,
          insurer_name: pi["PublicInsurance_Name"].presence,
          recipient_number: pi["PublicInsuredPerson_Number"].presence,
          period_start: InsuranceCodes.date(pi["Certificate_IssuedDate"].presence || pi["Certificate_StartDate"]),
          period_end: InsuranceCodes.date(pi["Certificate_ExpiredDate"])
        )
      end

      # 日レセは保険・公費に外部から引ける ID を持たないので、内容から安定したキーを作る。
      # 証の内容が変われば別の保険として登録し直される(実際に別の資格なので正しい)。
      def key_for(prefix, *parts)
        digest = Digest::SHA1.hexdigest(parts.map(&:to_s).join("|"))[0, 16]
        "#{prefix}-#{digest}"
      end

      def set_label(row, percent)
        parts = [row["InsuranceProvider_WholeName"].presence || row["InsuranceProvider_Class"].presence]
        Array(row["PublicInsurance_Information"]).each { |pi| parts << pi["PublicInsurance_Name"].presence }
        parts << "#{percent}%" if percent
        parts.compact_blank.join(" ").presence || row["Insurance_Combination_Number"]
      end

      # 姓名は WholeName に全角空白区切りで入る。区切りが無ければ全部を姓にする。
      def split_name(whole)
        text = whole.to_s.strip
        return [nil, nil] if text.empty?

        parts = text.split(/[　 ]+/, 2)
        [parts[0], parts[1]]
      end

      def home_address(info)
        home = info["Home_Address_Information"]
        return nil unless home.is_a?(Hash)

        [home["WholeAddress1"], home["WholeAddress2"]].compact_blank.join("").presence
      end

      # 電話番号は項目定義では下位要素を持つ record だが、実際は文字列で返る。
      # どちらの形でも読めるようにする(String に dig を呼ぶと TypeError になる)。
      def home_phone(info)
        home = info["Home_Address_Information"]
        return nil unless home.is_a?(Hash)

        phone = home["PhoneNumber1"]
        phone = phone["Number"] if phone.is_a?(Hash)
        phone.presence
      end
    end
  end
end
