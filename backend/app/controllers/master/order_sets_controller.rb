module Master
  # オーダーセットの登録・参照。施設の参照表(マスタ)ではなく現場の医師が育てる
  # 運用データだが、ログイン認証・CSRF・エラー整形を /master の基底と共有するため
  # ここに置く(docs/order-set-design.md §1.2)。
  #
  # 認可: 医師かどうかは上流の PractitionerRole にしか無く backend からは引けない
  # ので、院内共通・診療科スコープの書き込みは画面側で医師に限る。backend が厳密に
  # 守るのは「医師スコープの持ち主はログイン本人」だけ。読み取りは誰でもできる
  # (代行入力で指示医師のセットをカルテから開くため)。
  class OrderSetsController < BaseController
    before_action :set_record, only: %i[show update destroy entries copy]
    before_action :authorize_practitioner_scope!, only: %i[update destroy entries]

    # 院内共通 + 指定した診療科 + 指定した医師のノードをフラットに全件返す。
    # ツリーの組み立てはフロント側(件数が少ない前提でページングしない)。
    def index
      sets = OrderSet.roots_for(
        department_id: params[:department_id].presence,
        practitioner_id: params[:practitioner_id].presence,
      ).ordered
      counts = OrderSetEntry.where(order_set_id: sets.map(&:id)).group(:order_set_id).count
      render json: { total: sets.size, items: sets.map { |s| summary(s, counts) } }
    end

    def show
      render json: detail(@record)
    end

    def create
      record = OrderSet.new(record_params)
      record.owner_id = forced_owner_id(record.scope) if record.scope == "practitioner"
      return render_forbidden if record.scope == "practitioner" && record.owner_id.blank?

      record.display_order = next_display_order(record) if params[:display_order].blank?
      OrderSet.transaction do
        record.save!
        replace_entries(record, params[:entries]) if params.key?(:entries)
      end
      render json: detail(record), status: :created
    rescue ActiveRecord::RecordInvalid => e
      render_validation_errors(e.record)
    end

    def update
      if @record.update(record_params.except(:kind, :scope, :owner_id, :owner_name))
        render json: detail(@record)
      else
        render_validation_errors(@record)
      end
    end

    # エントリの全置換。配列の順に display_order を 1 始まりで振り直す。
    def entries
      unless @record.kind == "set"
        return render json: { errors: ["フォルダにはエントリを登録できません"] },
                      status: :unprocessable_content
      end
      OrderSet.transaction { replace_entries(@record, params[:entries]) }
      render json: detail(@record.reload)
    rescue ActiveRecord::RecordInvalid => e
      render_validation_errors(e.record)
    end

    # 複製(別の持ち主・フォルダへの昇格にも使う)。code は新規に採番し entries も写す。
    def copy
      target = OrderSet.new(
        kind: @record.kind,
        scope: params[:scope].presence || @record.scope,
        owner_id: params[:owner_id].presence,
        owner_name: params[:owner_name].presence,
        parent_id: params[:parent_id].presence,
        name: params[:name].presence || "#{@record.name}のコピー",
        active: @record.active,
      )
      target.owner_id = forced_owner_id(target.scope) if target.scope == "practitioner"
      return render_forbidden if target.scope == "practitioner" && target.owner_id.blank?
      target.owner_id = nil if target.scope == "facility"

      target.display_order = next_display_order(target)
      OrderSet.transaction do
        target.save!
        @record.entries.each do |entry|
          target.entries.create!(entry.attributes.slice("display_order", "order_type", "label", "values", "schema_version"))
        end
      end
      render json: detail(target), status: :created
    rescue ActiveRecord::RecordInvalid => e
      render_validation_errors(e.record)
    end

    # 子が残ったまま消すと辿れない孤児ができるため拒否する(外部キーを張らない方針)。
    def destroy
      if OrderSet.exists?(parent_id: @record.id)
        render json: { errors: ["中にフォルダまたはセットが残っているため削除できません"] },
               status: :unprocessable_content
      else
        @record.destroy!
        head :no_content
      end
    end

    private

    def model_class = OrderSet

    def record_params
      params.permit(:kind, :parent_id, :scope, :owner_id, :owner_name, :name, :display_order, :active)
    end

    # 医師スコープの持ち主はログイン中の本人に固定する(他人の owner_id を送られても
    # 無視する)。認証なしモード(ADMIN_TOKEN 未設定)は開発の摩擦を無くす後方互換なので
    # パラメータの owner_id を通す。administrator は医療従事者と紐付かないので nil に
    # なり、呼び出し側で 403 にする。
    def forced_owner_id(scope)
      return nil unless scope == "practitioner"
      return params[:owner_id].presence if @user_auth == :none

      current_user&.practitioner_fhir_id
    end

    def authorize_practitioner_scope!
      return unless @record.scope == "practitioner"
      return if @user_auth == :none

      render_forbidden unless current_user && @record.owner_id == current_user.practitioner_fhir_id
    end

    def render_forbidden
      render json: { error: "forbidden" }, status: :forbidden
    end

    def next_display_order(record)
      (OrderSet.where(scope: record.scope, owner_id: record.owner_id, parent_id: record.parent_id)
               .maximum(:display_order) || 0) + 1
    end

    def replace_entries(record, raw)
      record.entries.destroy_all
      Array(raw).each_with_index do |entry, index|
        entry = entry.to_unsafe_h if entry.respond_to?(:to_unsafe_h)
        record.entries.create!(
          display_order: index + 1,
          order_type: entry["order_type"],
          label: entry["label"],
          values: entry["values"],
          schema_version: entry["schema_version"] || 1,
        )
      end
    end

    def summary(set, counts)
      set.as_json(only: %i[id code kind parent_id scope owner_id owner_name name display_order active updated_at])
         .merge("entry_count" => set.kind == "set" ? counts[set.id].to_i : nil)
    end

    def detail(set)
      summary(set, { set.id => set.entries.size }).merge(
        "entries" => set.entries.map do |e|
          e.as_json(only: %i[id display_order order_type label values schema_version])
        end,
      )
    end
  end
end
