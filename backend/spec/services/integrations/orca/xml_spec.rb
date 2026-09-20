require "rails_helper"

RSpec.describe Integrations::Orca::Xml do
  describe ".build" do
    it "writes scalars, records and arrays in the shape the 日レセ expects" do
      xml = described_class.build("medicalreq", {
        "Patient_ID" => "00001",
        "Diagnosis_Information" => {
          "Department_Code" => "01",
          "Medical_Information" => [
            { "Medical_Class" => "120", "Medication_info" => [{ "Medication_Code" => "112007410" }] }
          ]
        }
      })

      expect(xml).to include('<Patient_ID type="string">00001</Patient_ID>')
      expect(xml).to include('<Diagnosis_Information type="record">')
      expect(xml).to include('<Medical_Information type="array">')
      # 配列の子要素名は「親 + _child」で機械的に決まる
      expect(xml).to include('<Medical_Information_child type="record">')
      expect(xml).to include('<Medication_info_child type="record">')
    end

    it "drops nil values but keeps empty strings" do
      xml = described_class.build("req", { "A" => nil, "B" => "" })

      expect(xml).not_to include("<A")
      expect(xml).to include('<B type="string"/>')
    end

    it "escapes characters that would break the document" do
      xml = described_class.build("req", { "Name" => "a<b&c" })

      expect(xml).to include("a&lt;b&amp;c")
      expect(described_class.parse(xml)).to eq({ "Name" => "a<b&c" })
    end
  end

  describe ".parse" do
    let(:body) do
      <<~XML
        <?xml version="1.0" encoding="UTF-8"?>
        <xmlio2><medicalres type="record">
          <Api_Result type="string">00</Api_Result>
          <Nested type="record"><Inner type="string">x</Inner></Nested>
          <Rows type="array">
            <Rows_child type="record"><Code type="string">a</Code></Rows_child>
            <Rows_child type="record"><Code type="string">b</Code></Rows_child>
          </Rows>
        </medicalres></xmlio2>
      XML
    end

    it "strips xmlio2 and the response record, and maps arrays to Ruby arrays" do
      parsed = described_class.parse(body)

      expect(parsed["Api_Result"]).to eq("00")
      expect(parsed["Nested"]).to eq({ "Inner" => "x" })
      expect(parsed["Rows"]).to eq([{ "Code" => "a" }, { "Code" => "b" }])
    end

    it "reports the response record name" do
      expect(described_class.response_record_name(body)).to eq("medicalres")
    end

    # 認証に失敗すると日レセの手前(リバースプロキシ等)が HTML を返すことがある。
    # 文字列のまま返すと呼び側の empty? 判定をすり抜けるので Hash に倒す。
    it "returns an empty hash for a body that is not a 日レセ response" do
      expect(described_class.parse("<html>401 Unauthorized</html>")).to eq({})
      expect(described_class.parse("not xml at all")).to eq({})
      expect(described_class.parse("")).to eq({})
    end

    it "round-trips what build produced" do
      xml = described_class.build("req", { "A" => "1", "B" => [{ "C" => "2" }] })

      expect(described_class.parse(xml)).to eq({ "A" => "1", "B" => [{ "C" => "2" }] })
    end
  end
end
