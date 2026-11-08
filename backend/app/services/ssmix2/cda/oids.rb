module Ssmix2
  module Cda
    # HL7 CDA R2 で使う OID(JAHIS 診療文書構造化記述規約 共通編 5.1(3)、経過記録規約 3.1)。
    # 日本医療情報学会が管理する患者 ID・利用者 ID・施設 ID のルートは "1" + 医療機関コード 10 桁を末尾に付ける。
    module Oids
      JAMI_PATIENT = "1.2.392.200250.3.3.1".freeze
      JAMI_USER = "1.2.392.200250.3.3.2".freeze
      JAMI_FACILITY = "1.2.392.200250.2.2.1".freeze
      # JAHIS 地域医療連携における経過記録構造化記述規約の文書テンプレート。
      PROGRESS_NOTE_TEMPLATE = "1.2.392.200270.3.1".freeze
      HL7_TYPE_ID = "2.16.840.1.113883.1.3".freeze
      LOINC = "2.16.840.1.113883.6.1".freeze
      ADMINISTRATIVE_GENDER = "2.16.840.1.113883.5.1".freeze
      CONFIDENTIALITY = "2.16.840.1.113883.5.25".freeze

      module_function

      def facility_suffix = "1#{Settings.facility_id}"

      def patient_root = "#{JAMI_PATIENT}.#{facility_suffix}"

      def practitioner_root = "#{JAMI_USER}.#{facility_suffix}"

      def facility_root = "#{JAMI_FACILITY}.#{facility_suffix}"
    end
  end
end
