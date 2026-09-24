module LabImport
  # 中間表現(Message::Root) → 取込行の属性の配列。
  #
  # 患者・オーダー・検体のヘッダは行に非正規化する。保留になる単位が行(項目)で、
  # 候補のまとまりは group_no で復元できるため、レポート候補のテーブルを別に持たない。
  module RowBuilder
    module_function

    def build(message)
      sequence = 0
      message.reports.each_with_index.flat_map do |report, index|
        header = header_attributes(report)
        report.observations.map do |observation|
          sequence += 1
          header.merge(group_no: index + 1, sequence: sequence)
                .merge(observation_attributes(observation))
        end
      end
    end

    def header_attributes(report)
      patient = report.patient
      specimen = report.specimens.first
      {
        patient_number: patient&.number,
        patient_name: patient&.name,
        patient_birth_date: patient&.birth_date,
        patient_sex: patient&.sex,
        setting: patient&.setting,
        placer_order_number: report.placer_order_number,
        filler_order_number: report.filler_order_number,
        specimen_ids: report.specimens.flat_map(&:ids).uniq,
        # ラベル番号の候補順は SPM-2 → OBR-2 → ORC-2。検体に付いた番号が最も確かなため。
        label_number: LabelNumber.pick(report.order_number_candidates),
        specimen_material_code: specimen&.material_code,
        specimen_material_name: specimen&.material_name,
        # 採取日時は OBR-7 が正。無ければ検体(SPM-17)から。
        collected_at: report.collected_at || specimen&.collected_at,
        reported_at: report.reported_at,
        report_status: report.status,
        report_comment: report.comments.join("\n").presence
      }
    end

    def observation_attributes(observation)
      {
        external_code: observation.code,
        external_name: observation.name,
        external_code_system: observation.code_system,
        jlac10_code: observation.jlac10,
        jlac11_code: observation.jlac11,
        value_type: observation.value_type,
        value: observation.value,
        value_text: observation.value_text,
        value_code_system: observation.value_code_system,
        unit: observation.unit,
        reference_range: observation.reference_range,
        abnormal_flag: observation.abnormal_flag,
        observation_status: observation.status,
        observed_at: observation.observed_at,
        note: observation.notes.join("\n").presence
      }
    end
  end
end
