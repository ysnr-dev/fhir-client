module Master
  # 化学療法レジメンマスタ(docs/chemo-regimen-design.md)。
  #
  # 本体と子(適応疾患・投与ステップ・薬剤・検査基準・副作用)を 1 リクエストで
  # 読み書きする。子は配列を丸ごと置換し、display_order は配列順で振り直す
  # (order_sets の entries と同じ)。外部キーは張らないので削除は transaction で片付ける。
  class RegimensController < BaseController
    before_action :set_record, only: %i[show update destroy copy]

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

    def show
      render json: detail(@record)
    end

    def create
      record = Master::Regimen.new(record_params.merge(approval_attrs(nil, record_params[:status])))
      record.regimen_code = next_regimen_code if record.regimen_code.blank?
      Master::Regimen.transaction do
        record.save!
        replace_children(record)
        validate_content!(record)
      end
      render json: detail(record), status: :created
    rescue ActiveRecord::RecordInvalid => e
      render_validation_errors(e.record)
    rescue ContentInvalid => e
      render json: { errors: e.messages }, status: :unprocessable_content
    end

    def update
      return render_frozen if frozen_change?
      return render_unapproval if unapproving?

      Master::Regimen.transaction do
        @record.update!(update_params)
        replace_children(@record)
        validate_content!(@record)
      end
      render json: detail(@record)
    rescue ActiveRecord::RecordInvalid => e
      render_validation_errors(e.record)
    rescue ContentInvalid => e
      render json: { errors: e.messages }, status: :unprocessable_content
    end

    # 複製。派生レジメン(減量版・隔週版)の作り方。コードは新しく採番し、
    # 承認は引き継がず下書きに戻す。
    def copy
      target = Master::Regimen.new(
        @record.attributes.except("id", "regimen_code", "created_at", "updated_at",
                                  "status", "approved_on", "approved_by",
                                  "search_name", "search_kana", "search_short_name"),
      )
      target.regimen_code = next_regimen_code
      target.name = params[:name].presence || "#{@record.name}のコピー"
      target.status = "draft"
      # 改訂の系列を辿れるようにする(承認済は凍結し、直すときは複製するため)。
      target.copied_from_code = @record.regimen_code
      # 有効期間・表示順は複製元の都合なので引き継がない(新しい版として決め直す)。
      target.valid_from = nil
      target.valid_to = nil
      target.display_order = nil
      Master::Regimen.transaction do
        target.save!
        copy_children(@record, target)
      end
      render json: detail(target), status: :created
    rescue ActiveRecord::RecordInvalid => e
      render_validation_errors(e.record)
    end

    # 削除できるのは下書きだけ。承認済・廃止は施設の記録で、患者への適用が
    # `instantiatesUri` で指しているため残す(§8.17)。
    def destroy
      if @record.status != "draft"
        return render json: { errors: ["承認済・廃止のレジメンは削除できません。廃止にして使わないようにしてください"] },
                      status: :unprocessable_content
      end

      Master::Regimen.transaction do
        delete_children(@record.regimen_code)
        @record.destroy!
      end
      head :no_content
    end

    private

    # 内容の検証に落ちたとき(モデル単体では判定できないもの)。
    class ContentInvalid < StandardError
      attr_reader :messages

      def initialize(messages)
        @messages = messages
        super(messages.join(" / "))
      end
    end

    SEARCH_COLUMNS = %w[search_name search_kana search_short_name].freeze

    REGIMEN_ATTRS = %i[
      regimen_code name short_name name_kana department_code department_name purpose setting
      treatment_days rest_days planned_cycles emetic_risk status approved_on approved_by
      indication_note discontinuation_criteria dose_reduction_criteria references_note
      valid_from valid_to display_order note copied_from_code
    ].freeze

    # 承認済・廃止でも動かせる項目。内容(オーダーに影響するもの)は凍結し、
    # 「使うのをやめる」「並び順を変える」操作だけ残す(§8.17)。
    FROZEN_EDITABLE_ATTRS = %i[status valid_from valid_to display_order].freeze
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

    # 更新で受ける値。承認日・承認者はサーバーが決める(画面からは送らせない)。
    def update_params
      permitted = record_params.except(:regimen_code, :approved_on, :approved_by)
      permitted = permitted.slice(*FROZEN_EDITABLE_ATTRS) if frozen_record?
      permitted.merge(approval_attrs(@record.status, permitted[:status]))
    end

    # 承認済・廃止のレジメンか(= 内容を凍結する)。
    def frozen_record?
      %w[approved retired].include?(@record.status)
    end

    # 凍結中に内容を変えようとしているか。子が 1 種類でも送られていれば内容の変更。
    def frozen_change?
      return false unless frozen_record?

      children_sent = %i[indications steps lab_criteria adverse_events].any? { |k| params.key?(k) }
      content_sent = record_params.except(:regimen_code, :approved_on, :approved_by, *FROZEN_EDITABLE_ATTRS)
                                  .to_h.any? { |k, v| @record[k].to_s != v.to_s }
      children_sent || content_sent
    end

    # 承認済・廃止から下書きへは戻せない。戻せると「下書きにしてから直す」で凍結を
    # すり抜けられるため(§8.17)。使うのをやめるときは廃止にする。
    def unapproving?
      frozen_record? && record_params[:status] == "draft"
    end

    def render_unapproval
      render json: {
        errors: ["承認を取り消せません。使わないようにするには廃止にしてください"],
      }, status: :unprocessable_content
    end

    def render_frozen
      render json: {
        errors: ["承認済・廃止のレジメンは内容を変更できません。複製して新しいレジメンとして直してください"],
      }, status: :unprocessable_content
    end

    # 承認の記録はサーバーが入れる(画面の手入力にしない)。下書き・廃止へ戻したら消す。
    def approval_attrs(previous_status, next_status)
      return {} if next_status.blank? || previous_status == next_status

      next_status == "approved" ? { approved_on: Date.current, approved_by: approver_id } : {}
    end

    # 承認者。認証なしモード(開発)ではパラメータを通す(order_sets の持ち主と同じ扱い)。
    def approver_id
      return params[:approved_by].presence if @user_auth == :none

      current_user&.practitioner_fhir_id
    end

    # サンプル(db/seed_data/regimens.csv)が使う帯。施設の採番はこの手前で行う。
    SAMPLE_CODE_FLOOR = 900_000

    # 数字だけのレジメンコードの最大値の次(他マスタと同じ採番)。サンプルの 9000xx は
    # 数えない(数えると seed 投入後の 1 件目が 900011 になり、帯を分けた意味が無くなる)。
    def next_regimen_code
      max = Master::Regimen.where("regimen_code ~ '^[0-9]+$'")
                           .where("regimen_code::bigint < ?", SAMPLE_CODE_FLOOR)
                           .maximum(Arel.sql("regimen_code::bigint"))
      ((max || 0) + 1).to_s.rjust(6, "0")
    end

    def set_record
      @record = Master::Regimen.find_by(regimen_code: params[:id]) || Master::Regimen.find(params[:id])
    end

    # 子の配列が来た種別だけ置換する(来ていない種別は触らない)。
    def replace_children(record)
      code = record.regimen_code
      if params.key?(:indications)
        Master::RegimenIndication.where(regimen_code: code).delete_all
        each_row(params[:indications]) do |row, index|
          Master::RegimenIndication.create!(row.slice(*INDICATION_ATTRS).merge(regimen_code: code, display_order: index + 1))
        end
      end
      if params.key?(:steps)
        Master::RegimenDrug.where(regimen_code: code).delete_all
        Master::RegimenStep.where(regimen_code: code).delete_all
        each_row(params[:steps]) do |row, index|
          step = Master::RegimenStep.create!(
            row.slice(*STEP_ATTRS).merge(regimen_code: code, display_order: index + 1, days: normalize_days(row["days"])),
          )
          each_row(row["drugs"]) do |drug, drug_index|
            Master::RegimenDrug.create!(
              drug.slice(*DRUG_ATTRS).merge(regimen_code: code, step_id: step.id, display_order: drug_index + 1),
            )
          end
        end
      end
      if params.key?(:lab_criteria)
        Master::RegimenLabCriterion.where(regimen_code: code).delete_all
        each_row(params[:lab_criteria]) do |row, index|
          Master::RegimenLabCriterion.create!(row.slice(*LAB_CRITERION_ATTRS).merge(regimen_code: code, display_order: index + 1))
        end
      end
      return unless params.key?(:adverse_events)

      Master::RegimenAdverseEvent.where(regimen_code: code).delete_all
      each_row(params[:adverse_events]) do |row, index|
        Master::RegimenAdverseEvent.create!(row.slice(*ADVERSE_EVENT_ATTRS).merge(regimen_code: code, display_order: index + 1))
      end
    end

    # 画面でしか分からない検証ではなく、**どの入口から来ても効かせたい検証**をここに置く
    # (画面の validateRegimenDraft は入力中の案内で、API を直に叩けば素通りする)。
    #
    # ［決定］下書きは緩く、承認で厳しくする。書きかけを保存できるのは編集の前提で、
    # 承認は「これで運用する」という宣言だから(§8.17)。
    def validate_content!(record)
      messages = always_invalid_messages(record)
      messages += approval_invalid_messages(record) if record.status == "approved"
      raise ContentInvalid, messages if messages.any?
    end

    # 下書きでも通さないもの。1 クールに収まらない投与日は、暦にもクールの進捗にも
    # 載せられない(オーダーに展開できない)。
    def always_invalid_messages(record)
      cycle = record.cycle_days
      return [] if cycle <= 0

      record.steps.flat_map do |step|
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
    def approval_invalid_messages(record)
      steps = record.steps.to_a
      return ["投与ステップがありません"] if steps.empty?

      drugs = Master::RegimenDrug.with_names.where(step_id: steps.map(&:id)).to_a
      by_step = drugs.group_by(&:step_id)
      messages = steps.filter_map { |s| "#{step_label(s)} に薬剤がありません" if by_step[s.id].blank? }
      messages + drugs.flat_map { |drug| drug_approval_messages(drug) }
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

    def each_row(raw)
      Array(raw).each_with_index do |row, index|
        row = row.to_unsafe_h if row.respond_to?(:to_unsafe_h)
        yield row.to_h.stringify_keys, index
      end
    end

    # 投与日は "1,8,15" の文字列でも配列でも受ける。整数に直せないものは
    # そのまま残してモデルの検証に落とす。
    def normalize_days(raw)
      values = raw.is_a?(String) ? raw.split(/[,、\s]+/) : Array(raw)
      values.reject(&:blank?).map { |v| Integer(v.to_s, exception: false) || v }
    end

    def copy_children(source, target)
      code = target.regimen_code
      source.indications.each { |r| Master::RegimenIndication.create!(child_attrs(r).merge(regimen_code: code)) }
      source.steps.each do |step|
        copied = Master::RegimenStep.create!(child_attrs(step).merge(regimen_code: code))
        step.drugs.each do |drug|
          Master::RegimenDrug.create!(child_attrs(drug).merge(regimen_code: code, step_id: copied.id))
        end
      end
      source.lab_criteria.each { |r| Master::RegimenLabCriterion.create!(child_attrs(r).merge(regimen_code: code)) }
      source.adverse_events.each { |r| Master::RegimenAdverseEvent.create!(child_attrs(r).merge(regimen_code: code)) }
    end

    def child_attrs(record)
      record.attributes.except("id", "regimen_code", "step_id", "created_at", "updated_at")
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
    def detail(regimen)
      steps = regimen.steps.to_a
      drugs_by_step = Master::RegimenDrug.with_names.where(step_id: steps.map(&:id)).in_display_order.group_by(&:step_id)
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
