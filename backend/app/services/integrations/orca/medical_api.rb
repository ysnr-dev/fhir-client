module Integrations
  module Orca
    # 中途終了データ(medicalmodv2)の送信・再送・取消。
    #
    # 日レセは同じ患者・同じ日に 2 度目の登録(class=01)を受け付けない
    # (Api_Result=80)。外来の送り直しは仕様上「削除のみ可能」なので、class=02 で消してから
    # class=01 で登録し直す(置換 class=03 は入院だけ)。そのとき要る Medical_Uid は
    # カルテ側に持たず、そのつど日レセへ照会する。持つと二重管理になり、
    # 医事課が日レセの画面で触ったときに食い違う。
    class MedicalApi
      PATH = "/api21/medicalmodv2".freeze
      # 中途終了患者情報一覧。同日のデータの Medical_Uid と展開状態を引く。
      LIST_PATH = "/api01rv2/tmedicalgetv2".freeze

      REGISTER = "01".freeze
      CANCEL = "02".freeze
      # 置換。仕様上は入院のみ(外来で通る版もあるが、それに頼らない)。入院の訂正で使う。
      REPLACE = "03".freeze

      # 既に同日の診療データが登録されている。削除 → 再登録に倒す合図。
      ALREADY_REGISTERED = "80".freeze

      # 同日の中途終了データ。uid が無いのは「日レセ画面で一度展開して再度中途終了した」もので、
      # 仕様上 API からは削除も変更もできない。opened は展開中(Medical_Mode=1)または
      # 日レセ画面で登録された分(Medical_Mode2=1)。
      Entry = Struct.new(:uid, :opened, keyword_init: true) do
        def controllable? = uid.present? && !opened
      end

      def initialize(gateway)
        @gateway = gateway
      end

      # 同じ患者・同じ日・同じ診療科の中途終了データ。
      # 日レセは 患者 + 日 + 診療科 で 1 件しか持てないので、合致したものを採る。
      #
      # 応答の Patient_ID は日レセが 1009 の連番桁数でゼロ埋めした形で返るので、
      # カルテの番号(ゼロ埋めなし)とはそのままでは一致しない。
      def find_entry(patient_id:, perform_date:, department_code:)
        attributes = {
          "Perform_Date" => perform_date.to_s,
          "Patient_ID" => patient_id,
          "Department_Code" => department_code
        }.compact_blank

        result = gateway.post(LIST_PATH, "tmedicalgetreq", attributes)
        return nil unless result.ok?

        row = Array(result.body["Tmedical_List_Information"]).find do |entry|
          next false unless entry.is_a?(Hash)
          next false unless ReceiptComputer::PatientResource.same_number?(
            entry.dig("Patient_Information", "Patient_ID"), patient_id
          )

          department_code.blank? || entry["Department_Code"].to_s == department_code.to_s
        end
        return nil if row.nil?

        Entry.new(uid: row["Medical_Uid"].presence,
                  opened: row["Medical_Mode"].to_s == "1" || row["Medical_Mode2"].to_s == "1")
      rescue Gateway::InvalidResponse
        nil
      end

      def find_uid(patient_id:, perform_date:, department_code:)
        find_entry(patient_id: patient_id, perform_date: perform_date, department_code: department_code)&.uid
      end

      def register(classes, patient_id:, perform_date:, perform_time: nil, department_code:, physician_code:,
                   coverage_set_key:, medical_fee_auto: true)
        request = {
          patient_id: patient_id, perform_date: perform_date, perform_time: perform_time,
          department_code: department_code, physician_code: physician_code,
          coverage_set_key: coverage_set_key, medical_fee_auto: medical_fee_auto
        }
        result = post(REGISTER, classes, **request)
        return verify_insurance(result, coverage_set_key) unless result.api_result.code == ALREADY_REGISTERED

        # 日レセに同日のデータが既にある。Medical_Uid を引いて 削除 → 再登録 に倒す。
        # UID が無いのに削除を送っても「ＵＩＤが未設定です」で止まるだけなので、80 をそのまま返す。
        uid = find_uid(patient_id: patient_id, perform_date: perform_date, department_code: department_code)
        return result if uid.blank?

        deleted = delete(uid, patient_id: patient_id, perform_date: perform_date, department_code: department_code)
        return deleted unless deleted.ok?

        again = post(REGISTER, classes, **request)
        again.ok? ? verify_insurance(again, coverage_set_key) : failed_after_delete(again)
      end

      def cancel(patient_id:, perform_date:, department_code:)
        uid = find_uid(patient_id: patient_id, perform_date: perform_date, department_code: department_code)
        return nil if uid.blank?

        delete(uid, patient_id: patient_id, perform_date: perform_date, department_code: department_code)
      end

      private

      attr_reader :gateway

      def delete(uid, patient_id:, perform_date:, department_code:)
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

      def post(request_number, classes, patient_id:, perform_date:, perform_time:, department_code:,
               physician_code:, coverage_set_key:, medical_fee_auto:)
        insurance = { "Insurance_Combination_Number" => coverage_set_key } if coverage_set_key.present?

        attributes = {
          "Request_Number" => request_number,
          # 外来は空欄。入院(I)は第2段階。
          "InOut" => "",
          "Patient_ID" => patient_id,
          "Perform_Date" => perform_date.to_s,
          # 診療時刻。時間外・休日・深夜の判定は日レセがこれで行う(専用の項目は無い)。
          "Perform_Time" => perform_time.present? ? "#{perform_time}:00" : nil,
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

      # 保険組合せ番号が不正でも日レセはエラーにせず、ゼロ(未確定)で登録して W02 を返す。
      # 応答に載る番号を送った番号と突き合わせ、食い違っていたら失敗にする(登録は済んでいるが、
      # 保険が付かない中途データが残る状態を「成功」とは言わない)。
      def verify_insurance(result, coverage_set_key)
        return result unless result.ok? && coverage_set_key.present?

        registered = result.body.dig("Patient_Information", "HealthInsurance_Information",
                                     "Insurance_Combination_Number").to_s
        return result if registered.blank? || registered.to_i == coverage_set_key.to_i

        with_result(result, code: "insurance_mismatch",
                            message: "保険組合せが日レセ側で変わっています(送信 #{coverage_set_key}、登録 #{registered})。" \
                                     "保険を選び直して送り直してください")
      end

      # 削除は通ったが再登録が落ちた。医事側のデータが消えたことを利用者に伝えないと、
      # 「送信に失敗した」だけでは前のデータが残っていると思われる。
      def failed_after_delete(result)
        with_result(result, code: result.api_result.code,
                            message: "送り直しに失敗し、医事会計側のデータは消えています。もう一度送ってください" \
                                     "(#{result.api_result.message})")
      end

      def with_result(result, code:, message:)
        Gateway::Result.new(
          api_result: ApiResult.new(code: code, message: message, warnings: result.api_result.warnings),
          body: result.body, request_xml: result.request_xml, response_body: result.response_body
        )
      end
    end
  end
end
