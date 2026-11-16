module Master
  class MedicinesController < BaseController
    include Importable
    before_action :set_record, only: %i[show update destroy]

    def index
      # 一般名検索(処方オーダーの一般名処方用)。銘柄ではなく、一般名処方マスタ由来の
      # 一般名(【般】付き)を1件ずつ返す。レスポンス形は銘柄検索と同じ。
      if params[:generic] == "true"
        scope = generic_medicines
        if params[:name].present?
          scope = flexible_name_match(scope, params[:name], %w[master_medicines.search_generic])
        end
        scope = scope.where("LEFT(master_medicines.generic_name_code, 4) = ?", params[:yakko_code]) if params[:yakko_code].present?
        scope = filter_by_yakko_name(scope, params[:yakko_name], code_column: "generic_name_code") if params[:yakko_name].present?
        return render json: paginate(scope)
      end

      scope = medicines_with_type
      # カンマ区切りで複数指定できる(保存済みのオーダーの薬をまとめて引き直すとき)。
      scope = scope.where(medicine_code: params[:medicine_code].split(",")) if params[:medicine_code].present?
      scope = scope.where(yakka_code: params[:yakka_code]) if params[:yakka_code].present?
      # 剤形区分(1:内用薬、4:注射薬、6:外用薬、8:歯科用薬剤)。注射オーダーの医薬品検索で使う。
      scope = scope.where(dosage_form: params[:dosage_form]) if params[:dosage_form].present?
      # 造影剤区分(0:該当しない、1:造影剤、2:造影の補助剤=発泡顆粒・腸管洗浄剤)。
      # 放射線検査の造影剤選択で使う。剤形では絞れない(経口造影剤は内用薬のため)。
      scope = scope.where.not(contrast_medium_category: [nil, "", "0"]) if params[:contrast_medium] == "true"
      # JOIN 後は master_medicine_types にも search_name があるためテーブル修飾で曖昧さを回避する。
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name],
                                    %w[master_medicines.search_name master_medicines.search_kana master_medicines.search_generic])
      end
      # 薬効分類は YJコード(yakka_code)の上4桁。code 完全一致 / 名称検索の2通りで絞り込む。
      scope = scope.where("LEFT(master_medicines.yakka_code, 4) = ?", params[:yakko_code]) if params[:yakko_code].present?
      scope = filter_by_yakko_name(scope, params[:yakko_name]) if params[:yakko_name].present?

      render json: paginate(scope)
    end

    # 薬の群に当たる医薬品コードを全件返す(データ抽出の「薬効分類・ATC 分類・成分で指定」を実行時に展開する。
    # docs/data-extract-design.md)。廃止された薬も過去のオーダーにあるので含める。どの指定もカンマ区切りで
    # 複数指定でき、和をとる。
    #   yakko_prefix   薬効分類(YJ コードの先頭 2〜4 桁)
    #   atc_prefix     ATC 分類(2〜4 階層目。成分マスタで引く)
    #   ingredient_id  成分の ID(成分マスタで引く。配合剤も当たる)
    def codes
      scopes = [yakko_scope, ingredient_scope].compact
      return render json: { codes: [] } if scopes.empty?

      codes = scopes.reduce { |merged, scope| merged.or(scope) }.order(:medicine_code).pluck(:medicine_code)
      render json: { codes: codes }
    end

    private

    def code_list(name, pattern)
      params[name].to_s.split(",").map(&:strip).select { |value| value.match?(pattern) }.uniq
    end

    def yakko_scope
      prefixes = code_list(:yakko_prefix, /\A\d{2,4}\z/)
      return nil if prefixes.empty?

      Master::Medicine.where(prefixes.map { "master_medicines.yakka_code LIKE ?" }.join(" OR "), *prefixes.map { |p| "#{p}%" })
    end

    # 成分マスタは薬価基準コードの上 7 桁で持ち、規格で成分が変わる薬だけ上 9 桁で持つ。
    # 上 9 桁の行がある薬はそちらだけを見る(画面の照合と同じ引き方)。
    INGREDIENT_KEY_SQL = <<~SQL.squish.freeze
      CASE WHEN EXISTS (SELECT 1 FROM master_medicine_ingredients s WHERE s.code_prefix = LEFT(master_medicines.yakka_code, 9))
           THEN LEFT(master_medicines.yakka_code, 9) ELSE LEFT(master_medicines.yakka_code, 7) END
    SQL

    def ingredient_scope
      atc_prefixes = code_list(:atc_prefix, /\A[A-HJ-Z]\d{2}[A-Z]{0,2}\z/)
      ingredient_ids = code_list(:ingredient_id, /\A\d{1,12}\z/)
      return nil if atc_prefixes.empty? && ingredient_ids.empty?

      # atc_codes は空白区切りなので、先頭に空白を足して「空白 + 分類」で前方一致させる。
      rows = atc_prefixes.reduce(Master::MedicineIngredient.where(ingredient_id: ingredient_ids)) do |scope, prefix|
        scope.or(Master::MedicineIngredient.where("(' ' || atc_codes) LIKE ?", "% #{prefix}%"))
      end
      Master::Medicine.where("#{INGREDIENT_KEY_SQL} IN (?)", rows.select(:code_prefix))
    end

    # 院内フォーミュラリの印(docs/formulary-design.md)。検索結果の各行に、
    # 推奨順位(複数の群に載っていれば最小)とその群の名前を添える。
    # 相関サブクエリなので JOIN と違い件数(paginate の COUNT)を増やさない。
    FORMULARY_RANK_SQL = "(SELECT MIN(fe.rank) FROM master_formulary_entries fe " \
                         "WHERE fe.medicine_code = master_medicines.medicine_code)".freeze
    FORMULARY_GROUP_NAME_SQL = "(SELECT g.name FROM master_formulary_entries fe " \
                               "JOIN master_formulary_groups g ON g.id = fe.formulary_group_id " \
                               "WHERE fe.medicine_code = master_medicines.medicine_code " \
                               "ORDER BY fe.rank, fe.id LIMIT 1)".freeze
    # 一般名の行は、同じ一般名処方コードの銘柄が 1 つでも載っていれば推奨とみなす。
    GENERIC_FORMULARY_RANK_SQL = "(SELECT MIN(fe.rank) FROM master_formulary_entries fe " \
                                 "JOIN master_medicines m ON m.medicine_code = fe.medicine_code " \
                                 "WHERE m.generic_name_code = master_medicines.generic_name_code)".freeze
    GENERIC_FORMULARY_GROUP_NAME_SQL = "(SELECT g.name FROM master_formulary_entries fe " \
                                       "JOIN master_medicines m ON m.medicine_code = fe.medicine_code " \
                                       "JOIN master_formulary_groups g ON g.id = fe.formulary_group_id " \
                                       "WHERE m.generic_name_code = master_medicines.generic_name_code " \
                                       "ORDER BY fe.rank, fe.id LIMIT 1)".freeze

    # 薬効分類名称(yakko_name)と薬効分類番号(yakko_code=YJ上4桁)を各医薬品に付与する。
    # master_medicine_types.code は一意なので LEFT JOIN で件数は増えない。
    # yj_code(個別医薬品コード)は医薬品マスタに無いため、HOTコードマスタを
    # レセプト電算コード(medicine_code = receipt_code_1)で引く相関サブクエリで付与する。
    # 1件に複数の包装(HOT行)が対応しうるが個別医薬品コードは同一なので LIMIT 1 でよく、
    # JOIN と違い件数(paginate の COUNT)を増やさない。
    def medicines_with_type
      Master::Medicine
        .joins("LEFT JOIN master_medicine_types ON master_medicine_types.code = LEFT(master_medicines.yakka_code, 4)")
        .select(
          "master_medicines.*",
          "LEFT(master_medicines.yakka_code, 4) AS yakko_code",
          "master_medicine_types.name AS yakko_name",
          "(SELECT hc.individual_medicine_code FROM master_hot_codes hc " \
          "WHERE hc.receipt_code_1 = master_medicines.medicine_code " \
          "AND hc.individual_medicine_code <> '' LIMIT 1) AS yj_code",
          "#{FORMULARY_RANK_SQL} AS formulary_rank",
          "#{FORMULARY_GROUP_NAME_SQL} AS formulary_group_name",
        )
    end

    # 一般名処方(【般】〜)の候補。医薬品マスタの一般名処方コード・一般名記載を、
    # コードごとに 1 件へまとめて返す(同じ一般名に多数の銘柄がぶら下がるため)。
    # 一般名には薬価・YJコード・剤形が一意に定まらない項目があるので、代表行
    # (コードごとの最小 id)の値をそのまま使い、無い項目は NULL で返す。
    # 呼び出し側が銘柄と取り違えないよう generic=true を立てる。
    def generic_medicines
      representative_ids = Master::Medicine
        .where.not(generic_name_code: [nil, ""])
        .where.not(generic_name_description: [nil, ""])
        .group(:generic_name_code)
        .select("MIN(id)")

      Master::Medicine
        .where(id: representative_ids)
        .joins("LEFT JOIN master_medicine_types ON master_medicine_types.code = LEFT(master_medicines.generic_name_code, 4)")
        .select(
          "master_medicines.id",
          "master_medicines.generic_name_code AS medicine_code",
          "master_medicines.generic_name_description AS name",
          "NULL AS name_kana",
          "master_medicines.unit_code",
          "master_medicines.unit_name",
          "master_medicines.dosage_form",
          "NULL AS injection_volume",
          "NULL AS yakka_code",
          "NULL AS price",
          "master_medicines.generic_name_description",
          # 規制区分・製品区分は代表行の値をそのまま返す(同じ一般名の銘柄間で変わらない)。
          "master_medicines.narcotic_category",
          "master_medicines.biological_product_flag",
          "master_medicines.contrast_medium_category",
          "NULL AS abolished_on",
          "LEFT(master_medicines.generic_name_code, 4) AS yakko_code",
          "master_medicine_types.name AS yakko_name",
          "NULL AS yj_code",
          "#{GENERIC_FORMULARY_RANK_SQL} AS formulary_rank",
          "#{GENERIC_FORMULARY_GROUP_NAME_SQL} AS formulary_group_name",
          "TRUE AS generic",
        )
    end

    # 薬効分類名称での絞り込み。名称を表記ゆれ吸収検索で該当コードに解決し、
    # その薬効分類番号(4桁)を持つ医薬品に絞る。一般名検索では薬価コードの代わりに
    # 一般名処方コードの上4桁を見る(どちらも YJ コード体系で上4桁が薬効分類番号)。
    def filter_by_yakko_name(scope, query, code_column: "yakka_code")
      codes = flexible_name_match(Master::MedicineType.all, query, %w[search_name]).pluck(:code)
      return scope.none if codes.empty?

      scope.where("LEFT(master_medicines.#{code_column}, 4) IN (?)", codes)
    end
  end
end
