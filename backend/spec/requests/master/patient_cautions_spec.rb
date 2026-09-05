require "rails_helper"

RSpec.describe "Master::PatientCautions", type: :request do
  def body
    JSON.parse(response.body)
  end

  it "掲載順で返す" do
    Master::PatientCaution.create!(code: "dnar", name: "DNAR", category: "advance-directive",
                                   pictogram: "dnar", display_order: 110)
    Master::PatientCaution.create!(code: "fall", name: "転倒リスク", category: "safety",
                                   pictogram: "fall", display_order: 10)

    get "/master/patient_cautions"

    expect(body["items"].map { |i| i["code"] }).to eq(%w[fall dnar])
  end

  it "作成・更新・削除できる(コードは変更不可)" do
    post "/master/patient_cautions",
         params: { code: "suicide", name: "自殺念慮", category: "safety",
                   pictogram: "alert", display_order: 25 }, as: :json
    expect(response).to have_http_status(:created)
    id = body["id"]

    patch "/master/patient_cautions/#{id}",
          params: { code: "changed", name: "自殺企図・念慮" }, as: :json
    expect(Master::PatientCaution.find(id))
      .to have_attributes(code: "suicide", name: "自殺企図・念慮")

    delete "/master/patient_cautions/#{id}"
    expect(response).to have_http_status(:no_content)
  end

  it "区分とピクトグラムは決まった値だけを受け付ける" do
    post "/master/patient_cautions",
         params: { code: "x1", name: "不正区分", category: "bogus" }, as: :json
    expect(response).to have_http_status(:unprocessable_content)

    post "/master/patient_cautions",
         params: { code: "x2", name: "不正ピクトグラム", category: "safety", pictogram: "bogus" }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
  end

  # 帯に出さない区分は pictogram を空で登録する。空文字ではなく NULL に寄せる。
  it "ピクトグラム未指定は NULL で保存する" do
    post "/master/patient_cautions",
         params: { code: "note", name: "帯に出さない注意", category: "administrative", pictogram: "" }, as: :json

    expect(response).to have_http_status(:created)
    expect(Master::PatientCaution.find(body["id"]).pictogram).to be_nil
  end
end
