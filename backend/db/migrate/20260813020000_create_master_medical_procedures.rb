class CreateMasterMedicalProcedures < ActiveRecord::Migration[8.0]
  # 医科診療行為マスタ。レセプト電算処理システムの医科診療行為マスター
  # (s_ALL*.csv、マスター種別 S、150列)をそのまま取り込む。放射線検査の実施入力で
  # 手技料(診療行為)を確定するために使う。
  #
  # 列は医薬品マスタ・特定器材マスタと同じくレコード仕様の項番順に並べ、未使用の
  # 予備項目も落とさず持つ。改定で予備が使われ始めても取込側を直さずに済むため。
  # 繰り返し項目(施設基準①〜⑩、年齢加算①〜④)は連番を付けて平坦に展開する。
  def change
    create_table :master_medical_procedures do |t|
      t.string :change_category                       # 1 変更区分
      t.string :master_type                           # 2 マスター種別(S固定)
      t.string :procedure_code, null: false           # 3 診療行為コード(9桁)
      t.integer :name_kanji_length                    # 4 診療行為省略名称 省略漢字有効桁数
      t.string :name                                  # 5 同 省略漢字名称
      t.integer :name_kana_length                     # 6 同 省略カナ有効桁数
      t.string :name_kana                             # 7 同 省略カナ名称
      t.string :data_standard_code                    # 8 データ規格コード
      t.integer :data_standard_name_length            # 9 データ規格名 漢字有効桁数
      t.string :data_standard_name                    # 10 同 漢字名称
      t.string :point_type                            # 11 新又は現点数 点数識別
      t.decimal :points, precision: 10, scale: 2      # 12 同 新又は現点数
      t.string :inpatient_outpatient_category         # 13 入外適用区分
      t.string :elderly_category                      # 14 後期高齢者医療適用区分
      t.string :point_column_outpatient               # 15 点数欄集計先識別(入院外)
      t.string :bundled_test                          # 16 包括対象検査
      t.string :reserve1                              # 17 予備(未使用)
      t.string :dpc_category                          # 18 DPC適用区分
      t.string :hospital_clinic_category              # 19 病院・診療所区分
      t.string :image_surgery_support_category        # 20 画像等手術支援加算区分
      t.string :medical_observation_act_category      # 21 医療観察法対象区分
      t.string :nursing_addition                      # 22 看護加算
      t.string :anesthesia_category                   # 23 麻酔識別区分
      t.string :reserve2                              # 24 予備(未使用)
      t.string :disease_relation_category             # 25 傷病名関連区分
      t.string :reserve3                              # 26 予備(未使用)
      t.string :actual_days                           # 27 実日数
      t.string :days_or_times                         # 28 日数・回数
      t.string :medicine_relation_category            # 29 医薬品関連区分
      t.string :increment_calc_type                   # 30 きざみ値 きざみ値計算識別
      t.string :increment_lower_limit                 # 31 同 下限値
      t.string :increment_upper_limit                 # 32 同 上限値
      t.string :increment_value                       # 33 同 きざみ値
      t.decimal :increment_points, precision: 10, scale: 2 # 34 同 きざみ点数
      t.string :increment_error_handling              # 35 同 上下限エラー処理
      t.string :max_times                             # 36 上限回数 上限回数
      t.string :max_times_error_handling              # 37 同 上限回数エラー処理
      t.string :note_addition_code                    # 38 注加算 注加算コード
      t.string :note_addition_serial                  # 39 同 注加算通番
      t.string :general_rule_age                      # 40 同 通則年齢
      t.string :lower_age_limit                       # 41 上下限年齢 下限年齢
      t.string :upper_age_limit                       # 42 同 上限年齢
      t.string :time_addition_category                # 43 時間加算区分
      t.string :standard_conformity_category          # 44 基準適合識別 適合区分
      t.string :target_facility_standard              # 45 同 対象施設基準
      t.string :treatment_infant_addition_category    # 46 処置乳幼児加算区分
      t.string :very_low_birth_weight_addition_category # 47 極低出生体重児加算区分
      t.string :admission_fee_reduction_target        # 48 入院基本料等減算対象識別
      t.string :donor_aggregation_category            # 49 ドナー分集計区分
      t.string :test_judgment_category                # 50 検査等実施判断区分
      t.string :test_judgment_group_category          # 51 検査等実施判断グループ区分
      t.string :degression_target_category            # 52 逓減対象区分
      t.string :spinal_evoked_potential_addition_category # 53 脊髄誘発電位測定等加算区分
      t.string :neck_dissection_addition_category     # 54 頸部郭清術併施加算等区分
      t.string :auto_suture_addition_category         # 55 自動縫合器加算区分
      t.string :outpatient_management_addition_category # 56 外来管理加算区分
      t.string :reserve4                              # 57 予備(未使用)
      t.string :reserve5                              # 58 予備(未使用)
      t.string :name_change_flag                      # 59 漢字名称変更区分
      t.string :kana_change_flag                      # 60 カナ名称変更区分
      t.string :lab_test_comment                      # 61 検体検査コメント
      t.string :general_rule_addition_target_category # 62 通則加算所定点数対象区分
      t.string :bundled_degression_category           # 63 包括逓減区分
      t.string :endoscopic_ultrasound_addition_category # 64 超音波内視鏡加算区分
      t.string :reserve6                              # 65 予備(未使用)
      t.string :point_column_inpatient                # 66 点数欄集計先識別(入院)
      t.string :auto_anastomosis_addition_category    # 67 自動吻合器加算区分
      t.string :notification_category_1               # 68 告示等識別区分(1)
      t.string :notification_category_2               # 69 告示等識別区分(2)
      t.string :regional_addition                     # 70 地域加算
      t.string :bed_count_category                    # 71 病床数区分
      # 72〜81 施設基準①〜⑩(繰り返し10)
      (1..10).each { |i| t.string :"facility_standard_code_#{i}" }
      t.string :ultrasonic_coagulation_addition_category # 82 超音波凝固切開装置等加算区分
      t.string :short_stay_surgery                    # 83 短期滞在手術
      t.string :dental_category                       # 84 歯科適用区分
      t.string :code_table_number_alpha               # 85 コード表用番号(アルファベット部)
      t.string :notification_number_alpha             # 86 告示・通知関連番号(アルファベット部)
      t.string :changed_on                            # 87 変更年月日
      t.string :abolished_on                          # 88 廃止年月日
      t.string :publication_order                     # 89 公表順序番号
      t.string :code_table_chapter                    # 90 コード表用番号 章
      t.string :code_table_part                       # 91 同 部
      t.string :code_table_section                    # 92 同 区分番号
      t.string :code_table_branch                     # 93 同 枝番
      t.string :code_table_item                       # 94 同 項番
      t.string :notification_chapter                  # 95 告示・通知関連番号 章
      t.string :notification_part                     # 96 同 部
      t.string :notification_section                  # 97 同 区分番号
      t.string :notification_branch                   # 98 同 枝番
      t.string :notification_item                     # 99 同 項番
      # 100〜111 年齢加算①〜④(繰り返し4。下限年齢・上限年齢・注加算診療行為コード)
      (1..4).each do |i|
        t.string :"age_addition_lower_age_#{i}"
        t.string :"age_addition_upper_age_#{i}"
        t.string :"age_addition_procedure_code_#{i}"
      end
      t.string :reserve7                              # 112 予備(未使用)
      t.string :basic_name                            # 113 基本漢字名称
      t.string :sinus_endoscope_addition              # 114 副鼻腔手術用内視鏡加算
      t.string :sinus_bone_tissue_resection_addition  # 115 副鼻腔手術用骨軟部組織切除機器加算
      t.string :long_anesthesia_management_addition   # 116 長時間麻酔管理加算
      t.string :point_table_section_number            # 117 点数表区分番号
      t.string :monitoring_addition                   # 118 モニタリング加算
      t.string :cryopreserved_tissue_addition         # 119 凍結保存同種組織加算
      t.string :malignant_tumor_pathology_addition    # 120 悪性腫瘍病理組織標本加算
      t.string :external_fixator_addition             # 121 創外固定器加算
      t.string :ultrasonic_cutting_addition           # 122 超音波切削機器加算
      t.string :laa_closure_addition                  # 123 左心耳閉鎖術併施加算
      t.string :outpatient_infection_control_addition # 124 外来感染対策向上加算等
      t.string :ent_infant_treatment_addition         # 125 耳鼻咽喉科乳幼児処置加算
      t.string :ent_pediatric_antimicrobial_addition  # 126 耳鼻咽喉科小児抗菌薬適正使用支援加算
      t.string :npwt_device_addition                  # 127 切開創局所陰圧閉鎖処置機器加算
      t.string :nursing_staff_treatment_improvement   # 128 看護職員処遇改善評価料等
      t.string :outpatient_home_base_up_1             # 129 外来・在宅ベースアップ評価料(1)
      t.string :outpatient_home_base_up_2             # 130 同 (2)
      t.string :remanufactured_single_use_device_addition # 131 再製造単回使用医療機器使用加算
      t.string :price_response_category               # 132 物価対応料区分
      t.string :price_response_group_category         # 133 物価対応料グループ区分
      t.string :organ_transplant_system_addition      # 134 臓器移植実施体制確保加算
      t.string :endoscopic_surgery_support_device_addition # 135 内視鏡手術用支援機器加算
      t.string :remote_e_prescription_addition        # 136 遠隔電子処方箋活用加算等
      t.string :surgical_care_special_addition        # 137 外科医療確保特別加算
      # 138〜150 予備(未使用)
      (8..20).each { |i| t.string :"reserve#{i}" }

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_medical_procedures, :procedure_code, unique: true
    add_index :master_medical_procedures, :name
    # 実施入力の手技検索は「有効なものだけ」を出すため廃止年月日で絞る。
    add_index :master_medical_procedures, :abolished_on
    # 区分番号(J・E など点数表の章)からの絞り込み。放射線は画像診断(E)。
    add_index :master_medical_procedures, :code_table_number_alpha
  end
end
