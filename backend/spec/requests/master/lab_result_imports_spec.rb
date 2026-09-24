require "rails_helper"

RSpec.describe "Master::LabResultImports", type: :request do
  def body = JSON.parse(response.body)

  def upload(name = "oru_r01_utf8.hl7", params = {})
    file = Rack::Test::UploadedFile.new(Rails.root.join("spec/fixtures/lab_import/#{name}"),
                                        "application/octet-stream")
    post "/master/lab_result_imports", params: { file: file }.merge(params)
  end

  before do
    Master::LabResultItem.create!(result_item_code: "L-AST", name: "AST", data_type: "PQ",
                                  jlac10_code: "3B035000002327299")
  end

  describe "POST /master/lab_result_imports" do
    it "ファイルを取り込んでバッチと件数を返す" do
      upload

      expect(response).to have_http_status(:created)
      expect(body["import"]["message_type"]).to eq("ORU^R01")
      expect(body["import"]["encoding"]).to eq("UTF-8")
      expect(body["import"]["status_counts"]).to eq("pending" => 2, "ready" => 1)
      expect(body["duplicate_ids"]).to eq([])
    end

    it "文字コードを指定して取り込める" do
      upload("oru_r01_cp932.hl7", encoding: "shift_jis")

      expect(body["import"]["encoding"]).to eq("CP932")
      expect(body["import"]["encoding_reason"]).to eq("manual")
    end

    it "同じメッセージ ID の既存バッチを応答に添える" do
      upload
      first_id = body["import"]["id"]
      upload

      expect(body["duplicate_ids"]).to eq([first_id])
    end

    it "ファイルが無ければ 422" do
      post "/master/lab_result_imports"
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "解析できないファイルは 422 で理由を返す" do
      file = Rack::Test::UploadedFile.new(StringIO.new("not hl7"), original_filename: "a.txt")
      post "/master/lab_result_imports", params: { file: file }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["error"]).to include("MSH")
    end
  end

  describe "GET /master/lab_result_imports" do
    it "新しい順にバッチと状態別件数を返す" do
      upload
      upload("oul_r22_iso2022jp.hl7")

      get "/master/lab_result_imports"

      expect(response).to have_http_status(:ok)
      expect(body["items"].first["message_type"]).to eq("OUL^R22")
      expect(body["items"].first["status_counts"]).to be_present
    end
  end

  describe "GET /master/lab_result_imports/:id" do
    it "バッチと全行を群・行順で返す" do
      upload
      id = body["import"]["id"]

      get "/master/lab_result_imports/#{id}"

      expect(body["rows"].map { |row| row["sequence"] }).to eq([1, 2, 3])
      expect(body["rows"].first["patient_number"]).to eq("PID001")
    end
  end

  describe "PATCH /master/lab_result_import_rows/:id" do
    let(:pending_row) do
      upload
      LabResultImportRow.find_by(external_name: "未登録項目")
    end

    before do
      Master::LabResultItem.create!(result_item_code: "L-COMMENT", name: "コメント", data_type: "ST")
    end

    it "結果項目を選ぶと登録待ちになる" do
      patch "/master/lab_result_import_rows/#{pending_row.id}",
            params: { result_item_code: "L-COMMENT" }

      expect(response).to have_http_status(:ok)
      row = pending_row.reload
      expect(row.result_item_code).to eq("L-COMMENT")
      expect(row.resolution).to eq("manual")
      expect(row.status).to eq("ready")
    end

    it "結果項目マスタの空の JLAC を育てる(取込元コード対応表の代わり)" do
      patch "/master/lab_result_import_rows/#{pending_row.id}",
            params: { result_item_code: "L-COMMENT", write_to_master: true }

      item = Master::LabResultItem.find_by(result_item_code: "L-COMMENT")
      expect(item.jlac10_code).to eq("9Z999999999999999")
    end

    it "マスタの JLAC が既に別の値なら上書きせず知らせる" do
      Master::LabResultItem.find_by(result_item_code: "L-COMMENT")
                           .update!(jlac10_code: "1A000000000000001")

      patch "/master/lab_result_import_rows/#{pending_row.id}",
            params: { result_item_code: "L-COMMENT", write_to_master: true }

      expect(body["master_conflict"]).to be(true)
      expect(Master::LabResultItem.find_by(result_item_code: "L-COMMENT").jlac10_code)
        .to eq("1A000000000000001")
    end

    it "同じ外部コードの保留行にもまとめて反映する" do
      # 同じファイルを 2 回取り込み、別バッチの行を巻き込まないことも確かめる。
      upload
      upload
      rows = LabResultImportRow.where(external_name: "未登録項目").order(:id).to_a
      expect(rows.size).to eq(2)
      target = rows.first

      patch "/master/lab_result_import_rows/#{target.id}",
            params: { result_item_code: "L-COMMENT", apply_to_same_code: true }

      expect(target.reload.status).to eq("ready")
      expect(rows.last.reload.status).to eq("pending")
    end

    it "値を直すと保留が外れる" do
      upload
      # SN(<5)のような数値でない値が数値項目に来た行。値を直したらその場で判定し直す。
      row = LabResultImportRow.find_by(external_name: "AST")
      row.update!(value: "<5", status: "pending", pending_reason: "value_not_numeric")

      patch "/master/lab_result_import_rows/#{row.id}", params: { value: "42" }

      expect(row.reload.status).to eq("ready")
      expect(row.pending_reason).to be_nil
      expect(row.value).to eq("42")
    end

    it "対象外にできる" do
      patch "/master/lab_result_import_rows/#{pending_row.id}", params: { status: "skipped" }
      expect(pending_row.reload.status).to eq("skipped")
    end
  end

  describe "PATCH /master/lab_result_import_rows/bulk_update" do
    it "登録した結果の id を候補の行にまとめて書き戻す" do
      upload
      ids = LabResultImportRow.where(group_no: 2).pluck(:id)

      patch "/master/lab_result_import_rows/bulk_update",
            params: { ids: ids, report_fhir_id: "dr-1", patient_fhir_id: "p-1",
                      order_fhir_id: "sr-1" }

      rows = LabResultImportRow.where(id: ids)
      expect(rows.pluck(:status).uniq).to eq(["registered"])
      expect(rows.pluck(:report_fhir_id).uniq).to eq(["dr-1"])
      expect(rows.first.registered_at).to be_present
    end
  end

  describe "POST /master/lab_result_imports/:id/resolve" do
    it "マスタを直した後に保留行を引き当て直す" do
      upload
      id = body["import"]["id"]
      Master::LabResultItem.create!(result_item_code: "L-HBA1C", name: "HbA1c", data_type: "PQ",
                                    jlac10_code: "3D0450000019204")

      post "/master/lab_result_imports/#{id}/resolve"

      expect(response).to have_http_status(:ok)
      expect(body["resolved"]).to eq(1)
      expect(LabResultImportRow.find_by(external_name: "HbA1c").result_item_code).to eq("L-HBA1C")
    end

    it "人が手で選んだ行は上書きしない" do
      upload
      id = body["import"]["id"]
      Master::LabResultItem.create!(result_item_code: "L-MANUAL", name: "手選択", data_type: "ST")
      row = LabResultImportRow.find_by(external_name: "未登録項目")
      patch "/master/lab_result_import_rows/#{row.id}", params: { result_item_code: "L-MANUAL" }

      post "/master/lab_result_imports/#{id}/resolve"

      expect(row.reload.result_item_code).to eq("L-MANUAL")
    end
  end

  describe "DELETE /master/lab_result_imports/:id" do
    it "登録済みの行が混ざっていてもバッチごと消せる" do
      upload
      id = body["import"]["id"]
      LabResultImportRow.where(lab_result_import_id: id).update_all(status: "registered")

      delete "/master/lab_result_imports/#{id}"

      expect(response).to have_http_status(:no_content)
      expect(LabResultImport.where(id: id)).to be_empty
      expect(LabResultImportRow.where(lab_result_import_id: id)).to be_empty
    end
  end
end
