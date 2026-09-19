require "rails_helper"

RSpec.describe "Master::Pathways", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_pathway(code, name, **attrs)
    Master::Pathway.create!({ pathway_code: code, name: name }.merge(attrs))
  end

  # 病日を直に作る。フェーズが無ければ既定のフェーズを 1 つ作って結ぶ。
  def create_event(code, **attrs)
    phase = Master::PathwayPhase.find_by(pathway_code: code) ||
            Master::PathwayPhase.create!(pathway_code: code, phase_key: SecureRandom.uuid, display_order: 1)
    Master::PathwayEvent.create!({ pathway_code: code, phase_key: phase.phase_key }.merge(attrs))
  end

  UNIT_KEY = "e89a8e7c-2f30-4a8e-88d7-41cdf3e7617a".freeze
  ASSESSMENT_KEY = "0b1c2d3e-4f50-4617-8899-aabbccddeeff".freeze
  TASK_KEY = "11111111-2222-4333-8444-555555555555".freeze

  let(:event_params) do
    [
      { elapsed_days: 1, title: "入院日",
        oat_units: [
          { unit_key: UNIT_KEY, name: "身体的準備ができている", category: "H", code_system: "bom", code: "O00470",
            critical: true,
            assessments: [
              { assessment_key: ASSESSMENT_KEY, name: "感冒症状がない", category_code: "34", category_name: "呼吸",
                code_system: "bom", code: "3400063200", proper_value: "なし" },
            ],
            tasks: [
              { task_key: TASK_KEY, name: "感冒様症状の観察", category_lv1: "NO", assessment_key: ASSESSMENT_KEY },
              { name: "術後鎮痛薬", category_lv1: "TP", category_lv2: "TPPR", order_type: "prescription",
                order_label: "ロキソプロフェン 3錠", order_values: { rps: [{ medicines: [{ code: "1" }] }] },
                order_schema_version: 1 },
            ] },
        ] },
      { elapsed_days: 2, title: "手術当日",
        oat_units: [{ name: "疼痛がコントロールできる", category: "G", assessments: [], tasks: [] }] },
    ]
  end

  describe "GET /master/pathways" do
    before do
      create_pathway("000001", "PCI(2泊3日)", name_kana: "ピーシーアイ", department_code: "01", status: "approved",
                                            scheduled_days: 3, display_order: 1)
      create_pathway("000002", "胆嚢摘出", department_code: "02", status: "draft", setting: "outpatient", display_order: 2)
      create_pathway("000003", "旧パス", status: "retired", display_order: 3,
                                valid_from: Date.current - 100, valid_to: Date.current - 1)
      create_event("000001", elapsed_days: 1)
      create_event("000001", elapsed_days: 3)
    end

    it "表示順で一覧を返し、病日数と最終病日を添える" do
      get "/master/pathways"

      expect(body["items"].map { |i| i["pathway_code"] }).to eq(%w[000001 000002 000003])
      expect(body["items"][0]["event_count"]).to eq(2)
      expect(body["items"][0]["last_day"]).to eq(3)
      expect(body["items"][1]["event_count"]).to eq(0)
      expect(body["items"][0]).not_to have_key("search_name")
    end

    it "名称・カナで検索できる" do
      get "/master/pathways", params: { name: "ぴーしーあい" }

      expect(body["items"].map { |i| i["pathway_code"] }).to eq(%w[000001])
    end

    it "診療科・状態・入外・有効期間で絞れる" do
      get "/master/pathways", params: { department_code: "02" }
      expect(body["items"].map { |i| i["pathway_code"] }).to eq(%w[000002])

      get "/master/pathways", params: { status: "approved" }
      expect(body["items"].map { |i| i["pathway_code"] }).to eq(%w[000001])

      get "/master/pathways", params: { setting: "outpatient" }
      expect(body["items"].map { |i| i["pathway_code"] }).to eq(%w[000002])

      get "/master/pathways", params: { active: "true" }
      expect(body["items"].map { |i| i["pathway_code"] }).to eq(%w[000001 000002])
    end
  end

  describe "GET /master/pathways/:id" do
    let!(:pathway) { create_pathway("000001", "PCI(2泊3日)") }

    before do
      Master::PathwayIndication.create!(pathway_code: "000001", management_number: "20058911", name: "狭心症",
                                        icd10: "I209", display_order: 1)
      day3 = create_event("000001", elapsed_days: 3, title: "退院日", display_order: 1)
      day1 = create_event("000001", elapsed_days: 1, title: "入院日", display_order: 2)
      unit = Master::PathwayOatUnit.create!(pathway_code: "000001", event_id: day1.id, unit_key: UNIT_KEY,
                                            name: "身体的準備ができている", display_order: 1)
      assessment = Master::PathwayAssessment.create!(pathway_code: "000001", unit_id: unit.id,
                                                     assessment_key: ASSESSMENT_KEY, name: "感冒症状がない")
      Master::PathwayTask.create!(pathway_code: "000001", unit_id: unit.id, assessment_id: assessment.id,
                                  task_key: TASK_KEY, name: "感冒様症状の観察", category_lv1: "NO")
      Master::PathwayOatUnit.create!(pathway_code: "000001", event_id: day3.id, unit_key: SecureRandom.uuid,
                                     name: "退院できる", display_order: 1)
      # 別パスの子は混ざらない。
      create_event("000002", elapsed_days: 1)
    end

    it "コードでも引け、病日順に入れ子で返す" do
      get "/master/pathways/000001"

      expect(body["name"]).to eq("PCI(2泊3日)")
      expect(body["indications"].map { |i| i["name"] }).to eq(["狭心症"])
      expect(body["events"].map { |e| e["elapsed_days"] }).to eq([1, 3])
      expect(body["events"][0]["event_key"]).to eq("1")
      unit = body["events"][0]["oat_units"][0]
      expect(unit["unit_key"]).to eq(UNIT_KEY)
      expect(unit["assessments"][0]["assessment_key"]).to eq(ASSESSMENT_KEY)
      expect(unit["tasks"][0]["assessment_key"]).to eq(ASSESSMENT_KEY)
      expect(body["events"][1]["oat_units"][0]["name"]).to eq("退院できる")
      expect(body["event_count"]).to eq(2)
    end

    it "id でも引ける" do
      get "/master/pathways/#{pathway.id}"

      expect(body["pathway_code"]).to eq("000001")
    end
  end

  describe "POST /master/pathways" do
    it "コードを省略すると自動採番し、子を入れ子で保存する" do
      create_pathway("000012", "既存")

      post "/master/pathways", params: {
        name: "PCI(2泊3日)", scheduled_days: 3, adaptive_criteria: "待機的 PCI", status: "approved",
        indications: [{ management_number: "20058911", name: "狭心症" }],
        events: event_params,
      }, as: :json

      expect(response).to have_http_status(:created)
      expect(body["pathway_code"]).to eq("000013")
      expect(body["approved_on"]).to eq(Date.current.to_s)
      events = body["events"]
      expect(events.map { |e| e["display_order"] }).to eq([1, 2])
      unit = events[0]["oat_units"][0]
      expect(unit["unit_key"]).to eq(UNIT_KEY)
      expect(unit["critical"]).to be(true)
      expect(unit["assessments"][0]["assessment_key"]).to eq(ASSESSMENT_KEY)
      tasks = unit["tasks"]
      expect(tasks.map { |t| t["display_order"] }).to eq([1, 2])
      expect(tasks[0]["task_key"]).to eq(TASK_KEY)
      expect(tasks[0]["assessment_key"]).to eq(ASSESSMENT_KEY)
      expect(tasks[1]["task_key"]).to match(/\A[0-9a-f-]{36}\z/)
      expect(tasks[1]["assessment_key"]).to be_nil
      expect(tasks[1]["order_values"]).to eq({ "rps" => [{ "medicines" => [{ "code" => "1" }] }] })
      expect(events[1]["oat_units"][0]["unit_key"]).to match(/\A[0-9a-f-]{36}\z/)
    end

    it "自動採番はサンプルの 9000xx 帯を数えない" do
      create_pathway("900001", "サンプル")

      post "/master/pathways", params: { name: "施設の 1 件目" }, as: :json

      expect(response).to have_http_status(:created)
      expect(body["pathway_code"]).to eq("000001")
    end

    it "名称は必須" do
      post "/master/pathways", params: { note: "名称なし" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "検証に落ちた子があれば本体も登録されない" do
      post "/master/pathways", params: {
        name: "病日 0", events: [{ elapsed_days: 0, oat_units: [] }],
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(Master::Pathway.count).to eq(0)

      post "/master/pathways", params: {
        name: "病日重複", events: [{ elapsed_days: 1, oat_units: [] }, { elapsed_days: 1, oat_units: [] }],
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(Master::Pathway.count).to eq(0)
      expect(Master::PathwayEvent.count).to eq(0)

      post "/master/pathways", params: {
        name: "不明な観察項目",
        events: [{ elapsed_days: 1, oat_units: [{ name: "x", assessments: [],
                                                 tasks: [{ name: "t", category_lv1: "NO", assessment_key: ASSESSMENT_KEY }] }] }],
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("観察項目")
      expect(Master::Pathway.count).to eq(0)

      post "/master/pathways", params: {
        name: "分類の不一致",
        events: [{ elapsed_days: 1, oat_units: [{ name: "x", tasks: [{ name: "t", category_lv1: "TP", category_lv2: "EXSP" }] }] }],
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(Master::Pathway.count).to eq(0)

      post "/master/pathways", params: {
        name: "不正な雛形種別",
        events: [{ elapsed_days: 1, oat_units: [{ name: "x", tasks: [{ name: "t", category_lv1: "TP", order_type: "bogus" }] }] }],
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(Master::Pathway.count).to eq(0)
    end

    it "同じ識別子を別の病日に置ける(日をまたぐアウトカム・継続するタスク)" do
      unit = ->(day) {
        { elapsed_days: day, oat_units: [
          { unit_key: UNIT_KEY, name: "疼痛が自制内である",
            assessments: [{ assessment_key: ASSESSMENT_KEY, name: "疼痛(NRS)", proper_value: day == 3 ? "2以下" : "3以下" }],
            tasks: [{ task_key: TASK_KEY, name: "弾性ストッキング着用", category_lv1: "NC", assessment_key: ASSESSMENT_KEY }] },
        ] }
      }
      post "/master/pathways", params: { name: "続き", events: [unit.call(2), unit.call(3)] }, as: :json

      expect(response).to have_http_status(:created)
      units = body["events"].map { |e| e["oat_units"][0] }
      expect(units.map { |u| u["unit_key"] }).to eq([UNIT_KEY, UNIT_KEY])
      expect(units.map { |u| u["assessments"][0]["proper_value"] }).to eq(%w[3以下 2以下])
      expect(units.map { |u| u["tasks"][0]["task_key"] }).to eq([TASK_KEY, TASK_KEY])
      expect(units.map { |u| u["tasks"][0]["assessment_key"] }).to eq([ASSESSMENT_KEY, ASSESSMENT_KEY])
    end

    it "同じ病日の中で識別子が重なれば登録できない" do
      post "/master/pathways", params: {
        name: "ユニット重複",
        events: [{ elapsed_days: 1, oat_units: [{ unit_key: UNIT_KEY, name: "a" }, { unit_key: UNIT_KEY, name: "b" }] }],
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("同じ病日の中で重複")

      post "/master/pathways", params: {
        name: "タスク重複",
        events: [{ elapsed_days: 1, oat_units: [{ name: "a", tasks: [
          { task_key: TASK_KEY, name: "t1", category_lv1: "NO" }, { task_key: TASK_KEY, name: "t2", category_lv1: "NO" },
        ] }] }],
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("同じ OAT ユニットの中で重複")

      post "/master/pathways", params: {
        name: "観察項目重複",
        events: [{ elapsed_days: 1, oat_units: [{ name: "a", assessments: [
          { assessment_key: ASSESSMENT_KEY, name: "a1" }, { assessment_key: ASSESSMENT_KEY, name: "a2" },
        ] }] }],
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("同じ OAT ユニットの中で重複")
      expect(Master::Pathway.count).to eq(0)
    end

    it "同じ病日をパスステップで分けられる(手術当日の術前・術後)" do
      post "/master/pathways", params: {
        name: "分割",
        events: [
          { elapsed_days: 2, path_step: 1, path_step_name: "術前", title: "手術当日", oat_units: [{ unit_key: UNIT_KEY, name: "a" }] },
          { elapsed_days: 2, path_step: 2, path_step_name: "術後", title: "手術当日", oat_units: [{ unit_key: UNIT_KEY, name: "a" }] },
        ],
      }, as: :json

      expect(response).to have_http_status(:created)
      expect(body["events"].map { |e| [e["event_key"], e["path_step_name"]] }).to eq([%w[2 術前], %w[2-2 術後]])
      expect(body["event_count"]).to eq(1)
    end

    it "有効終了日が有効開始日より前なら登録できない" do
      post "/master/pathways", params: { name: "期間おかしい", valid_from: "2026-08-01", valid_to: "2026-07-01" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("有効開始日以降")
    end
  end

  describe "PUT /master/pathways/:id" do
    let!(:pathway) { create_pathway("000001", "PCI") }

    before do
      Master::PathwayIndication.create!(pathway_code: "000001", management_number: "20058911", name: "狭心症")
      put "/master/pathways/#{pathway.id}", params: { events: event_params }, as: :json
    end

    it "子の配列を丸ごと置き換え、uuid を保ち、送られなかった種別は触らない" do
      task_ids = Master::PathwayTask.pluck(:id)

      put "/master/pathways/#{pathway.id}", params: {
        name: "PCI 改", events: [event_params[0]],
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(body["name"]).to eq("PCI 改")
      expect(body["events"].size).to eq(1)
      expect(body["indications"].size).to eq(1)
      unit = body["events"][0]["oat_units"][0]
      expect(unit["unit_key"]).to eq(UNIT_KEY)
      expect(unit["tasks"][0]["assessment_key"]).to eq(ASSESSMENT_KEY)
      expect(Master::PathwayTask.pluck(:id) & task_ids).to be_empty
      expect(Master::PathwayEvent.where(pathway_code: "000001").count).to eq(1)
    end
  end

  describe "PUT /master/pathways/:id(承認済の凍結)" do
    let!(:pathway) do
      create_pathway("000001", "PCI", status: "approved", approved_on: Date.current, approved_by: "p1")
    end

    it "承認済は内容を変更できない" do
      put "/master/pathways/#{pathway.id}", params: { name: "改名" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("複製")
      expect(pathway.reload.name).to eq("PCI")
    end

    it "承認済でも子は置き換えられない" do
      put "/master/pathways/#{pathway.id}", params: { events: [{ elapsed_days: 1 }] }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(Master::PathwayEvent.count).to eq(0)
    end

    it "承認済でも廃止・有効期間は変えられる" do
      put "/master/pathways/#{pathway.id}", params: { status: "retired", valid_to: "2026-12-31" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(body["status"]).to eq("retired")
      expect(body["valid_to"]).to eq("2026-12-31")
    end
  end

  describe "承認の記録" do
    it "承認したときに承認日をサーバーが入れ、下書きには戻せない" do
      pathway = create_pathway("000001", "PCI", adaptive_criteria: "待機的", scheduled_days: 3)
      create_event("000001", elapsed_days: 1).then do |event|
        Master::PathwayOatUnit.create!(pathway_code: "000001", event_id: event.id, unit_key: UNIT_KEY, name: "x")
      end

      put "/master/pathways/#{pathway.id}", params: { status: "approved", approved_on: "2000-01-01" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(body["approved_on"]).to eq(Date.current.to_s)

      put "/master/pathways/#{pathway.id}", params: { status: "draft" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("承認を取り消せません")
    end
  end

  describe "承認時の検証" do
    it "適応基準・予定日数・病日・OAT ユニットを求める(下書きなら保存できる)" do
      post "/master/pathways", params: { name: "空", status: "draft" }, as: :json
      expect(response).to have_http_status(:created)

      post "/master/pathways", params: { name: "空", status: "approved" }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to include("適応基準がありません", "パス予定日数がありません", "病日がありません")

      post "/master/pathways", params: {
        name: "ユニットなし", status: "approved", adaptive_criteria: "a", scheduled_days: 1,
        events: [{ elapsed_days: 1, title: "入院日", oat_units: [] }, { elapsed_days: 2, oat_units: [{ name: "x" }] }],
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to include("入院日 に OAT ユニットがありません")
      expect(body["errors"].join).to include("パス予定日数(1 日)より後の病日(2 日目)")

      post "/master/pathways", params: {
        name: "雛形が空", status: "approved", adaptive_criteria: "a", scheduled_days: 1,
        events: [{ elapsed_days: 1, oat_units: [{ name: "x", tasks: [{ name: "t", category_lv1: "TP", order_type: "prescription" }] }] }],
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to include("タスク「t」のオーダー雛形が空です")
    end
  end

  describe "フェーズと分岐" do
    PHASE_A = "aaaaaaaa-0000-4000-8000-000000000001".freeze
    PHASE_B = "aaaaaaaa-0000-4000-8000-000000000002".freeze
    PHASE_C = "aaaaaaaa-0000-4000-8000-000000000003".freeze

    def day(phase_key, elapsed_days)
      { phase_key: phase_key, elapsed_days: elapsed_days, oat_units: [{ name: "x" }] }
    end

    def branching_params(**overrides)
      {
        name: "分岐あり", adaptive_criteria: "a", scheduled_days: 4,
        phases: [
          { phase_key: PHASE_A, name: "周術期",
            branches: [{ to_phase_key: PHASE_B, criteria: "発熱なし" }, { to_phase_key: PHASE_C, criteria: "縫合不全の疑い" }] },
          { phase_key: PHASE_B, name: "標準回復", branches: [{ to_phase_key: nil, criteria: "退院基準を満たす" }] },
          { phase_key: PHASE_C, name: "合併症対応" },
        ],
        events: [day(PHASE_A, 1), day(PHASE_A, 2), day(PHASE_B, 3), day(PHASE_B, 4),
                 day(PHASE_C, 3), day(PHASE_C, 4), day(PHASE_C, 5)],
      }.merge(overrides)
    end

    it "フェーズと分岐を入れ子で保存して返し、分岐先どうしは同じ病日を置ける" do
      post "/master/pathways", params: branching_params(status: "approved"), as: :json

      expect(response).to have_http_status(:created)
      expect(body["phases"].map { |p| p["phase_key"] }).to eq([PHASE_A, PHASE_B, PHASE_C])
      expect(body["phases"][0]["branches"].map { |b| [b["to_phase_key"], b["criteria"]] })
        .to eq([[PHASE_B, "発熱なし"], [PHASE_C, "縫合不全の疑い"]])
      expect(body["phases"][1]["branches"][0]["to_phase_key"]).to be_nil
      expect(body["events"].map { |e| [e["phase_key"], e["elapsed_days"]] })
        .to eq([[PHASE_A, 1], [PHASE_A, 2], [PHASE_B, 3], [PHASE_B, 4], [PHASE_C, 3], [PHASE_C, 4], [PHASE_C, 5]])
    end

    it "フェーズを送らなければ既定のフェーズを 1 つ作って病日を結ぶ" do
      post "/master/pathways", params: { name: "PCI", events: event_params }, as: :json

      expect(response).to have_http_status(:created)
      expect(body["phases"].size).to eq(1)
      expect(body["events"].map { |e| e["phase_key"] }.uniq).to eq([body["phases"][0]["phase_key"]])
    end

    it "病日だけ置換してもフェーズは残る" do
      post "/master/pathways", params: branching_params, as: :json
      put "/master/pathways/#{body['id']}", params: { events: [day(PHASE_A, 1)] }, as: :json

      expect(response).to have_http_status(:ok)
      expect(body["phases"].size).to eq(3)
      expect(body["events"].size).to eq(1)
    end

    it "同じフェーズの中で病日が重なれば登録しない" do
      post "/master/pathways", params: branching_params(events: [day(PHASE_A, 1), day(PHASE_A, 1)]), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(Master::Pathway.count).to eq(0)
    end

    it "分岐先や病日のフェーズが無い・分岐先が同じフェーズなら下書きでも保存しない" do
      post "/master/pathways", params: {
        name: "x",
        phases: [{ phase_key: PHASE_A, name: "a", branches: [{ to_phase_key: PHASE_A }, { to_phase_key: PHASE_B }] }],
        events: [day(PHASE_C, 1)],
      }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to include("フェーズ「a」 の分岐先が同じフェーズです", "フェーズ「a」 の分岐先のフェーズがありません",
                                        "病日が結ぶフェーズがありません")
    end

    it "承認では到達できないフェーズ・循環・病日の食い違い・名前なしを弾く" do
      params = branching_params(
        status: "approved",
        phases: [
          { phase_key: PHASE_A, name: "周術期", branches: [{ to_phase_key: PHASE_B }] },
          { phase_key: PHASE_B, name: "", branches: [{ to_phase_key: PHASE_A }] },
          { phase_key: PHASE_C, name: "合併症対応" },
        ],
        events: [day(PHASE_A, 1), day(PHASE_A, 3), day(PHASE_B, 5), day(PHASE_C, 4)],
      )
      post "/master/pathways", params: params, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to include(
        "フェーズ名がありません", "フェーズの分岐が循環しています", "フェーズ「合併症対応」 に進む分岐がありません",
        "フェーズ「周術期」 の病日が連続していません",
      )
      expect(body["errors"].join).to include("病日 4 から始めてください")
    end

    it "予定日数は標準の経路(分岐の先頭)で見る" do
      post "/master/pathways", params: branching_params(status: "approved", scheduled_days: 4), as: :json
      expect(response).to have_http_status(:created)

      post "/master/pathways", params: branching_params(status: "approved", scheduled_days: 3), as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("パス予定日数(3 日)より後の病日(4 日目)")
    end

    it "フェーズが 1 つなら病日が飛んでいても承認できる" do
      post "/master/pathways", params: {
        name: "PCI", status: "approved", adaptive_criteria: "a", scheduled_days: 5,
        events: [{ elapsed_days: 1, oat_units: [{ name: "x" }] }, { elapsed_days: 5, oat_units: [{ name: "x" }] }],
      }, as: :json

      expect(response).to have_http_status(:created)
    end

    it "複製でフェーズ・分岐・病日の結び付きを写し、承認済はフェーズを変えられず、削除で片付く" do
      post "/master/pathways", params: branching_params(status: "approved"), as: :json
      source_id = body["id"]

      put "/master/pathways/#{source_id}", params: { phases: [] }, as: :json
      expect(response).to have_http_status(:unprocessable_content)

      post "/master/pathways/#{source_id}/copy", as: :json
      expect(response).to have_http_status(:created)
      expect(body["phases"].map { |p| p["phase_key"] }).to eq([PHASE_A, PHASE_B, PHASE_C])
      expect(body["phases"][0]["branches"].size).to eq(2)
      expect(body["events"].count { |e| e["phase_key"] == PHASE_C }).to eq(3)

      delete "/master/pathways/#{body['id']}"
      expect(response).to have_http_status(:no_content)
      expect(Master::PathwayPhase.count).to eq(3)
      expect(Master::PathwayPhaseBranch.count).to eq(3)
    end
  end

  describe "POST /master/pathways/:id/copy" do
    it "新しいコードで全部写し、uuid を引き継ぎ、承認は引き継がず下書きになる" do
      create_pathway("000001", "PCI", status: "approved", approved_on: Date.current, approved_by: "p1",
                                     adaptive_criteria: "a", scheduled_days: 3, valid_from: "2026-01-01")
      Master::PathwayIndication.create!(pathway_code: "000001", management_number: "20058911", name: "狭心症")
      event = create_event("000001", elapsed_days: 1, title: "入院日")
      unit = Master::PathwayOatUnit.create!(pathway_code: "000001", event_id: event.id, unit_key: UNIT_KEY, name: "x")
      assessment = Master::PathwayAssessment.create!(pathway_code: "000001", unit_id: unit.id,
                                                     assessment_key: ASSESSMENT_KEY, name: "a")
      Master::PathwayTask.create!(pathway_code: "000001", unit_id: unit.id, assessment_id: assessment.id,
                                  task_key: TASK_KEY, name: "t", category_lv1: "NO")

      post "/master/pathways/000001/copy", params: { name: "PCI 改訂版" }, as: :json

      expect(response).to have_http_status(:created)
      expect(body["pathway_code"]).to eq("000002")
      expect(body["name"]).to eq("PCI 改訂版")
      expect(body["status"]).to eq("draft")
      expect(body["approved_on"]).to be_nil
      expect(body["copied_from_code"]).to eq("000001")
      expect(body["valid_from"]).to be_nil
      expect(body["adaptive_criteria"]).to eq("a")
      expect(body["indications"].size).to eq(1)
      copied_unit = body["events"][0]["oat_units"][0]
      expect(copied_unit["unit_key"]).to eq(UNIT_KEY)
      expect(copied_unit["assessments"][0]["assessment_key"]).to eq(ASSESSMENT_KEY)
      expect(copied_unit["tasks"][0]["task_key"]).to eq(TASK_KEY)
      expect(copied_unit["tasks"][0]["assessment_key"]).to eq(ASSESSMENT_KEY)
      copied_task = Master::PathwayTask.find_by(pathway_code: "000002")
      expect(copied_task.assessment_id).to eq(Master::PathwayAssessment.find_by(pathway_code: "000002").id)
    end
  end

  describe "POST /master/pathways/:id/copy (複数の病日・ユニット)" do
    it "階層ごとに親を付け替えて写し、並びと観察項目の結び付きを保つ" do
      pathway = create_pathway("000001", "PCI")
      second_unit_key = "22222222-3333-4444-8555-666666666666"
      events = event_params
      events[1][:oat_units] << { unit_key: second_unit_key, name: "歩行できる", assessments: [],
                                 tasks: [{ name: "歩行訓練", category_lv1: "AL" }, { name: "転倒予防", category_lv1: "NC" }] }
      put "/master/pathways/#{pathway.id}", params: { indications: [{ management_number: "1", name: "x" },
                                                                    { management_number: "2", name: "y" }],
                                                      events: events }, as: :json
      expect(response).to have_http_status(:ok)
      original = body

      post "/master/pathways/000001/copy", as: :json

      expect(response).to have_http_status(:created)
      strip = lambda do |node|
        case node
        when Hash
          node.except("id", "pathway_code", "event_id", "unit_id", "assessment_id", "created_at", "updated_at",
                      "name", "status", "copied_from_code").transform_values { |v| strip.call(v) }
        when Array then node.map { |v| strip.call(v) }
        else node
        end
      end
      expect(strip.call(body["events"])).to eq(strip.call(original["events"]))
      expect(body["indications"].map { |i| i["management_number"] }).to eq(%w[1 2])
      expect(body["events"][1]["oat_units"].map { |u| u["name"] }).to eq(%w[疼痛がコントロールできる 歩行できる])

      copied_events = Master::PathwayEvent.where(pathway_code: "000002")
      copied_units = Master::PathwayOatUnit.where(pathway_code: "000002")
      expect(copied_units.map(&:event_id).uniq).to match_array(copied_events.map(&:id))
      copied_task = Master::PathwayTask.find_by(pathway_code: "000002", task_key: TASK_KEY)
      expect(copied_task.assessment_id).to eq(Master::PathwayAssessment.find_by(pathway_code: "000002").id)
      expect(Master::PathwayTask.where(pathway_code: "000002").count).to eq(4)
    end
  end

  describe "DELETE /master/pathways/:id" do
    it "子も併せて片付ける" do
      pathway = create_pathway("000001", "PCI")
      put "/master/pathways/#{pathway.id}", params: {
        indications: [{ management_number: "1", name: "x" }], events: event_params,
      }, as: :json
      expect(Master::PathwayTask.count).to eq(2)

      delete "/master/pathways/#{pathway.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::Pathway.count).to eq(0)
      expect(Master::PathwayIndication.count).to eq(0)
      expect(Master::PathwayEvent.count).to eq(0)
      expect(Master::PathwayOatUnit.count).to eq(0)
      expect(Master::PathwayAssessment.count).to eq(0)
      expect(Master::PathwayTask.count).to eq(0)
    end

    it "承認済・廃止は削除できない" do
      pathway = create_pathway("000001", "PCI", status: "approved")

      delete "/master/pathways/#{pathway.id}"

      expect(response).to have_http_status(:unprocessable_content)
      expect(Master::Pathway.count).to eq(1)
    end
  end
end
