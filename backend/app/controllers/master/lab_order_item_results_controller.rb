module Master
  # オーダー項目 → 結果項目の対応(1:N)。オーダー項目の詳細画面から編集する。
  class LabOrderItemResultsController < BaseController
    before_action :set_record, only: %i[update destroy]

    def index
      scope = Master::LabOrderItemResult.includes(:result_item)
      # どちらもカンマ区切りで複数指定可(結果登録画面がオーダーの検査項目を
      # まとめて展開するため)。
      if params[:order_item_code].present?
        scope = scope.where(order_item_code: params[:order_item_code].split(","))
      end
      if params[:result_item_code].present?
        scope = scope.where(result_item_code: params[:result_item_code].split(","))
      end

      # expand_panels=true は、対応が無いオーダー項目をパネル構成でたどって結果項目まで解決する。
      # セットの中のパネル(生化学セットの中の「ナトリウム及びクロール」など)はオーダーの明細に
      # 展開されないため、結果登録画面はこれを使って結果の行に展開する。
      if params[:expand_panels] == "true" && params[:order_item_code].present?
        render json: expanded_result(params[:order_item_code].split(","))
        return
      end

      result = paginate(scope.order(Arel.sql("display_order NULLS LAST")), max_per: 500)
      # 結果項目(材料名付き)を入れ子で添える(展開が 1 リクエストで済むように)。
      render json: result.merge(items: Master::LabOrderItemResult.as_json_with_result_items(result[:items].to_a))
    end

    def create
      record = Master::LabOrderItemResult.new(record_params)
      # 追加順に並べる(明示されていれば従う)。
      record.display_order ||= next_display_order(record.order_item_code)
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    private

    # パネルをたどれる深さの上限。マスタの入れ子は「セット → セット → パネル」程度だが、
    # 相互参照が登録されても止まるように上限を置く(同じ経路の再訪も visited で防ぐ)。
    MAX_PANEL_DEPTH = 10

    # 要求されたオーダー項目ごとに、解決した対応表の行を並べて返す。並びは
    # 「要求の順 → パネル構成の表示順 → 対応表の表示順」で、行には要求元のコードを添える
    # (画面がオーダーの項目順に結果の行を並べ、対応が無い項目を名前で挙げるため)。
    def expanded_result(requested)
      members = panel_members_for(requested)
      mappings = mappings_for(members.keys + members.values.flatten + requested)

      rows = requested.flat_map do |code|
        resolve_mappings(code, members, mappings, Set.new, 0).map do |mapping|
          [mapping, code]
        end
      end

      json = Master::LabOrderItemResult.as_json_with_result_items(rows.map(&:first))
      json.each_with_index { |row, index| row["requested_order_item_code"] = rows[index].last }
      { total: json.size, page: 1, per: json.size, items: json }
    end

    # パネル構成(パネル → 構成項目)を、たどれなくなるまで階層ぶん引く。
    def panel_members_for(codes)
      members = {}
      pending = codes.uniq
      MAX_PANEL_DEPTH.times do
        break if pending.empty?

        found = Master::LabPanelItem.where(panel_item_code: pending)
                                    .order(Arel.sql("display_order NULLS LAST"), :id)
                                    .group_by(&:panel_item_code)
        break if found.empty?

        found.each { |panel, list| members[panel] ||= list.map(&:member_item_code) }
        pending = found.values.flatten.map(&:member_item_code).uniq - members.keys
      end
      members
    end

    def mappings_for(codes)
      Master::LabOrderItemResult.where(order_item_code: codes.uniq)
                                .includes(:result_item)
                                .order(Arel.sql("display_order NULLS LAST"), :id)
                                .group_by(&:order_item_code)
    end

    # 対応表があればそれを使い、無ければパネル構成の順に構成項目をたどる。
    def resolve_mappings(code, members, mappings, visited, depth)
      return [] if depth > MAX_PANEL_DEPTH || visited.include?(code)

      visited = visited + [code]
      return mappings[code] if mappings[code].present?

      (members[code] || []).flat_map { |member| resolve_mappings(member, members, mappings, visited, depth + 1) }
    end

    def next_display_order(order_item_code)
      (Master::LabOrderItemResult.where(order_item_code: order_item_code).maximum(:display_order) || 0) + 1
    end
  end
end
