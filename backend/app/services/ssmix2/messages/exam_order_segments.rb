module Ssmix2
  module Messages
    # 放射線・内視鏡・生理のオーダー(OMG^O19)と実施(OMI^Z23)で共通の、親子レコードと検査項目コードの組み立て。
    # オーダー制御(NW / CA)・親(PA)・子(CH)の ORC / TQ1 / OBR を、ヘッダーと末端の明細から並べる。
    module ExamOrderSegments
      # 種別ごとの約束。item_system は明細の項目コード、local は OBR-4 に書くローカルのコード体系名。
      KINDS = {
        "rad" => { order_kind: "OMG-01", perform_kind: "OMG-11", item_system: Fhir::RAD_ORDER_ITEM_SYSTEM,
                   exam_type_system: Fhir::JJ1017_MODALITY_SYSTEM, local: "99ZRI", parent_local: "99ZRM",
                   procedure_system: Fhir::RAD_PROCEDURE_CODE_SYSTEM, procedure_local: "99ZRP" },
        "endoscopy" => { order_kind: "OMG-02", perform_kind: "OMG-12", item_system: Fhir::ENDOSCOPY_ORDER_ITEM_SYSTEM,
                         exam_type_system: Fhir::ENDOSCOPY_EXAM_TYPE_SYSTEM, local: "99ZEI", parent_local: "99ZEE",
                         procedure_system: Fhir::ENDOSCOPY_PROCEDURE_CODE_SYSTEM, procedure_local: "99ZEP" },
        "physio" => { order_kind: "OMG-03", item_system: Fhir::PHYSIO_ORDER_ITEM_SYSTEM,
                      exam_type_system: Fhir::PHYSIO_EXAM_TYPE_SYSTEM, local: "99ZPI", parent_local: "99ZPE",
                      procedure_system: Fhir::PHYSIO_PROCEDURE_CODE_SYSTEM, procedure_local: "99ZPP" }
      }.freeze

      private

      # 末端の明細(セットを構成項目に展開)を項目番号の順に。
      def exam_items(header, spec)
        items = item_requests_of(header, spec[:item_system])
        leaf_items(top_level_items(header, items), items).sort_by { |sr| [item_number(sr), sr["id"].to_s] }
      end

      # 親オーダーの OBR-4。放射線は JJ1017-16P(モダリティ + 手技大分類)、内視鏡・生理は検査種別のローカルコード。
      def parent_code_cwe(spec, leaves)
        first = leaves.first
        exam_type = Fhir.category_coding(first, spec[:exam_type_system])
        local = exam_type ? [exam_type["code"], exam_type["display"], spec[:parent_local]] : nil
        jj16m = Fhir.coding(first&.dig("code"), Fhir::JJ1017_16M_SYSTEM)&.dig("code")
        parent = Codes.jj1017_16p(jj16m)
        return Hl7::Types.cwe(parent, exam_type&.dig("display"), "JJ1017", alt: local) if parent
        return "" if local.nil?

        Hl7::Types.cwe("", "", "", alt: local)
      end

      # 子オーダーの OBR-4。放射線は JJ1017-32 にローカルを併記、他はローカルコード。
      def item_code_cwe(spec, item)
        local = Fhir.coding(item["code"], spec[:item_system])
        name = Fhir.display_of(item["code"])
        local_parts = [local&.dig("code"), local&.dig("display") || name, spec[:local]]
        jj32 = Fhir.coding(item["code"], Fhir::JJ1017_32_SYSTEM)
        return Hl7::Types.cwe(jj32["code"], jj32["display"] || name, "JJ1017", alt: local_parts) if jj32

        Hl7::Types.cwe(*local_parts)
      end

      # TQ1。検査予定日時と優先度。
      def exam_tq1(header)
        tq1(7 => Hl7::Stamp.format(header["occurrenceDateTime"], precision: :minute), 9 => Codes.priority_cwe(header["priority"]))
      end

      # OBR。extra は OBR-n(1 始まり)→ 値(実施では OBR-3 / OBR-7 / OBR-22 / OBR-25)。
      def exam_obr(order_no, code_cwe, header, parent_no: nil, extra: {})
        fields = Array.new(49, "")
        fields[1] = Hl7::Types.ei(order_no)
        fields[3] = code_cwe
        requester = header&.dig("requester", "reference")
        fields[15] = practitioner_xcn(requester) if requester.present?
        fields[28] = Hl7::Types.ei(parent_no) if parent_no
        extra.each { |index, value| fields[index - 1] = value }
        builder.add("OBR", *fields)
      end

      # 子オーダーのオーダ No。明細の ServiceRequest で採番する(同じ明細の修正・取消は同じ番号)。
      def child_order_no(item) = OrderNumber.for("ServiceRequest/#{item['id']}")
    end
  end
end
