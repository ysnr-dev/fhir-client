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

      # coded_hub: 実施記録のハブと子が手技コード(Procedure.code)を持つか。注射のハブは
      # 「注射」という text だけで手技は持たない(手技料は剤区分から連携先が算定する)。
      # resolver: 項目マスタで手技コードを引けない種別の変換(Resolvers)。実施記録の種別は
      # `call(record, order)`、オーダーの種別は `call(header, details)`。
      # continuous: 1 つのオーダーが期間続き、実施が日々積み上がる種別。occurrence は開始日
      # なので「その日に実施記録が無い = 未実施」とは言えず、無くても報告しない。
      Definition = Struct.new(:order_type, :label, :model_name, :code_column, :source, :coded_hub, :resolver,
                              :continuous, keyword_init: true) do
        def model = model_name&.constantize

        def coded_hub? = coded_hub != false && resolver.nil?

        def resolver_for(skipped:, store:) = resolver&.new(skipped: skipped, store: store)

        def coding_system = "#{LOCAL}/CodeSystem/#{order_type}-order-item"

        # 実施記録の手技コード体系と、usedCode に添える数量の拡張。
        # 5 種別とも frontend の *ResultHelpers が同じ規則で付けている。
        def procedure_code_system = "#{LOCAL}/CodeSystem/#{order_type}-procedure-code"
        def material_quantity_ext = "#{LOCAL}/StructureDefinition/#{order_type}-material-quantity"

        def performed? = source == :procedure

        # 項目コード → レセ電算の診療行為コード。未設定は結果に現れない。
        def receipt_codes(item_codes)
          return {} if item_codes.empty? || model.nil?

          model.where(code_column => item_codes)
               .where.not(receipt_code: [nil, ""])
               .pluck(code_column, :receipt_code).to_h
        end

        # 実施入力を要る項目が 1 つでもあるか。列を持たないマスタ(手術)は常に要る。
        # 部門の一覧が「実施入力をしない項目だけなら記録を作らず Task を実施済にする」
        # 判定に使う規則と同じ(セットは撮影そのものではないので数えない)。
        def perform_input_required?(item_codes)
          return true if item_codes.empty? || model.nil?
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
                       code_column: :item_code, source: :procedure),
        # 注射は項目マスタを持たず、薬剤(MedicationAdministration)だけを送る。
        Definition.new(order_type: "injection", label: "注射", source: :procedure, coded_hub: false),
        # 施設設定・照射技法マスタのコードで送る種別(docs/receipt-billing-design.md §5)。
        Definition.new(order_type: "pathology", label: "病理検査", source: :order, resolver: Resolvers::Pathology),
        Definition.new(order_type: "rehab", label: "リハビリ", source: :procedure, resolver: Resolvers::Rehab,
                       continuous: true),
        Definition.new(order_type: "nutrition-guidance", label: "栄養指導", source: :procedure,
                       resolver: Resolvers::NutritionGuidance, continuous: true),
        Definition.new(order_type: "radiotherapy", label: "放射線治療", source: :procedure,
                       resolver: Resolvers::Radiotherapy, continuous: true)
      ].freeze

      BY_TYPE = ALL.index_by(&:order_type).freeze

      # 送り方が未実装の種別(docs/receipt-billing-design.md の Phase 2〜3)。
      PENDING = {
        "transfusion" => "輸血"
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
