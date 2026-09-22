module Integrations
  module ReceiptComputer
    # 診療行為コード → 点数表の区分番号(章記号 + 区分 3 桁。例 "K920" "D007")。
    #
    # 医科診療行為マスタ(Master::MedicalProcedure)の写しから引く。連携先はこれで
    # 剤の区分(日レセなら診療種別区分)を決める。マスタに無いコードは nil で、
    # そのときは種別の既定の区分に落ちる。
    module ProcedureSections
      module_function

      def lookup(codes)
        codes = codes.compact.uniq
        return {} if codes.empty?

        Master::MedicalProcedure.where(procedure_code: codes)
                                .pluck(:procedure_code, :code_table_number_alpha, :code_table_section)
                                .each_with_object({}) do |(code, chapter, section), acc|
          next if chapter.blank? || !chapter.match?(/\A[A-N]\z/)

          acc[code] = "#{chapter}#{section.to_s.rjust(3, '0')}"
        end
      end
    end
  end
end
