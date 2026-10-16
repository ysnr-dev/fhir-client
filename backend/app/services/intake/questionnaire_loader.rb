module Intake
  # 質問票(Questionnaire)を canonical で読む。患者が開いたときに引く(発行時には写さない。テンプレートの版が
  # 上がったら新しい版で答えてもらう)。
  module QuestionnaireLoader
    module_function

    def load(store, canonical)
      url, version = canonical.to_s.split("|", 2)
      return nil if url.blank?

      params = { "url" => url, "status" => "active", "_count" => "20" }
      params["version"] = version if version.present?
      candidates = store.search("Questionnaire", params, limit: 20)
                        .select { |r| r["resourceType"] == "Questionnaire" && r["url"] == url }
                        .select { |r| version.blank? || r["version"] == version }
      # 版の指定が無ければ一番新しい版(version の文字列比較で代える)。
      candidates.max_by { |r| [r["version"].to_s, r["id"].to_s] }
    end
  end
end
