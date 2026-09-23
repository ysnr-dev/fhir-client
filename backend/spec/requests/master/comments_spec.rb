require "rails_helper"

RSpec.describe "Master::Comments", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "POST /master/comments/import" do
    it "imports the コメントマスター file" do
      file = fixture_file_upload("comments_sample.csv", "text/csv")

      post "/master/comments/import", params: { file: file }

      expect(response).to have_http_status(:ok)
      expect(body["imported"]).to eq(3)
      comment = Master::Comment.find_by(comment_code: "850100224")
      expect(comment.pattern).to eq("50")
      expect(comment.name).to eq("発症年月日（運動器リハビリテーション料）")
      expect(comment.abolished_on).to eq("99999999")
    end
  end

  describe "GET /master/comments" do
    before do
      Master::Comment.create!(comment_code: "830100217", name: "疾患名（運動器リハビリテーション料）；", pattern: "30",
                              abolished_on: "99999999", publication_order: "11555000")
      Master::Comment.create!(comment_code: "820181000", name: "撮影部位（単純撮影）：頭部", pattern: "20",
                              abolished_on: "20240531", publication_order: "10000000")
    end

    it "filters by pattern and by active" do
      get "/master/comments", params: { pattern: "30" }
      expect(body["items"].map { |i| i["comment_code"] }).to eq(%w[830100217])

      get "/master/comments", params: { active: "true" }
      expect(body["items"].map { |i| i["comment_code"] }).to eq(%w[830100217])
    end
  end
end
