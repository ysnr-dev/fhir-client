module Master
  # LIKE 検索の値に含まれるワイルドカードのエスケープ。マスタ検索のコントローラと
  # 取込側の項目引き当てで同じ規則を使う。
  module LikeEscaping
    private

    def sanitize_like(value)
      value.gsub(/[%_\\]/) { |char| "\\#{char}" }
    end
  end
end
