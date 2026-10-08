require "rails_helper"

# 令和8年度版の電子点数表から抜き出した fixture(dpc_tables_sample.xlsx)を取り込んで判定する。
RSpec.describe Dpc::Grouper do
  before(:context) do
    MasterImport::DpcTableImporter.call(File.open(Rails.root.join("spec/fixtures/files/dpc_tables_sample.xlsx")))
  end

  after(:context) do
    ActiveRecord::Base.connection.tables.grep(/\Amaster_dpc_/).each do |table|
      ActiveRecord::Base.connection.execute("DELETE FROM #{table}")
    end
  end

  let(:tables) { Dpc::Tables.for(Date.new(2026, 9, 10)) }

  def group(**attrs)
    described_class.new(tables: tables, input: Dpc::Input.new(age: 70, **attrs)).call
  end

  def branch(result, key)
    result[:branches].find { |b| b[:key] == key }
  end

  def item(code)
    Dpc::Item.new(code: code, name: code, date: "2026-09-02", source: "performed", ref: "Procedure/#{code}")
  end

  def drug(name, dosage_form: "4", yj: "4291410A1020")
    medicine = Dpc::Medicine.new(code: "6#{name.bytesize}", name: "#{name}点滴静注液", generic_name: "【般】#{name}点滴静注液",
                                 basic_name: name, dosage_form: dosage_form, yj_code: yj)
    Dpc::Item.new(name: medicine.name, date: "2026-09-02", source: "performed", ref: "MedicationAdministration/1",
                  medicine: medicine)
  end

  it "医療資源病名の ICD-10 から上 6 桁を引き、手術なしで分類を決める" do
    result = group(icd10: "C182")

    expect(result[:mdc6]).to eq("060035")
    expect(result[:classification_name]).to eq("結腸（虫垂を含む。）の悪性腫瘍")
    expect(branch(result, "surgery")).to include(value: "99", status: "auto")
    expect(result[:dpc_codes]).to eq(["060035xx99x0xx"])
  end

  it "定義に無い病名は分類を決めず理由を返す" do
    result = group(icd10: "Z999")

    expect(result[:mdc6]).to be_nil
    expect(result[:warnings]).to include(/定義されていません/)
  end

  describe "手術" do
    it "実施した手術のうちツリー図で最も下にある対応コード(01 が最優先)をとる" do
      result = group(icd10: "C182", items: [item("K7211"), item("K719-3")])

      expect(branch(result, "surgery")[:value]).to eq("01")
      expect(branch(result, "surgery")[:evidence].map { |e| e[:code] }).to eq(["K719-3"])
      expect(result[:dpc_codes]).to eq(["060035xx0100xx"])
    end

    it "手術フラグではなく対応コードで選ぶ" do
      # 010060: 脳血管内手術 K1781 は手術フラグ 01・対応コード 02、内頸動脈の血栓内膜摘出術 K6092 は
      # 手術フラグ 03・対応コード 01。ツリー図では 01 が下にある。
      result = group(icd10: "I633", items: [item("K1781"), item("K6092")])

      expect(branch(result, "surgery")[:value]).to eq("01")
      expect(branch(result, "surgery")[:evidence].map { |e| e[:code] }).to eq(["K6092"])
    end

    it "定義に無い手術だけなら 97。輸血は手術に数え、手術等管理料・輸血管理料だけなら手術なし" do
      expect(branch(group(icd10: "C182", items: [item("K0001")]), "surgery")[:value]).to eq("97")
      expect(branch(group(icd10: "C182", items: [item("K9202ｲ")]), "surgery")[:value]).to eq("97")
      expect(branch(group(icd10: "C182", items: [item("K920-21")]), "surgery")[:value]).to eq("99")
      expect(branch(group(icd10: "C182", items: [item("K9161")]), "surgery")[:value]).to eq("99")
    end

    it "包括の対象外になる手術を実施していれば知らせる" do
      expect(group(icd10: "C182", items: [item("K014")])[:warnings]).to include(/包括の対象外/)
    end
  end

  describe "手術・処置等2 の薬剤" do
    it "投与した薬剤の一般名から候補を出し、確定するまでは候補として数えて知らせる" do
      result = group(icd10: "C182", items: [drug("オキサリプラチン")])

      candidate = result[:candidates].find { |c| c[:code] == "0156" }
      expect(candidate).to include(name: "オキサリプラチン", status: "suggested")
      expect(candidate[:basis].first).to include(note: "一般名", ref: "MedicationAdministration/1")
      expect(result[:candidates].map { |c| c[:code] }).to include("0005", "0046")
      expect(branch(result, "proc2")[:value]).to eq("4")
      expect(result[:dpc_codes]).to eq(["060035xx99x4xx"])
      expect(result[:warnings]).to include(/確定していない/)
    end

    it "確定すれば警告は消え、除外すれば分岐から外れる" do
      accepted = group(icd10: "C182", items: [drug("オキサリプラチン")],
                       overrides: Dpc::Overrides.new(accepted: %w[0156 0005 0046]))
      expect(accepted[:warnings]).to be_empty

      rejected = group(icd10: "C182", items: [drug("オキサリプラチン")],
                       overrides: Dpc::Overrides.new(rejected: %w[0156 0005]))
      expect(branch(rejected, "proc2")[:value]).to eq("0")
    end

    it "処置等2 は該当する行のうちツリー図で最も下にある対応コードをとる" do
      result = group(icd10: "C182", items: [drug("オキサリプラチン"), drug("ベバシズマブ", yj: "4291413A1020")])

      expect(branch(result, "proc2")[:value]).to eq("5")
    end

    it "「注射薬に限る」のような但し書きは剤形で絞る" do
      names = { "0100" => "テモゾロミド（注射薬に限る。）" }
      oral = Dpc::DrugMatcher.new(names: names, items: [drug("テモゾロミド", dosage_form: "1")]).call
      injection = Dpc::DrugMatcher.new(names: names, items: [drug("テモゾロミド", dosage_form: "4")]).call

      expect(oral).to be_empty
      expect(injection.map(&:code)).to eq(["0100"])
    end

    it "実施記録に無い処置は上書きで足せる" do
      result = group(icd10: "C182", overrides: Dpc::Overrides.new(accepted: ["J0451"]))

      expect(branch(result, "proc2")[:value]).to eq("1")
      expect(branch(result, "proc2")[:evidence]).to include(include(source: "override", code: "J0451"))
    end
  end

  describe "定義副傷病" do
    it "手術ありのときだけ数える副傷病(フラグ 3)は、手術なしでは数えない" do
      with_surgery = group(icd10: "C182", comorbidity_icd10s: ["K560"], items: [item("K719-3")])
      without = group(icd10: "C182", comorbidity_icd10s: ["K560"])

      expect(branch(with_surgery, "comorbidity")).to include(value: "1")
      expect(branch(without, "comorbidity")).to include(value: "0")
    end
  end

  describe "病態等・年齢等・重症度" do
    it "肺炎は年齢と市中肺炎で病態等を、A-DROP で重症度を決める" do
      result = group(icd10: "J189", age: 80, pneumonia_category: "5", adrop: 2)

      expect(branch(result, "pathology")[:value]).to eq("2")
      expect(branch(result, "sev_adrop")[:value]).to eq("2")
      expect(result[:dpc_codes]).to eq(["0400802499x0xx"])
    end

    it "肺炎の区分が無ければ病態等は未確定で、候補を広げて返す" do
      result = group(icd10: "J189", age: 80, adrop: 2)

      expect(branch(result, "pathology")[:status]).to eq("undetermined")
      expect(result[:dpc_codes].size).to be > 1
    end

    it "脳梗塞の発症時期を 10－4 の区分から対応コードにする" do
      expect(branch(group(icd10: "I633", stroke_onset: "1"), "sev_stroke_onset")[:value]).to eq("3")
      expect(branch(group(icd10: "I633", stroke_onset: "4"), "sev_stroke_onset")[:value]).to eq("0")
    end

    it "急性膵炎は予後因子の範囲ごとに造影 CT の Grade で重症度を決める" do
      expect(branch(group(icd10: "K859", pancreatitis_a: 1, pancreatitis_b: 3), "sev_pancreatitis")[:value]).to eq("1")
      expect(branch(group(icd10: "K859", pancreatitis_a: 4, pancreatitis_b: 9), "sev_pancreatitis")[:value]).to eq("0")
    end

    it "人の上書きは自動の値より優先し、自動の値も返す" do
      result = group(icd10: "C182", overrides: Dpc::Overrides.new(branches: { "surgery" => "97" }))

      expect(branch(result, "surgery")).to include(value: "97", auto_value: "99", status: "override")
      expect(result[:dpc_codes]).to eq(["060035xx97x0xx"])
    end
  end
end
