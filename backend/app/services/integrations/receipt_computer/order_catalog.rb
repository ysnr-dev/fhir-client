module Integrations
  module ReceiptComputer
    # オーダー種別ごとの「会計に何を使うか」。
    #
    # - source: :procedure は実施記録(Procedure のハブと配下)から剤を組む種別。
    #   実施入力を持つので、オーダーの明細ではなく実際に行った手技・薬剤・材料を送る。
    # - source: :order は実施入力を持たない種別。オーダーの明細と項目マスタの
    #   receipt_code 列から組む。
    # - PENDING は送り方が決まっていない種別。黙って落とさず「まだ送らない」と報告する。
    # - IGNORED は出来高の項目が無い種別と、別経路(処方)で送る種別。
    #
    # レセプト電算コードは全国共通なので、ここは連携先に依らない。
    # 連携先ごとの区分(日レセの診療種別区分など)はアダプタ側で付ける。
    module OrderCatalog
      LOCAL = "http://fhir-client.local".freeze

      Definition = Struct.new(:order_type, :label, :model_name, :code_column, :source, keyword_init: true) do
        def model = model_name.constantize

        def coding_system = "#{LOCAL}/CodeSystem/#{order_type}-order-item"

        # 実施記録の手技コード体系と、usedCode に添える数量の拡張。
        # 5 種別とも frontend の *ResultHelpers が同じ規則で付けている。
        def procedure_code_system = "#{LOCAL}/CodeSystem/#{order_type}-procedure-code"
        def material_quantity_ext = "#{LOCAL}/StructureDefinition/#{order_type}-material-quantity"

        def performed? = source == :procedure

        # 項目コード → レセ電算の診療行為コード。未設定は結果に現れない。
        def receipt_codes(item_codes)
          return {} if item_codes.empty?

          model.where(code_column => item_codes)
               .where.not(receipt_code: [nil, ""])
               .pluck(code_column, :receipt_code).to_h
        end

        # 実施入力を要る項目が 1 つでもあるか。列を持たないマスタ(手術)は常に要る。
        # 部門の一覧が「実施入力をしない項目だけなら記録を作らず Task を実施済にする」
        # 判定に使う規則と同じ(セットは撮影そのものではないので数えない)。
        def perform_input_required?(item_codes)
          return true if item_codes.empty?
          return true unless model.column_names.include?("requires_perform_input")

          scope = model.where(code_column => item_codes)
          scope = scope.where.not(kind: "set") if model.column_names.include?("kind")
          rows = scope.pluck(:requires_perform_input)
          rows.empty? || rows.any?
        end
      end

      ALL = [
        Definition.new(order_type: "lab", label: "検体検査", model_name: "Master::LabOrderItem",
                       code_column: :order_item_code, source: :order),
        Definition.new(order_type: "micro", label: "細菌検査", model_name: "Master::MicroOrderItem",
                       code_column: :item_code, source: :order),
        Definition.new(order_type: "physio", label: "生理検査", model_name: "Master::PhysioItem",
                       code_column: :item_code, source: :procedure),
        Definition.new(order_type: "endoscopy", label: "内視鏡", model_name: "Master::EndoscopyItem",
                       code_column: :item_code, source: :procedure),
        Definition.new(order_type: "rad", label: "放射線検査", model_name: "Master::RadItem",
                       code_column: :item_code, source: :procedure),
        Definition.new(order_type: "treatment", label: "処置", model_name: "Master::TreatmentItem",
                       code_column: :item_code, source: :procedure),
        Definition.new(order_type: "surgery", label: "手術", model_name: "Master::SurgeryItem",
                       code_column: :item_code, source: :procedure)
      ].freeze

      BY_TYPE = ALL.index_by(&:order_type).freeze

      # 送り方が未実装の種別(docs/receipt-billing-design.md の Phase 2〜3)。
      PENDING = {
        "injection" => "注射",
        "transfusion" => "輸血",
        "pathology" => "病理検査",
        "rehab" => "リハビリ",
        "radiotherapy" => "放射線治療",
        "nutrition-guidance" => "栄養指導"
      }.freeze

      # 出来高で請求する項目が無い種別と、別経路で送る処方。報告もしない。
      IGNORED = %w[prescription meal nursing consult chemo-regimen].freeze

      # 用法マスタの基本区分コード(1=内服 2=外用 3=注射 4=注入)。
      USAGE_CATEGORY_ORAL = "1".freeze
      USAGE_CATEGORY_TOPICAL = "2".freeze

      module_function

      def find(order_type) = BY_TYPE[order_type]

      def pending_label(order_type) = PENDING[order_type]

      def ignored?(order_type) = IGNORED.include?(order_type)
    end
  end
end
