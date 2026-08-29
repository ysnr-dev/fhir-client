module Master
  # 看護行為マスタ(MEDIS 看護実践用語標準マスター 看護行為編)。
  # 配布ファイルを取込で洗い替える読み取り専用で、画面からの登録・編集は持たない。
  class NursingActsController < BaseController
    include Importable

    def index
      scope = Master::NursingAct.all
      # 既定は有効な用語のみ。削除済みも見たいときは active=false。
      scope = scope.active unless params[:active] == "false"
      # カンマ区切りで複数指定可(オーダーの code から名称を一括で引くため)。
      scope = scope.where(manage_no: params[:manage_no].split(",")) if params[:manage_no].present?
      scope = scope.where(code_16: params[:code_16].split(",")) if params[:code_16].present?
      %i[level1_code level2_code level3_code].each do |column|
        scope = scope.where(column => params[column]) if params[column].present?
      end
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name])
      end
      render json: paginate(scope.order(Arel.sql("sort_key NULLS LAST")).order(:code_16), max_per: 500)
    end

    # 第 3 階層(行為)の一覧。修飾語(第 4 階層)で分かれた行を行為ごとに畳んで返す。
    # 指示の用語選択は「行為を選んでから修飾語を選ぶ」二段なので、モーダルには行為だけを出す。
    # 全体で 650 件程度なので Ruby 側でページングする。
    def actions
      scope = Master::NursingAct.active
      %i[level1_code level2_code].each do |column|
        scope = scope.where(column => params[column]) if params[column].present?
      end
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name])
      end
      # flexible_name_match は search_name で並べ替える ORDER BY を足すが、
      # 行為単位に畳む GROUP BY には載らない列なので外す(並びは sort_key で決める)。
      rows = scope.reorder(nil)
                  .group(:level1_code, :level1_name, :level2_code, :level2_name, :level3_code, :level3_name)
                  .pluck(:level1_code, :level1_name, :level2_code, :level2_name, :level3_code, :level3_name,
                         Arel.sql("MIN(sort_key)"), Arel.sql("COUNT(*)"))
                  .sort_by { |r| [r[6] || 0, r[4]] }
      page, per = pagination_params(max_per: 100)
      window = rows.slice((page - 1) * per, per).to_a
      # 行為を選んだ時点で確定するコード(修飾語なしの D000、無ければ先頭)。
      # これが無いと画面が行為を選ぶたびに修飾語を引き直すことになる。
      defaults = default_rows(window.map { |r| r[4] })
      items = window.map do |r|
        default = defaults[r[4]]
        {
          level1_code: r[0], level1_name: r[1], level2_code: r[2], level2_name: r[3],
          level3_code: r[4], level3_name: r[5], modifier_count: r[7],
          default_code_16: default&.code_16, default_manage_no: default&.manage_no,
          default_modifier_name: default&.level4_name
        }
      end
      render json: { total: rows.size, page: page, per: per, items: items }
    end

    # 行為ごとの既定行。修飾語なし(D000)を優先し、無ければソート順の先頭。
    def default_rows(level3_codes)
      return {} if level3_codes.empty?

      Master::NursingAct.active
                        .where(level3_code: level3_codes)
                        .order(Arel.sql("(level4_code = 'D000') DESC"))
                        .order(Arel.sql("sort_key NULLS LAST"))
                        .group_by(&:level3_code)
                        .transform_values(&:first)
    end

    # 第 1 階層 → 第 2 階層の一覧。検索画面の絞り込みと、指示簿の見出し名の解決に使う。
    def levels
      rows = Master::NursingAct.active
                               .group(:level1_code, :level1_name, :level2_code, :level2_name)
                               .minimum(:sort_key)
      grouped = rows.sort_by { |_, sort| sort || 0 }.group_by { |(l1_code, l1_name, _, _), _| [l1_code, l1_name] }
      levels = grouped.map do |(code, name), entries|
        {
          code: code,
          name: name,
          children: entries.map { |(_, _, l2_code, l2_name), _| { code: l2_code, name: l2_name } }
        }
      end
      render json: { levels: levels }
    end
  end
end
