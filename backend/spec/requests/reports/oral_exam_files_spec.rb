require "rails_helper"

RSpec.describe "Reports::OralExamFiles", type: :request do
  let(:filename) { "000002-20261017120000-20261017999999.oes" }
  let(:records) do
    [
      ["VR", "JDAOES000102", "", "", "", "", ""],
      ["PN", "", "", "", "", "", "2", "", "", "", "", "20261017", "テスト 太郎", "", "01"],
      ["TB", "1016", "0", "0", "", "", "", "", "", ""],
      ["TE", "", "", "", "01", "金銀パラジウム〜𠮷", "", "20261017", "", "", "", "", ""],
      ["DT", "20261017", "120000", "20261017", "999999", "", "", "", "", ""]
    ]
  end

  it "Shift_JIS・CRLF・末尾 EOF のファイルを返す" do
    post "/reports/oral_exam_file", params: { filename: filename, records: records }, as: :json

    expect(response).to have_http_status(:ok)
    expect(response.headers["Content-Disposition"]).to include(filename)
    body = response.body.b
    expect(body.end_with?("\r\n\x1A".b)).to be(true)

    text = body.delete_suffix("\x1A".b).force_encoding("Windows-31J").encode("UTF-8")
    lines = text.split("\r\n")
    expect(lines.first).to eq("VR,JDAOES000102,,,,,")
    expect(lines.size).to eq(5)
    # 「〜」は Windows-31J の「～」に寄せ、JIS 規定外の字は全角の「？」に置き換える。
    expect(lines[3]).to eq("TE,,,,01,金銀パラジウム～？,,20261017,,,,,")
  end

  it "ファイル名とレコードの形を確かめる" do
    post "/reports/oral_exam_file", params: { filename: "../x.oes", records: records }, as: :json
    expect(response).to have_http_status(:unprocessable_content)

    post "/reports/oral_exam_file",
         params: { filename: filename, records: [["VR", "a,b"], ["DT", "1"]] }, as: :json
    expect(response).to have_http_status(:unprocessable_content)

    post "/reports/oral_exam_file", params: { filename: filename, records: [["XX", "1"]] }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
  end
end
