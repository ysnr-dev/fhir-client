require "rails_helper"

# 対象入院の絞り込み(退院日を日本時間で数える・ページング)、様式1 の行への展開
# (整列・空レコードの除外・下書きの除外)、Shift_JIS のバイト列と警告を検証する。
RSpec.describe DpcForm1Export do
  let(:base_url) { "http://fhir.example" }
  let(:gateway) do
    FhirGateway.new(
      base_url: base_url, host_header: nil,
      token_provider: FhirTokenProvider.new(base_url: base_url, client_id: nil, client_secret: nil, host_header: nil)
    )
  end
  let(:store) { Integrations::FhirStore.new(gateway: gateway) }

  def export(month = "2026-09")
    described_class.new(month: month, store: store)
  end

  def encounter(id, period_end:, period_start: "2026-09-01T10:00:00+09:00", patient: "p-#{id}")
    {
      "resourceType" => "Encounter", "id" => id, "status" => "finished",
      "class" => { "code" => "IMP" },
      "subject" => { "reference" => "Patient/#{patient}", "display" => "患者 #{id}" },
      "period" => { "start" => period_start, "end" => period_end }
    }
  end

  def answer(link_id, value)
    { "linkId" => link_id, "answer" => [{ "valueString" => value }] }
  end

  # payloads は { 1 => "19640521", 9 => "…" } のように番号で渡す(空のペイロードは item ごと無い)。
  def record(code, payloads, seq: "0", ver: "20140401")
    { "linkId" => code,
      "item" => [answer("#{code}.ver", ver), answer("#{code}.seq", seq)] +
        payloads.map { |n, value| answer("#{code}.p#{n}", value) } +
        [{ "linkId" => "#{code}.ref", "answer" => [{ "valueReference" => { "reference" => "Condition/c1" } }] }] }
  end

  def form1(id, encounter_id, records, status: "completed", facility: "131234567", data_id: "0000000001",
            admit: "20260901", count: "0", summary_no: "0", updated: "2026-09-20T00:00:00Z")
    {
      "resourceType" => "QuestionnaireResponse", "id" => id,
      "meta" => { "lastUpdated" => updated },
      "questionnaire" => described_class::QUESTIONNAIRE_URL,
      "status" => status,
      "encounter" => { "reference" => "Encounter/#{encounter_id}" },
      "subject" => { "reference" => "Patient/p-#{encounter_id}" },
      "item" => [
        { "linkId" => "header",
          "item" => [answer("header.facility", facility), answer("header.dataId", data_id),
                     answer("header.admitDate", admit), answer("header.count", count),
                     answer("header.summaryNo", summary_no), answer("header.fiscalYear", "2026")] }
      ] + records
    }
  end

  def searchset(resources, next_url: nil)
    bundle = { "resourceType" => "Bundle", "type" => "searchset",
               "entry" => resources.map { |r| { "resource" => r } } }
    bundle["link"] = [{ "relation" => "next", "url" => next_url }] if next_url
    bundle.to_json
  end

  def stub_encounters(resources, next_url: nil)
    stub_request(:get, "#{base_url}/Encounter")
      .with(query: hash_including("class" => "IMP"))
      .to_return(status: 200, body: searchset(resources, next_url: next_url))
  end

  def stub_responses(resources)
    stub_request(:get, "#{base_url}/QuestionnaireResponse")
      .with(query: hash_including("questionnaire" => described_class::QUESTIONNAIRE_URL))
      .to_return(status: 200, body: searchset(resources))
  end

  # ヘッダー行を除いた行を、UTF-8 に戻して列に分けたもの。
  def rows_of(bytes)
    bytes.dup.force_encoding("Windows-31J").encode("UTF-8").split("\r\n", -1)[1..-2].map { |l| l.split("\t", -1) }
  end

  it "rejects a malformed month" do
    expect { described_class.new(month: "2026-13") }.to raise_error(described_class::InvalidMonth)
    expect { described_class.new(month: "202609") }.to raise_error(described_class::InvalidMonth)
    expect { described_class.new(month: nil) }.to raise_error(described_class::InvalidMonth)
  end

  describe "対象入院の絞り込み" do
    it "searches finished inpatient encounters overlapping the month with strict handling" do
      search = stub_encounters([])
      allow(store).to receive(:search).and_call_original

      export.summary

      expect(store).to have_received(:search).with(
        "Encounter",
        { "class" => "IMP", "status" => "finished", "date" => %w[ge2026-09-01 le2026-09-30], "_count" => 500 },
        limit: described_class::SEARCH_LIMIT
      )
      expect(search.with(headers: { "Prefer" => "handling=strict" })).to have_been_requested.once
    end

    it "keeps only encounters discharged within the month in Japan time" do
      stub_encounters([
        encounter("prev", period_end: "2026-08-31T14:59:59Z"),   # JST 08-31 23:59
        encounter("first", period_end: "2026-08-31T15:00:00Z"),  # JST 09-01 00:00
        encounter("last", period_end: "2026-09-30T14:59:59Z"),   # JST 09-30 23:59
        encounter("next", period_end: "2026-09-30T15:00:00Z"),   # JST 10-01 00:00
        encounter("dateonly", period_end: "2026-09-15", period_start: "2026-09-10"),
        encounter("open", period_end: nil)
      ])
      stub_responses([])

      summary = export.summary

      expect(summary[:encounters].map { |row| row[:encounter_id] }).to eq(%w[first dateonly last])
      expect(summary[:encounters].first).to eq(
        encounter_id: "first", patient_id: "p-first", patient_display: "患者 first",
        admit_date: "2026-09-01", discharge_date: "2026-09-01",
        form1_status: "none", questionnaire_response_id: nil
      )
    end

    it "follows next links so that no encounter is dropped" do
      stub_encounters([encounter("e1", period_end: "2026-09-10T10:00:00+09:00")],
                      next_url: "#{base_url}/Encounter?_cursor=abc")
      page2 = stub_request(:get, "#{base_url}/Encounter?_cursor=abc")
              .to_return(status: 200, body: searchset([encounter("e2", period_end: "2026-09-11T10:00:00+09:00")]))
      stub_responses([])

      expect(export.summary[:encounters].map { |row| row[:encounter_id] }).to eq(%w[e1 e2])
      expect(page2).to have_been_requested.once
    end

    it "fetches the responses of many encounters in chunks, not one by one" do
      encounters = (1..120).map { |n| encounter(format("e%03d", n), period_end: "2026-09-10T10:00:00+09:00") }
      stub_encounters(encounters)
      responses = stub_responses([])
      allow(store).to receive(:search).and_call_original

      export.summary

      expect(responses).to have_been_requested.times(3)
      expect(store).to have_received(:search).with(
        "QuestionnaireResponse",
        { "questionnaire" => described_class::QUESTIONNAIRE_URL,
          "encounter" => (1..50).map { |n| format("Encounter/e%03d", n) }.join(","), "_count" => 500 },
        limit: described_class::SEARCH_LIMIT
      )
    end
  end

  describe "様式1 の状態と重複" do
    before do
      stub_encounters([
        encounter("e1", period_end: "2026-09-10T10:00:00+09:00"),
        encounter("e2", period_end: "2026-09-11T10:00:00+09:00"),
        encounter("e3", period_end: "2026-09-12T10:00:00+09:00"),
        encounter("e4", period_end: "2026-09-13T10:00:00+09:00")
      ])
    end

    it "reports the status of each encounter and exports only completed or amended responses" do
      stub_responses([
        form1("q1", "e1", [record("A000010", { 1 => "19640521" })], data_id: "0000000001"),
        form1("q2", "e2", [record("A000010", { 1 => "19700101" })], status: "in-progress", data_id: "0000000002"),
        form1("q3", "e3", [record("A000010", { 1 => "19800101" })], status: "amended", data_id: "0000000003")
      ])

      exporter = export
      summary = exporter.summary

      expect(summary[:encounters].map { |row| [row[:form1_status], row[:questionnaire_response_id]] })
        .to eq([["completed", "q1"], ["in-progress", "q2"], ["amended", "q3"], ["none", nil]])
      expect(summary).to include(month: "2026-09", filename: "FF1_131234567_2609.txt",
                                 facility_code: "131234567",
                                 exported_count: 2, excluded_count: 2, record_count: 2, warnings: [])
      expect(rows_of(exporter.file).map { |row| row[1] }).to eq(%w[0000000001 0000000003])
    end

    it "uses the latest response when an encounter has several and warns about it" do
      stub_responses([
        form1("old", "e1", [record("A000010", { 1 => "19640521" })], updated: "2026-09-18T00:00:00Z"),
        form1("new", "e1", [record("A000010", { 1 => "19640522" })], status: "amended",
                                                                     updated: "2026-09-19T00:00:00Z")
      ])

      exporter = export
      summary = exporter.summary

      expect(summary[:encounters].first).to include(form1_status: "amended", questionnaire_response_id: "new")
      expect(summary[:warnings]).to contain_exactly(
        include(type: "duplicate_response", encounter_id: "e1", patient_id: "p-e1")
      )
      expect(rows_of(exporter.file).map { |row| row[8] }).to eq(["19640522"])
    end

    it "warns when facility codes disagree and names the file after the majority" do
      stub_responses([
        form1("q1", "e1", [record("A000010", { 1 => "1" })], data_id: "0000000001"),
        form1("q2", "e2", [record("A000010", { 1 => "1" })], data_id: "0000000002"),
        form1("q3", "e3", [record("A000010", { 1 => "1" })], data_id: "0000000003", facility: "139999999")
      ])

      exporter = export

      expect(exporter.filename).to eq("FF1_131234567_2609.txt")
      expect(exporter.summary[:warnings]).to contain_exactly(
        include(type: "facility_code_mismatch", encounter_id: "e3")
      )
    end

    it "raises when nothing is exportable" do
      stub_responses([form1("q2", "e2", [record("A000010", { 1 => "1" })], status: "in-progress")])

      exporter = export

      expect(exporter.summary).to include(filename: nil, exported_count: 0, excluded_count: 4)
      expect { exporter.file }.to raise_error(described_class::NothingToExport)
    end
  end

  describe "ファイル本体" do
    before do
      stub_encounters([
        encounter("e1", period_end: "2026-09-10T10:00:00+09:00"),
        encounter("e2", period_end: "2026-09-11T10:00:00+09:00")
      ])
    end

    it "sorts forms by header and records by code, version and sequence, dropping empty records" do
      stub_responses([
        form1("q1", "e1", [
          record("A006040", { 2 => "I10", 9 => "高血圧症" }, seq: "10"),
          record("A006040", { 2 => "E119", 9 => "２型糖尿病" }, seq: "2"),
          record("A000020", { 1 => "20260901", 2 => "1" }),
          record("A000040", {}),
          record("A006040", { 2 => "K219" }, seq: "1"),
          record("A000010", { 1 => "19640521", 2 => "1", 3 => "1920914" })
        ], data_id: "0000000002"),
        form1("q2", "e2", [record("A000010", { 1 => "19700101" })], data_id: "0000000001", admit: "20260905")
      ])

      rows = rows_of(export.file)

      expect(rows).to all(have_attributes(size: 17))
      expect(rows.map { |row| row[0, 8] }).to eq([
        %w[131234567 0000000001 20260905 0 0 A000010 20140401 0],
        %w[131234567 0000000002 20260901 0 0 A000010 20140401 0],
        %w[131234567 0000000002 20260901 0 0 A000020 20140401 0],
        %w[131234567 0000000002 20260901 0 0 A006040 20140401 1],
        %w[131234567 0000000002 20260901 0 0 A006040 20140401 2],
        %w[131234567 0000000002 20260901 0 0 A006040 20140401 10]
      ])
      # 空のペイロードは空文字のまま(0 やスペースで埋めない)。元リソースの参照は出さない。
      expect(rows[1][8..]).to eq(["19640521", "1", "1920914", "", "", "", "", "", ""])
      expect(rows[4][8..]).to eq(["", "E119", "", "", "", "", "", "", "２型糖尿病"])
    end

    it "sorts forms of the same patient by admission date, count and summary number" do
      stub_responses([
        form1("q1", "e1", [record("A000010", { 1 => "1" })], admit: "20260905", summary_no: "1"),
        form1("q2", "e2", [record("A000010", { 1 => "1" })], admit: "20260905", summary_no: "0")
      ])

      expect(rows_of(export.file).map { |row| row[2, 3] }).to eq([%w[20260905 0 0], %w[20260905 0 1]])
    end

    it "writes Windows-31J bytes with CRLF line breaks and a header row" do
      stub_responses([
        form1("q1", "e1", [record("A007010", { 2 => "K4073ｲ", 9 => "胃癌" }, seq: "1")])
      ])

      bytes = export.file

      expect(bytes.encoding).to eq(Encoding::BINARY)
      header, line, rest = bytes.split("\r\n".b, -1)
      expect(rest).to eq("".b)
      expect(header).to eq(described_class::HEADER_ROW.join("\t").encode("Windows-31J").b)
      expect(header.force_encoding("Windows-31J").encode("UTF-8").split("\t").size).to eq(17)
      # 全角は 2 バイト(胃 = 88 DD、癌 = 8A E0)、半角カナは 1 バイト(ｲ = B2)。
      expect(line).to eq(
        "131234567\t0000000001\t20260901\t0\t0\tA007010\t20140401\t1\t\tK4073\xB2\t\t\t\t\t\t\t\x88\xDD\x8A\xE0".b
      )
    end

    it "replaces characters outside Shift_JIS and warns with the patient and the code" do
      stub_responses([
        form1("q1", "e1", [
          record("A006010", { 9 => "𠮷田病 😀" }),
          record("A006020", { 9 => "１〜２型−" })
        ])
      ])

      exporter = export
      rows = rows_of(exporter.file)

      expect(rows[0][16]).to eq("?田病 ?")
      # 波ダッシュ・マイナスは Windows-31J の同じ字形(全角チルダ・全角ハイフンマイナス)に寄せる。
      expect(rows[1][16]).to eq("１～２型－")
      expect(exporter.summary[:warnings]).to contain_exactly(
        include(type: "unencodable_character", encounter_id: "e1", patient_id: "p-e1",
                patient_display: "患者 e1", code: "A006010")
      )
    end

    it "replaces tabs and line breaks inside a payload" do
      stub_responses([form1("q1", "e1", [record("A006010", { 9 => "胃癌\t術後\r\n再発" })])])

      exporter = export

      expect(rows_of(exporter.file)[0][16]).to eq("胃癌 術後 再発")
      expect(exporter.summary[:warnings]).to contain_exactly(include(type: "control_character", code: "A006010"))
    end
  end

  it "raises the store error when the upstream fails" do
    stub_request(:get, "#{base_url}/Encounter").with(query: hash_including("class" => "IMP"))
                                               .to_return(status: 500, body: "boom")

    expect { export.summary }.to raise_error(Integrations::FhirStore::UpstreamError)
  end
end
