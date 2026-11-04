module Ssmix2
  # ORC-2 と ファイル名のオーダ No。SS-MIX2 は 15 桁の前ゼロの番号を求め、同じオーダーの修正・取消は
  # 同じ番号でなければ履歴(コンディションフラグ)がつながらない。オーダーヘッダーは数値の番号を持たないので、
  # FHIR の参照("ServiceRequest/abc")に backend で連番を割り当てる対応表を持つ。
  module OrderNumber
    WIDTH = 15
    # 患者基本・病名・アレルギーなど、オーダ No で管理しない情報の値(ガイドライン表 3.1-3)。
    NONE = "ALL9".freeze

    module_function

    def for(reference)
      row = Ssmix2OrderNumber.find_by(resource_ref: reference) || create(reference)
      format("%0#{WIDTH}d", row.id)
    end

    def create(reference)
      Ssmix2OrderNumber.create!(resource_ref: reference)
    rescue ActiveRecord::RecordNotUnique
      Ssmix2OrderNumber.find_by!(resource_ref: reference)
    end
  end
end
