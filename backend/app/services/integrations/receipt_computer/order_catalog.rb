module Integrations
  module ReceiptComputer
    # オーダー種別ごとの「どのマスタの何という列に項目コードがあるか」。
    #
    # レセプト電算コードは全国共通なので、ここは連携先に依らない。
    # 連携先ごとの区分(日レセの診療種別区分など)はアダプタ側で付ける。
    module OrderCatalog
      Definition = Struct.new(:order_type, :label, :model_name, :code_column, :coding_system,
                              keyword_init: true) do
        def model = model_name.constantize

        # 項目コード → レセ電算の診療行為コード。未設定は結果に現れない。
        def receipt_codes(item_codes)
          return {} if item_codes.empty?

          model.where(code_column => item_codes)
               .where.not(receipt_code: [nil, ""])
               .pluck(code_column, :receipt_code).to_h
        end
      end

      LOCAL = "http://fhir-client.local/CodeSystem".freeze

      ALL = [
        Definition.new(order_type: "lab", label: "検体検査", model_name: "Master::LabOrderItem",
                       code_column: :order_item_code, coding_system: "#{LOCAL}/lab-order-item"),
        Definition.new(order_type: "micro", label: "細菌検査", model_name: "Master::MicroOrderItem",
                       code_column: :item_code, coding_system: "#{LOCAL}/micro-order-item"),
        Definition.new(order_type: "physio", label: "生理検査", model_name: "Master::PhysioItem",
                       code_column: :item_code, coding_system: "#{LOCAL}/physio-order-item"),
        Definition.new(order_type: "endoscopy", label: "内視鏡", model_name: "Master::EndoscopyItem",
                       code_column: :item_code, coding_system: "#{LOCAL}/endoscopy-order-item"),
        Definition.new(order_type: "rad", label: "放射線検査", model_name: "Master::RadItem",
                       code_column: :item_code, coding_system: "#{LOCAL}/rad-order-item"),
        Definition.new(order_type: "treatment", label: "処置", model_name: "Master::TreatmentItem",
                       code_column: :item_code, coding_system: "#{LOCAL}/treatment-order-item"),
        Definition.new(order_type: "surgery", label: "手術", model_name: "Master::SurgeryItem",
                       code_column: :item_code, coding_system: "#{LOCAL}/surgery-order-item")
      ].freeze

      BY_TYPE = ALL.index_by(&:order_type).freeze

      # 用法マスタの基本区分コード(1=内服 2=外用 3=注射 4=注入)。
      USAGE_CATEGORY_ORAL = "1".freeze
      USAGE_CATEGORY_TOPICAL = "2".freeze

      module_function

      def find(order_type) = BY_TYPE[order_type]
    end
  end
end
