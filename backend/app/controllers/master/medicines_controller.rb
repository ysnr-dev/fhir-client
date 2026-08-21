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
      scope = scope.where(medicine_code: params[:medicine_code]) if params[:medicine_code].present?
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

    private

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
          "NULL AS abolished_on",
          "LEFT(master_medicines.generic_name_code, 4) AS yakko_code",
          "master_medicine_types.name AS yakko_name",
          "NULL AS yj_code",
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
