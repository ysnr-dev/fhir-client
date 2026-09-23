require "rails_helper"

RSpec.describe "Master::CommentRelations", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "POST /master/comment_relations/import" do
    it "imports the コメント関連テーブル file" do
      file = fixture_file_upload("comment_relations_sample.csv", "text/csv")

      post "/master/comment_relations/import", params: { file: file }

      expect(response).to have_http_status(:ok)
      expect(body["imported"]).to eq(3)
      relation = Master::CommentRelation.find_by(procedure_code: "180755710", comment_code: "830100217")
      expect(relation.condition_category).to eq("01")
      expect(relation.comment_text).to eq("疾患名（運動器リハビリテーション料）；")
    end
  end

  describe "GET /master/comment_relations" do
    before do
      Master::CommentRelation.create!(procedure_code: "180755710", comment_code: "830100217", comment_text: "疾患名",
                                      condition_category: "01", abolished_on: "99999999", publication_order: "2")
      Master::CommentRelation.create!(procedure_code: "180755810", comment_code: "850100224", comment_text: "発症年月日",
                                      condition_category: "01", abolished_on: "99999999", publication_order: "1")
      # 非算定理由のコメントと、廃止された行は候補に出さない。
      Master::CommentRelation.create!(procedure_code: "180755710", comment_code: "830100999", comment_text: "算定しない理由",
                                      non_billing_reason: "1", abolished_on: "99999999")
      Master::CommentRelation.create!(procedure_code: "180755710", comment_code: "830100998", comment_text: "廃止",
                                      abolished_on: "20240531")
    end

    it "lists the sendable candidates for the given 診療行為コード (comma separated)" do
      get "/master/comment_relations", params: { procedure_code: "180755710,180755810" }

      expect(body["items"].map { |i| i["comment_code"] }).to eq(%w[830100217 850100224])
    end
  end
end
