module Master
  # 取込行の更新。保留行の引き当てを人が決める経路と、上流へ登録した後の書き戻し。
  #
  # 応答は「更新した全行」にしている。1 行の更新が同じ外部コードの他の行にも及ぶ
  # (apply_to_same_code)ため、画面はこれでキャッシュを差し替える。
  class LabResultImportRowsController < BaseController
    before_action :set_record, only: %i[update]

    def update
      rows = apply(Array(@record), update_params)
      render json: { rows: rows.as_json }.merge(master_conflict_payload)
    end

    # 候補ごとの書き戻し(患者・オーダー・レポートの id、まとめて対象外にする)。
    def bulk_update
      records = LabResultImportRow.where(id: Array(params[:ids])).ordered.to_a
      return render json: { rows: [] } if records.empty?

      rows = apply(records, update_params)
      render json: { rows: rows.as_json }.merge(master_conflict_payload)
    end

    private

    def model_class = LabResultImportRow

    def update_params
      params.permit(:result_item_code, :status, :value, :patient_fhir_id, :order_fhir_id,
                    :report_fhir_id, :registered_by_practitioner_id,
                    :write_to_master, :apply_to_same_code)
    end

    def apply(records, attrs)
      @master_conflict = false
      resolver = LabImport::ItemResolver.new
      touched = records.flat_map { |record| apply_to_row(record, attrs, resolver) }
      touched.uniq!(&:id)
      LabResultImportRow.transaction { touched.each(&:save!) }
      touched
    end

    def apply_to_row(row, attrs, resolver)
      value_changed = attrs.key?(:value)
      row.value = attrs[:value] if value_changed
      assign_links(row, attrs)

      rows = [row]
      if attrs[:result_item_code].present?
        item = write_to_master(row, attrs)
        rows += assign_item(row, attrs[:result_item_code], item, resolver)
        rows += same_code_rows(row, attrs, item, resolver) if truthy?(attrs[:apply_to_same_code])
      elsif attrs[:status].present?
        row.status = attrs[:status]
        row.pending_reason = nil unless row.status == "pending"
      elsif value_changed && row.result_item_code.present?
        # 値を直した行(選択肢外・数値でない)は、その場で判定し直して保留を外す。
        resolver.check_value(row, Master::LabResultItem.find_by(result_item_code: row.result_item_code))
      end
      rows
    end

    def assign_links(row, attrs)
      row.patient_fhir_id = attrs[:patient_fhir_id] if attrs.key?(:patient_fhir_id)
      row.order_fhir_id = attrs[:order_fhir_id] if attrs.key?(:order_fhir_id)
      return unless attrs.key?(:report_fhir_id)

      row.report_fhir_id = attrs[:report_fhir_id]
      return if row.report_fhir_id.blank?

      row.status = "registered"
      row.registered_at = Time.current
      row.registered_by_practitioner_id =
        attrs[:registered_by_practitioner_id].presence || current_user_payload&.dig(:practitioner_id)
    end

    def assign_item(row, result_item_code, item, resolver)
      row.result_item_code = result_item_code
      row.resolution = "manual"
      resolver.check_value(row, item)
      [row]
    end

    # 1 ファイルに同じ項目が何十行も入るので、同じ外部コードの保留行にも同時に反映する。
    # コードだけで束ねると体系違いの同じコードを巻き込むため、体系も条件に入れる。
    def same_code_rows(row, attrs, item, resolver)
      return [] if row.external_code.blank?

      siblings = LabResultImportRow
                 .where(lab_result_import_id: row.lab_result_import_id, status: "pending")
                 .where(external_code: row.external_code)
                 .where(external_code_system: row.external_code_system)
                 .where.not(id: row.id)
      siblings.map { |sibling| assign_item(sibling, attrs[:result_item_code], item, resolver).first }
    end

    # 取込元コード対応表の代わりに、施設の結果項目マスタの JLAC を育てる。
    # 空の列だけ埋め、既に値があって食い違うときは書かずに画面へ知らせる。
    def write_to_master(row, attrs)
      item = Master::LabResultItem.find_by(result_item_code: attrs[:result_item_code])
      return item if item.nil? || !truthy?(attrs[:write_to_master])

      { jlac10_code: row.jlac10_code, jlac11_code: row.jlac11_code }.each do |column, code|
        next if code.blank?

        current = item.public_send(column)
        if current.blank?
          item.public_send(:"#{column}=", code)
        elsif current != code
          @master_conflict = true
        end
      end
      item.save! if item.changed?
      item
    end

    def master_conflict_payload
      @master_conflict ? { master_conflict: true } : {}
    end

    def truthy?(value)
      ActiveModel::Type::Boolean.new.cast(value) ? true : false
    end
  end
end
