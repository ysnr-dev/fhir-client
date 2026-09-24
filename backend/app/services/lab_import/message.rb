module LabImport
  # 取込ファイルの中間表現。パーサはここまでを作り、行(台帳)への変換は
  # RowBuilder が担う。CSV や FHIR Bundle を足すときも同じ型を返せばよいので、
  # HL7 固有の語彙(セグメント名・フィールド番号)はここから先に出さない。
  #
  # パース中に育てるので Data ではなく Struct にしている。
  module Message
    Patient = Struct.new(:number, :name, :birth_date, :sex, :setting, keyword_init: true)

    Specimen = Struct.new(:ids, :material_code, :material_name, :collected_at,
                          keyword_init: true)

    Observation = Struct.new(:set_id, :value_type, :code, :name, :code_system,
                             :jlac10, :jlac11, :value, :value_text, :value_code_system,
                             :unit, :reference_range, :abnormal_flag, :status,
                             :observed_at, :notes, keyword_init: true)

    # ORC / OBR で切れる 1 つのまとまり。上流の DiagnosticReport 1 件になる。
    Report = Struct.new(:patient, :placer_order_number, :filler_order_number,
                        :code, :code_name, :collected_at, :reported_at, :status,
                        :comments, :specimens, :observations, keyword_init: true) do
      def self.start(patient, specimens)
        new(patient: patient, specimens: specimens, comments: [], observations: [])
      end

      def order_number_candidates
        specimens.flat_map { |specimen| specimen.ids } + [placer_order_number, filler_order_number]
      end
    end

    Root = Struct.new(:source, :message_type, :control_id, :sent_at, :charset, :reports,
                      keyword_init: true)
  end
end
