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

      # カルテ → レセコンへ送る 1 受診ぶんの会計。time は診療の開始時刻(HH:MM)。
      BillingClaim = Struct.new(
        :patient_number, :date, :time, :department_code, :physician_code,
        :coverage_set_key, :items, :auto_basic_fee,
        keyword_init: true
      )

      # 会計の 1 剤。category は :oral / :as_needed / :topical / :lab / :rad / :treatment など。
      #
      # - days は内服の投与日数、count は処置などの回数。どちらも無ければ 1 回。
      # - route / method / usage_type は注射の投与経路・手技・用法種別で、
      #   注射の剤区分を連携先が決めるときに使う。
      # - dispensing は処方の院内(:internal)/ 院外(:external)。無ければ施設の既定。
      # - performed_at は実施日時、source_ref は元になった記録("Procedure/xx" など)、
      #   order_ref はそのオーダー("ServiceRequest/xx")。
      BillingItem = Struct.new(
        :category, :name, :lines, :days, :count, :usage_code, :usage_name,
        :route, :method, :usage_type, :dispensing, :performed_at, :source_ref, :order_ref,
        keyword_init: true
      )

      # 剤に並ぶ 1 行。kind は :procedure(手技・加算)/ :medicine(薬剤)/ :material(材料)/
      # :comment(コメント)。section は手技の点数表の区分番号(章記号 + 3 桁、例 "K920")で、
      # 連携先が剤の区分を決める手がかりになる。generic は一般名処方の薬剤。
      BillingLine = Struct.new(:code, :name, :quantity, :unit, :kind, :section, :generic, keyword_init: true) do
        def kind = self[:kind] || :procedure
      end

      # 画面に見せる剤。連携先の区分(class_code / class_name)を添えた BillingItem で、
      # 実際に送る電文の剤の並びに合わせて分割・命名されている。
      PreviewItem = Struct.new(
        :category, :name, :class_code, :class_name, :count, :days, :usage_name, :performed_at, :lines,
        keyword_init: true
      )

      # 保険病名。
      Diagnosis = Struct.new(
        :name, :codes, :modifier_codes, :suspected, :start_date, :end_date, :outcome,
        keyword_init: true
      )

      # レセコン側での 1 受診の状態。
      # state は :none(未送信)/ :sent(カルテから送ってあり、送り直し・取消ができる)/
      # :opened(レセコン側で展開・編集されていて、カルテからは触れない)/ :settled(会計済み)。
      # message は :opened / :settled のときに画面へ出す理由。
      BillingStatus = Struct.new(:state, :detail, :message, keyword_init: true) do
        def sent? = state == :sent
        def locked? = %i[opened settled].include?(state)
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
