require "rails_helper"

RSpec.describe "Master::NursingAssignments", type: :request do
  def body = JSON.parse(response.body)

  def assign(ward_id:, shift:, patient_id:, practitioner_id:, assigned_on: "2026-10-10")
    NursingAssignment.create!(ward_id: ward_id, assigned_on: assigned_on, shift: shift,
                              patient_id: patient_id, practitioner_id: practitioner_id)
  end

  describe "GET /master/nursing_assignments" do
    before do
      assign(ward_id: "w1", shift: "day", patient_id: "p1", practitioner_id: "n1")
      assign(ward_id: "w1", shift: "night", patient_id: "p2", practitioner_id: "n2")
      assign(ward_id: "w2", shift: "day", patient_id: "p3", practitioner_id: "n1")
      assign(ward_id: "w1", shift: "day", patient_id: "p2", practitioner_id: "n1", assigned_on: "2026-10-11")
    end

    it "病棟 × 日の全勤務帯を返す" do
      get "/master/nursing_assignments", params: { ward_id: "w1", assigned_on: "2026-10-10" }
      expect(response).to have_http_status(:ok)
      expect(body["items"].map { |i| [i["shift"], i["patient_id"]] }).to contain_exactly(%w[day p1], %w[night p2])
    end

    it "看護師 × 日の受け持ちを病棟をまたいで返す" do
      get "/master/nursing_assignments", params: { practitioner_id: "n1", assigned_on: "2026-10-10" }
      expect(body["items"].map { |i| i["patient_id"] }).to contain_exactly("p1", "p3")
    end

    it "日付か病棟・看護師が無ければ 422" do
      get "/master/nursing_assignments", params: { ward_id: "w1" }
      expect(response).to have_http_status(:unprocessable_content)
      get "/master/nursing_assignments", params: { assigned_on: "2026-10-10" }
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PUT /master/nursing_assignments/replace" do
    it "指定した勤務帯だけを置き換え、他の勤務帯は残す" do
      assign(ward_id: "w1", shift: "day", patient_id: "p1", practitioner_id: "n1")
      assign(ward_id: "w1", shift: "day", patient_id: "p2", practitioner_id: "n1")
      assign(ward_id: "w1", shift: "night", patient_id: "p1", practitioner_id: "n3")

      put "/master/nursing_assignments/replace", params: {
        ward_id: "w1", assigned_on: "2026-10-10", shifts: ["day"],
        items: [{ shift: "day", patient_id: "p1", practitioner_id: "n2", practitioner_name: "看護 花子" }],
      }, as: :json

      expect(response).to have_http_status(:ok)
      rows = NursingAssignment.where(ward_id: "w1").order(:shift, :patient_id).pluck(:shift, :patient_id, :practitioner_id)
      expect(rows).to eq([%w[day p1 n2], %w[night p1 n3]])
      expect(body["items"].first["practitioner_name"]).to eq("看護 花子")
    end

    it "同じ日・勤務帯で別の病棟にいた患者は、こちらの割り付けで置き換える" do
      assign(ward_id: "w2", shift: "day", patient_id: "p1", practitioner_id: "n9")

      put "/master/nursing_assignments/replace", params: {
        ward_id: "w1", assigned_on: "2026-10-10", shifts: ["day"],
        items: [{ shift: "day", patient_id: "p1", practitioner_id: "n1" }],
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(NursingAssignment.pluck(:ward_id, :patient_id, :practitioner_id)).to eq([%w[w1 p1 n1]])
    end

    it "同じ勤務帯に同じ患者が 2 回あれば 422 で何も変えない" do
      assign(ward_id: "w1", shift: "day", patient_id: "p1", practitioner_id: "n1")

      put "/master/nursing_assignments/replace", params: {
        ward_id: "w1", assigned_on: "2026-10-10", shifts: ["day"],
        items: [
          { shift: "day", patient_id: "p2", practitioner_id: "n1" },
          { shift: "day", patient_id: "p2", practitioner_id: "n2" },
        ],
      }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(NursingAssignment.pluck(:patient_id, :practitioner_id)).to eq([%w[p1 n1]])
    end

    it "勤務帯が不正、または shifts に無い勤務帯の割り付けは 422" do
      put "/master/nursing_assignments/replace", params: {
        ward_id: "w1", assigned_on: "2026-10-10", shifts: ["noon"], items: [],
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)

      put "/master/nursing_assignments/replace", params: {
        ward_id: "w1", assigned_on: "2026-10-10", shifts: ["day"],
        items: [{ shift: "night", patient_id: "p1", practitioner_id: "n1" }],
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
