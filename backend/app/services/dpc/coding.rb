module Dpc
  # 入院 1 件の診断群分類を判定し、点数・入院期間と同じ分類内の候補(シミュレーション)を添える。
  # 保存はしない(決定の記録は画面が上流に書く)。
  #
  # 様式1 の値は画面が意味のある入力に直して渡す(inputs)。backend は様式1 の定義表を知らない。
  # 実施記録は入院期間の分を上流から集める(Dpc::PerformedItems)。
  class Coding
    class NotFound < StandardError; end

    def initialize(encounter_id:, inputs:, overrides:, store: Integrations::FhirStore.new)
      @encounter_id = encounter_id
      @inputs = (inputs || {}).to_h.deep_stringify_keys
      @overrides = (overrides || {}).to_h.deep_stringify_keys
      @store = store
    end

    def call
      encounter = store.read_or_nil("Encounter", encounter_id) || raise(NotFound, "Encounter/#{encounter_id}")
      patient_id = Integrations::ReceiptComputer::Coding.reference_id(encounter.dig("subject", "reference"))
      admitted_on = local_date(encounter.dig("period", "start")) || raise(NotFound, "入院日がありません")
      discharged_on = encounter["status"] == "finished" ? local_date(encounter.dig("period", "end")) : nil
      base_date = discharged_on || FacilityClock.today

      tables = Tables.for(base_date)
      return { edition: nil, warnings: ["DPC 電子点数表が取り込まれていません"] } unless tables.available?

      performed = PerformedItems.new(store: store).call(patient_fhir_id: patient_id, from: admitted_on, to: base_date)
      input = build_input(performed, birth_date(patient_id), admitted_on)
      grouped = Grouper.new(tables: tables, input: input).call
      stay = stay(admitted_on, discharged_on, base_date)

      grouped.merge(
        edition: tables.edition,
        base_date: base_date.to_s,
        stay: stay,
        result: result(tables, grouped, stay),
        simulation: simulation(tables, grouped, stay),
        coefficient: coefficient(base_date),
        warnings: grouped[:warnings] + (performed.truncated ? ["実施記録が多いため一部しか読めていません"] : [])
      )
    end

    private

    attr_reader :encounter_id, :inputs, :overrides, :store

    def build_input(performed, birth_date, admitted_on)
      surgeries = Array(inputs["surgeries"]).filter_map do |surgery|
        code = surgery["k_code"].to_s.strip
        next if code.empty?

        Item.new(code: code, name: surgery["name"], date: surgery["date"], source: "form1")
      end

      Input.new(
        icd10: inputs["icd10"].presence,
        comorbidity_icd10s: Array(inputs["comorbidity_icd10s"]).compact_blank,
        age: age_at(birth_date, admitted_on, months: false),
        month_age: age_at(birth_date, admitted_on, months: true),
        birth_weight: integer(inputs["birth_weight"]),
        jcs: integer(inputs["jcs"]),
        burn_index: integer(inputs["burn_index"]),
        gaf: integer(inputs["gaf"]),
        pregnancy_weeks: integer(inputs["pregnancy_weeks"]),
        delivery_bleeding: integer(inputs["delivery_bleeding"]),
        pneumonia_category: inputs["pneumonia_category"].presence,
        adrop: integer(inputs["adrop"]),
        stroke_onset: inputs["stroke_onset"].presence,
        child_pugh: integer(inputs["child_pugh"]),
        pancreatitis_a: integer(inputs["pancreatitis_a"]),
        pancreatitis_b: integer(inputs["pancreatitis_b"]),
        transfer: boolean(inputs["transfer"]),
        bilateral: boolean(inputs["bilateral"]),
        reoperation: boolean(inputs["reoperation"]),
        rehab: performed.rehab,
        radiotherapy: performed.radiotherapy,
        items: performed.items + surgeries,
        overrides: Overrides.new(
          mdc6: overrides["mdc6"].presence,
          branches: (overrides["branches"] || {}).transform_values(&:to_s).compact_blank,
          accepted: Array(overrides["accepted"]).map(&:to_s),
          rejected: Array(overrides["rejected"]).map(&:to_s)
        )
      )
    end

    def birth_date(patient_id)
      text = inputs["birth_date"].presence || store.read_or_nil("Patient", patient_id)&.dig("birthDate")
      text && Date.parse(text.to_s)
    rescue Date::Error
      nil
    end

    def age_at(birth_date, day, months:)
      return nil if birth_date.nil?

      total = ((day.year * 12) + day.month) - ((birth_date.year * 12) + birth_date.month)
      total -= 1 if day.day < birth_date.day
      months ? total : total.div(12)
    end

    # 入院日を 1 日目として基準日(退院日、入院中は今日)までの日数。
    def stay(admitted_on, discharged_on, base_date)
      { admitted_on: admitted_on.to_s, discharged_on: discharged_on&.to_s, days: (base_date - admitted_on).to_i + 1 }
    end

    def result(tables, grouped, stay)
      return nil unless grouped[:dpc_codes].size == 1

      code = grouped[:dpc_codes].first
      row = tables.points([code])[code]
      point_json(row, code, grouped, stay, tables.ccpms([code])[code])
    end

    # 同じ MDC6 の全分類。判定と食い違わないもの(consistent)と、いまの結果(current)に印を付ける。
    def simulation(tables, grouped, stay)
      return [] if grouped[:mdc6].nil?

      codes = tables.conversions(grouped[:mdc6]).map(&:dpc_code).uniq
      bundled = tables.conversions(grouped[:mdc6]).to_h { |row| [row.dpc_code, row.bundled] }
      rows = tables.points(codes)
      codes.map do |code|
        point_json(rows[code], code, { bundled: bundled }, stay, nil).merge(
          consistent: grouped[:dpc_codes].include?(code),
          current: grouped[:dpc_codes] == [code]
        )
      end
    end

    def point_json(row, code, grouped, stay, ccpm)
      days = [row&.days1, row&.days2, row&.days3]
      points = [row&.points1, row&.points2, row&.points3]
      admitted = Date.parse(stay[:admitted_on])
      {
        dpc_code: code,
        bundled: grouped[:bundled][code] == true,
        names: {
          disease: row&.disease_name, surgery: row&.surgery_name, proc1: row&.proc1_name, proc2: row&.proc2_name,
          comorbidity: row&.comorbidity_name, severity: row&.severity_name
        },
        days: days,
        points: points,
        period_ends: days.map { |d| d && (admitted + d - 1).to_s },
        estimated_points: estimated_points(days, points, stay[:days]),
        ccpm: ccpm
      }
    end

    # 入院期間Ⅰ・Ⅱ・Ⅲの日ごとの点数を在院日数ぶん足す。期間Ⅲを超えた日は出来高なので数えない。
    def estimated_points(days, points, stay_days)
      return nil if days.last.nil? || points.compact.empty?

      (1..stay_days).sum do |day|
        if day <= days[0].to_i then points[0].to_i
        elsif day <= days[1].to_i then (points[1] || points[2]).to_i
        elsif day <= days[2].to_i then points[2].to_i
        else 0
        end
      end
    end

    # 基準日に有効な医療機関別係数(適用開始日が基準日以前で最新)。
    def coefficient(base_date)
      from, value = FacilitySettings.dpc_coefficients.select { |day, _| day.to_s <= base_date.to_s }
                                                     .max_by { |day, _| day.to_s }
      from && { from: from, value: value }
    end

    def integer(value)
      value.to_s.match?(/\A\d+\z/) ? value.to_i : nil
    end

    def boolean(value)
      return nil if value.nil? || value == ""

      [true, "true", "1", 1].include?(value)
    end

    def local_date(value)
      text = Integrations::ReceiptComputer::LocalDate.of(value)
      text && Date.parse(text)
    end
  end
end
