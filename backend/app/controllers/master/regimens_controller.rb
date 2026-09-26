module Master
  # 化学療法レジメンマスタ(docs/chemo-regimen-design.md)。
  #
  # 本体と子(適応疾患・投与ステップ・薬剤・検査基準・副作用)を 1 リクエストで
  # 読み書きする。子は配列を丸ごと置換し、display_order は配列順で振り直す
  # (order_sets の entries と同じ)。外部キーは張らないので削除は transaction で片付ける。
  class RegimensController < BaseController
    include VersionedMaster

    def index
      scope = Master::Regimen.all
      scope = scope.where(department_code: params[:department_code]) if params[:department_code].present?
      scope = scope.where(status: params[:status]) if params[:status].present?
      scope = scope.where(purpose: params[:purpose]) if params[:purpose].present?
      scope = scope.active_on if params[:active] == "true"
      # この薬剤を含むレジメン(カンマ区切りで複数指定可、いずれかを含めばよい)。
      if params[:medicine_code].present?
        codes = Master::RegimenDrug.where(medicine_code: params[:medicine_code].split(","))
                                   .select(:regimen_code)
        scope = scope.where(regimen_code: codes)
      end
      query = params[:name].presence || params[:keyword].presence
      scope = flexible_name_match(scope, query, SEARCH_COLUMNS) if query

      result = paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:regimen_code))
      result[:items] = result[:items].map { |r| summary(r) }
      render json: result
    end

    private

    REGIMEN_ATTRS = %i[
      regimen_code name short_name name_kana department_code department_name purpose setting
      treatment_days rest_days planned_cycles emetic_risk status approved_on approved_by
      indication_note discontinuation_criteria dose_reduction_criteria references_note
      valid_from valid_to display_order note copied_from_code
    ].freeze

    INDICATION_ATTRS = %w[management_number name icd10].freeze
    STEP_ATTRS = %w[name days usage_type route_code method_code line_code infusion_minutes rate
                    device_note usage_code dose_days note].freeze
    DRUG_ATTRS = %w[drug_role medicine_code dose_basis dose_value dose_unit dose_max note].freeze
    LAB_CRITERION_ATTRS = %w[category analyte_code item_name unit lower_limit upper_limit note].freeze
    ADVERSE_EVENT_ATTRS = %w[term grade note].freeze
    USAGE_ATTRS = %i[
      id usage_code usage_name basic_usage_category_code basic_usage_category
      detailed_usage_category_code detailed_usage_category timing_category_code timing_category
    ].freeze

    def record_params
      params.permit(*REGIMEN_ATTRS)
    end

    def child_param_keys
      %i[indications steps lab_criteria adverse_events]
    end

    def master_label
      "レジメン"
    end

    def parent_id_columns
      %w[step_id]
    end

    # 子の配列が来た種別だけ置換する(来ていない種別は触らない)。
    def replace_children(record)
      code = record.regimen_code
      if params.key?(:indications)
        Master::RegimenIndication.where(regimen_code: code).delete_all
        insert_rows(Master::RegimenIndication, child_rows(params[:indications], INDICATION_ATTRS, code))
      end
      if params.key?(:steps)
        Master::RegimenDrug.where(regimen_code: code).delete_all
        Master::RegimenStep.where(regimen_code: code).delete_all
        insert_step_tree(code, params[:steps])
      end
      if params.key?(:lab_criteria)
        Master::RegimenLabCriterion.where(regimen_code: code).delete_all
        insert_rows(Master::RegimenLabCriterion, child_rows(params[:lab_criteria], LAB_CRITERION_ATTRS, code))
      end
      return unless params.key?(:adverse_events)

      Master::RegimenAdverseEvent.where(regimen_code: code).delete_all
      insert_rows(Master::RegimenAdverseEvent, child_rows(params[:adverse_events], ADVERSE_EVENT_ATTRS, code))
    end

    # 配列の並びを display_order に振り直した行。
    def child_rows(raw, attrs, code)
      rows = []
      each_row(raw) do |row, index|
        rows << row.slice(*attrs).merge("regimen_code" => code, "display_order" => index + 1)
      end
      rows
    end

    # 投与ステップと薬剤を、階層ごとに 1 回の INSERT で入れる。薬剤の step_id は
    # 入れたステップの id に付け替える。
    def insert_step_tree(code, raw_steps)
      step_rows = []
      drugs = [] # [親のステップの添字, 薬剤の行, ステップ内の並び]
      each_row(raw_steps) do |row, index|
        step_rows << row.slice(*STEP_ATTRS).merge("regimen_code" => code, "display_order" => index + 1,
                                                  "days" => normalize_days(row["days"]))
        each_row(row["drugs"]) { |drug, drug_index| drugs << [index, drug, drug_index] }
      end
      # ステップは regimen_code の中で display_order が一意(配列の並びで振り直している)。
      step_ids = insert_rows(Master::RegimenStep, step_rows, unique_by: %w[display_order])

      drug_rows = drugs.map do |step_index, row, index|
        row.slice(*DRUG_ATTRS).merge("regimen_code" => code, "step_id" => step_ids[step_index],
                                     "display_order" => index + 1)
      end
      insert_rows(Master::RegimenDrug, drug_rows)
    end

    # 投与ステップと、ステップごとの薬剤(薬剤マスタの名称付き)。保存後の検証と応答の
    # 組み立てで同じものを使い、子テーブルを読むのは 1 回で済ませる。
    RegimenTree = Struct.new(:steps, :drugs_by_step, keyword_init: true)

    def load_tree(regimen)
      steps = Master::RegimenStep.where(regimen_code: regimen.regimen_code).in_display_order.to_a
      drugs = Master::RegimenDrug.with_names.where(step_id: steps.map(&:id)).in_display_order
      RegimenTree.new(steps: steps, drugs_by_step: drugs.group_by(&:step_id))
    end

    # 画面でしか分からない検証ではなく、**どの入口から来ても効かせたい検証**をここに置く
    # (画面の validateRegimenDraft は入力中の案内で、API を直に叩けば素通りする)。
    #
    # ［決定］下書きは緩く、承認で厳しくする。書きかけを保存できるのは編集の前提で、
    # 承認は「これで運用する」という宣言だから(§8.17)。
    def validate_content!(record, tree)
      messages = always_invalid_messages(record, tree)
      messages += approval_invalid_messages(tree) if record.status == "approved"
      raise ContentInvalid, messages if messages.any?
    end

    # 下書きでも通さないもの。1 クールに収まらない投与日は、暦にもクールの進捗にも
    # 載せられない(オーダーに展開できない)。
    def always_invalid_messages(record, tree)
      cycle = record.cycle_days
      return [] if cycle <= 0

      tree.steps.flat_map do |step|
        label = step_label(step)
        days = Array(step.days).select { |d| d.is_a?(Integer) }
        over = days.select { |d| d > cycle }
        last = step.usage_type == "oral" && days.any? ? days.max + step.dose_days.to_i - 1 : 0
        [
          over.any? ? "#{label} の投与日 #{over.join(', ')} が 1 クール(#{cycle} 日)を超えています" : nil,
          last > cycle ? "#{label} の内服が 1 クール(#{cycle} 日)をはみ出します(#{days.max} 日目から #{step.dose_days} 日分)" : nil,
        ].compact
      end
    end

    # 承認するときだけ求める完全性。ここを通ったレジメンは、患者に適用したときに
    # 投与量が出せる(手入力に落ちない)。
    def approval_invalid_messages(tree)
      steps = tree.steps
      return ["投与ステップがありません"] if steps.empty?

      messages = steps.filter_map { |s| "#{step_label(s)} に薬剤がありません" if tree.drugs_by_step[s.id].blank? }
      messages + tree.drugs_by_step.values.flatten.flat_map { |drug| drug_approval_messages(drug) }
    end

    def drug_approval_messages(drug)
      name = drug.resolved_name.presence || drug.medicine_code
      abolished = retirement_date(drug.abolished_on)
      transitional = retirement_date(drug.transitional_measure_on)
      [
        drug.dose_value.blank? ? "#{name} の基準値がありません" : nil,
        drug.dose_unit.blank? ? "#{name} の単位がありません" : nil,
        # 経過措置・削除済みの医薬品は、承認したレジメンで使い続けられない。
        abolished ? "#{name} は #{abolished} で薬価基準から削除された医薬品です" : nil,
        transitional ? "#{name} は #{transitional} で経過措置になった医薬品です" : nil,
      ].compact
    end

    # 薬価基準の日付欄は「なし」を 99999999 や 0 で表す(空欄にならない)。実在する
    # 日付のときだけ YYYY-MM-DD にして返す。
    def retirement_date(value)
      raw = value.to_s
      return nil unless raw.match?(/\A\d{8}\z/) && raw != "99999999"

      "#{raw[0, 4]}-#{raw[4, 2]}-#{raw[6, 2]}"
    end

    def step_label(step)
      order = step.display_order || "?"
      step.name.present? ? "ステップ #{order}(#{step.name})" : "ステップ #{order}"
    end

    # 投与日は "1,8,15" の文字列でも配列でも受ける。整数に直せないものは
    # そのまま残してモデルの検証に落とす。
    def normalize_days(raw)
      values = raw.is_a?(String) ? raw.split(/[,、\s]+/) : Array(raw)
      values.reject(&:blank?).map { |v| Integer(v.to_s, exception: false) || v }
    end

    # 子を階層ごとにまとめて写す(1 階層 1 回の INSERT)。薬剤の step_id は写したステップの id に
    # 付け替える。ステップには親の中で一意な自然キーが無いので、並びどおりに振り直した
    # display_order(置換と同じ規則)を付け替えのキーにする。
    def copy_children(source, target)
      to = target.regimen_code
      insert_copies(Master::RegimenIndication, source.indications.to_a, [], to)
      steps = source.steps.to_a
      orders = steps.each_with_index.to_h { |step, index| [step.id, index + 1] }
      step_ids = insert_copies(Master::RegimenStep, steps, %w[display_order], to) do |step|
        { "display_order" => orders[step.id] }
      end
      drugs = Master::RegimenDrug.where(step_id: steps.map(&:id)).in_display_order.to_a
      insert_copies(Master::RegimenDrug, drugs, [], to) { |drug| { "step_id" => step_ids[drug.step_id] } }
      insert_copies(Master::RegimenLabCriterion, source.lab_criteria.to_a, [], to)
      insert_copies(Master::RegimenAdverseEvent, source.adverse_events.to_a, [], to)
    end

    def delete_children(code)
      Master::RegimenDrug.where(regimen_code: code).delete_all
      Master::RegimenStep.where(regimen_code: code).delete_all
      Master::RegimenIndication.where(regimen_code: code).delete_all
      Master::RegimenLabCriterion.where(regimen_code: code).delete_all
      Master::RegimenAdverseEvent.where(regimen_code: code).delete_all
    end

    def summary(regimen)
      regimen.as_json(except: %w[search_name search_kana search_short_name]).merge("cycle_days" => regimen.cycle_days)
    end

    # 詳細は子を名称付きで同梱し、画面が 1 リクエストで開けるようにする
    # (薬剤名は薬剤マスタ、内服の用法名は用法マスタから引く)。
    def detail(regimen, tree = load_tree(regimen))
      steps = tree.steps
      drugs_by_step = tree.drugs_by_step
      # 内服の用法は名称だけでなく区分も添える(レジメンオーダーが処方に写すとき、
      # 用法マスタを引き直さずに済むように)。
      usages = Master::MedicineUsage.where(usage_code: steps.filter_map(&:usage_code))
                                    .index_by(&:usage_code)
      summary(regimen).merge(
        "indications" => regimen.indications.as_json,
        "steps" => steps.map do |s|
          s.as_json.merge(
            "usage" => usages[s.usage_code]&.as_json(only: USAGE_ATTRS),
            "drugs" => (drugs_by_step[s.id] || []).as_json,
          )
        end,
        "lab_criteria" => regimen.lab_criteria.as_json,
        "adverse_events" => regimen.adverse_events.as_json,
      )
    end
  end
end
