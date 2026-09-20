module Integrations
  module Orca
    # 中途終了データ(medicalmodv2)の送信・再送・取消。
    #
    # 日レセは同じ患者・同じ日に 2 度目の登録(class=01)を受け付けない
    # (Api_Result=80)。送り直しは class=03(置換)で、そのとき要る Medical_Uid は
    # カルテ側に持たず、そのつど日レセへ照会する。持つと二重管理になり、
    # 医事課が日レセの画面で触ったときに食い違う。
    class MedicalApi
      PATH = "/api21/medicalmodv2".freeze
      # 中途終了患者情報一覧。同日のデータの Medical_Uid を引く。
      LIST_PATH = "/api01rv2/tmedicalgetv2".freeze

      REGISTER = "01".freeze
      CANCEL = "02".freeze
      REPLACE = "03".freeze

      # 既に同日の診療データが登録されている。class=03 へ倒す合図。
      ALREADY_REGISTERED = "80".freeze

      def initialize(gateway)
        @gateway = gateway
      end

      # 同じ患者・同じ日・同じ診療科の中途終了データの Medical_Uid。
      # 日レセは 患者 + 日 + 診療科 で 1 件しか持てないので、合致したものを採る。
      #
      # 応答の Patient_ID は日レセが 1009 の連番桁数でゼロ埋めした形で返るので、
      # カルテの番号(ゼロ埋めなし)とはそのままでは一致しない。
      def find_uid(patient_id:, perform_date:, department_code:)
        attributes = {
          "Perform_Date" => perform_date.to_s,
          "Patient_ID" => patient_id,
          "Department_Code" => department_code
        }.compact_blank

        result = gateway.post(LIST_PATH, "tmedicalgetreq", attributes)
        return nil unless result.ok?

        Array(result.body["Tmedical_List_Information"]).find do |row|
          next false unless row.is_a?(Hash)
          next false unless ReceiptComputer::PatientResource.same_number?(
            row.dig("Patient_Information", "Patient_ID"), patient_id
          )

          department_code.blank? || row["Department_Code"].to_s == department_code.to_s
        end&.dig("Medical_Uid").presence
      rescue Gateway::InvalidResponse
        nil
      end

      def register(classes, patient_id:, perform_date:, department_code:, physician_code:,
                   coverage_set_key:, medical_fee_auto: true)
        result = post(REGISTER, classes, medical_uid: nil, patient_id: patient_id,
                      perform_date: perform_date, department_code: department_code,
                      physician_code: physician_code, coverage_set_key: coverage_set_key,
                      medical_fee_auto: medical_fee_auto)
        return result unless result.api_result.code == ALREADY_REGISTERED

        # 日レセに同日のデータが既にある。Medical_Uid を引いて置換に倒す。
        # 置換は UID が要るので、ここを省くと「ＵＩＤが未設定です」で止まる。
        uid = find_uid(patient_id: patient_id, perform_date: perform_date,
                       department_code: department_code)
        return result if uid.blank?

        post(REPLACE, classes, medical_uid: uid, patient_id: patient_id,
             perform_date: perform_date, department_code: department_code,
             physician_code: physician_code, coverage_set_key: coverage_set_key,
             medical_fee_auto: medical_fee_auto)
      end

      def cancel(patient_id:, perform_date:, department_code:)
        uid = find_uid(patient_id: patient_id, perform_date: perform_date,
                       department_code: department_code)
        return nil if uid.blank?

        attributes = {
          "Request_Number" => CANCEL,
          "Patient_ID" => patient_id,
          "Perform_Date" => perform_date.to_s,
          "Medical_Uid" => uid,
          # 取消でも診療科を送らないと「診療科が未設定です」で弾かれる。
          "Diagnosis_Information" => { "Department_Code" => department_code }.compact_blank
        }.compact_blank

        gateway.post(PATH, "medicalreq", attributes, params: { "class" => CANCEL })
      end

      private

      attr_reader :gateway

      def post(request_number, classes, medical_uid:, patient_id:, perform_date:,
               department_code:, physician_code:, coverage_set_key:, medical_fee_auto:)
        insurance = { "Insurance_Combination_Number" => coverage_set_key } if coverage_set_key.present?

        attributes = {
          "Request_Number" => request_number,
          # 外来は空欄。入院(I)は第2段階。
          "InOut" => "",
          "Patient_ID" => patient_id,
          "Perform_Date" => perform_date.to_s,
          "Medical_Uid" => medical_uid,
          "Diagnosis_Information" => {
            "Department_Code" => department_code,
            "Physician_Code" => physician_code,
            "HealthInsurance_Information" => insurance,
            "Medical_Information" => classes
          }.compact,
          # 初診・再診料はカルテがオーダーとして持っていないので、日レセに算定させる。
          "Medical_Fee_Auto" => medical_fee_auto ? "Yes" : "No"
        }.compact

        gateway.post(PATH, "medicalreq", attributes, params: { "class" => request_number })
      end
    end
  end
end
