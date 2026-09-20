module Integrations
  module ReceiptComputer
    # 連携の中立な語彙。レセコンの電文の言葉(保険組合せ番号・Medical_Class など)は
    # アダプタの内側に閉じ、ここから外には出さない。
    module Records
      # レセコンが持つ患者基本情報。
      PatientRecord = Struct.new(
        :number, :family, :given, :family_kana, :given_kana,
        :birth_date, :gender, :postal_code, :address, :phone,
        keyword_init: true
      )

      # 1 つの保険または 1 つの公費。
      # kind は :insurance(医療保険)か :public(公費)。
      CoverageRecord = Struct.new(
        :external_key, :kind, :type_code, :type_name,
        :insurer_number, :insurer_name,
        :symbol, :number, :branch, :relationship, :recipient_number,
        :period_start, :period_end, :copay_percent,
        keyword_init: true
      )

      # 請求時に同時に適用する保険の組。レセコンが採番する不透明なキーを持つ。
      CoverageSet = Struct.new(:key, :label, :member_keys, :copay_percent, keyword_init: true)

      PatientSnapshot = Struct.new(:patient, :coverages, :coverage_sets, keyword_init: true)

      # 受付(来院)。レセコンで受付されたものをカルテへ取り込む。
      ReceptionEvent = Struct.new(
        :event_id, :action, :reception_key, :patient_number, :date, :time,
        :department_code, :physician_code, :coverage_set_key,
        keyword_init: true
      )

      # カルテ → レセコンへ送る 1 受診ぶんの会計。
      BillingClaim = Struct.new(
        :patient_number, :date, :department_code, :physician_code,
        :coverage_set_key, :items, :auto_basic_fee,
        keyword_init: true
      )

      # 会計の 1 明細。category は :prescription / :injection / :lab / :imaging / :procedure など。
      BillingItem = Struct.new(
        :category, :name, :lines, :days, :usage_code, :usage_name,
        keyword_init: true
      )

      # 明細に並ぶ 1 行(薬剤・手技・材料)。
      BillingLine = Struct.new(:code, :name, :quantity, :unit, keyword_init: true)

      # 保険病名。
      Diagnosis = Struct.new(
        :name, :codes, :modifier_codes, :suspected, :start_date, :end_date, :outcome,
        keyword_init: true
      )

      # 既にレセコンへ送ってあるか。
      BillingStatus = Struct.new(:sent, :detail, keyword_init: true) do
        def sent? = !!sent
      end

      # 連携 1 回の結果。outcome は :succeeded / :warning / :failed。
      Result = Struct.new(:outcome, :code, :message, :warnings, :skipped, keyword_init: true) do
        def initialize(*)
          super
          self.warnings ||= []
          self.skipped ||= []
        end

        def succeeded? = outcome == :succeeded
        def failed? = outcome == :failed
      end
    end
  end
end
