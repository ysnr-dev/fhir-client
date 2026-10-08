module Dpc
  # 診断群分類(14 桁)の判定。DB の FHIR も触らず、Dpc::Tables と Dpc::Input だけで決める。
  #
  #   医療資源病名の ICD-10 → 上 6 桁(MDC6)
  #   → MDC6 の変換テーブルで使っている分岐ごとに値を決める(根拠つき)
  #   → 変換テーブルの行と照合して 14 桁
  #
  # 変換テーブルの「a」と空欄はその分岐を問わない。値の決まらない分岐(未確定)も問わずに照合し、
  # 当たる 14 桁をすべて候補として返す。値がそろえば必ず 1 つに決まる(同じ MDC6 で 2 行に
  # 同時に当たる組は無いことを令和8年度版で確かめた)。
  #
  # 手術・処置等・定義副傷病の優先:
  #   当たる値が複数あれば、ツリー図で下にある値をとる(留意事項通知 第2の1(5))。ツリー図の並びは
  #   手術が 99 → 97 → 値の大きい順 → 01、処置等1・2・定義副傷病が値の小さい順なので、
  #   手術は対応コードが最小(97 は個別の値より後回し)、処置等1・2・定義副傷病は最大をとる。
  #   手術フラグ・処置フラグは定義テーブルの行の番号で、この並びとは一致しない。
  #   定義に無い K コードだけなら 97、無ければ 99。
  class Grouper
    Branch = Struct.new(:key, :label, :value, :auto_value, :status, :options, :evidence, keyword_init: true)
    # status: suggested(候補。人の確定待ち) / accepted(確定) / rejected(除外) / derived(実施記録から導いた)
    Candidate = Struct.new(:code, :name, :status, :basis, :note, keyword_init: true)

    SURGERY_NONE = "99".freeze
    SURGERY_OTHER = "97".freeze
    # 手術あり・なしに数える K コード: 第10部 手術(K000〜K939)。手術等管理料(第13款 K914〜K917)と
    # 輸血管理料(K920-2)だけを除く(留意事項通知 第2の3(8)、疑義解釈 問3-2-4)。輸血は数える。
    SURGERY_CODE = /\AK(\d{3})/
    SURGERY_SECTION_RANGE = (0..939)
    NOT_SURGERY_CODE = /\AK(91[4-7]|920-2)/

    def initialize(tables:, input:)
      @tables = tables
      @input = input
    end

    def call
      mdc6_options = input.overrides.mdc6.present? ? [input.overrides.mdc6] : tables.mdc6_for(input.icd10)
      return empty_result(mdc6_options) if mdc6_options.empty?

      @mdc6 = mdc6_options.first
      @conversions = tables.conversions(mdc6)
      @candidates = build_candidates
      branches = used_keys.map { |key| build_branch(key) }
      matched = match(branches)

      {
        mdc6: mdc6,
        mdc6_options: mdc6_options,
        classification_name: tables.classification_name(mdc6),
        branches: branches.map(&:to_h),
        candidates: candidates.map(&:to_h),
        dpc_codes: matched.map(&:dpc_code).uniq,
        bundled: matched.to_h { |row| [row.dpc_code, row.bundled] },
        warnings: warnings
      }
    end

    private

    attr_reader :tables, :input, :mdc6, :conversions, :candidates

    def empty_result(mdc6_options)
      {
        mdc6: nil, mdc6_options: mdc6_options, classification_name: nil, branches: [], candidates: [],
        dpc_codes: [], bundled: {},
        warnings: [input.icd10.present? ? "医療資源病名の ICD-10 が診断群分類に定義されていません" : "医療資源病名がありません"]
      }
    end

    # 変換テーブルで値を持つ分岐(全行が「a」の分岐も含めて返し、not_applicable にする)。
    def used_keys
      present = conversions.flat_map { |row| row.branch_values.keys }.uniq
      Branches::ALL_KEYS & present
    end

    def build_branch(key)
      values = conversions.filter_map { |row| row.branch_values[key] }.uniq
      concrete = values - [Branches::WILDCARD]
      if concrete.empty?
        return Branch.new(key: key, label: Branches::LABELS[key], value: nil, auto_value: nil,
                          status: "not_applicable", options: [], evidence: [])
      end

      auto_value, evidence = resolve(key, concrete)
      auto_value = nil unless concrete.include?(auto_value)
      override = input.overrides.branches[key].presence
      value = override || auto_value
      status = if override then "override"
               elsif auto_value.nil? then "undetermined"
               else "auto"
               end
      Branch.new(key: key, label: Branches::LABELS[key], value: value, auto_value: auto_value, status: status,
                 options: options_for(key, concrete), evidence: evidence)
    end

    def match(branches)
      decided = branches.select { |branch| branch.value.present? }
      conversions.select do |row|
        decided.all? do |branch|
          cell = row.branch_values[branch.key]
          cell.nil? || cell == Branches::WILDCARD || cell == branch.value
        end
      end
    end

    # --- 分岐ごとの値 ---

    def resolve(key, values)
      case key
      when "pathology" then resolve_pathology
      when "surgery" then resolve_surgery
      when "proc1" then resolve_procedure(1)
      when "proc2" then resolve_procedure(2)
      when "comorbidity" then resolve_comorbidity
      when *Branches::AGE_GROUP_KEYS then resolve_age_group(key)
      else resolve_severity(key, values)
      end
    end

    def resolve_pathology
      rows = conditions("3")
      return [nil, []] if input.age.nil?

      in_age = rows.select { |row| in_range?(row.ranges.first, input.age) }
      needs_category = in_age.any? { |row| row.category.present? }
      return [nil, [form1_evidence("年齢 #{input.age}")]] if needs_category && input.pneumonia_category.nil?

      row = in_age.find { |r| r.category.blank? || r.category == input.pneumonia_category }
      evidence = [form1_evidence("年齢 #{input.age}")]
      evidence << form1_evidence("肺炎 #{row.category_name}") if row&.category.present?
      [row&.code_value, evidence]
    end

    AGE_GROUP_INPUTS = {
      "age" => :age, "month_age" => :month_age, "weight" => :birth_weight, "jcs" => :jcs,
      "burn_index" => :burn_index, "gaf" => :gaf, "pregnancy_weeks" => :pregnancy_weeks,
      "delivery_bleeding" => :delivery_bleeding
    }.freeze

    def resolve_age_group(key)
      kind = Branches::AGE_GROUP_BY_KIND.key(key)
      row = conditions("5").find { |r| r.condition_kind == kind }
      value = input.public_send(AGE_GROUP_INPUTS.fetch(key))
      return [nil, []] if row.nil? || value.nil?

      range = row.ranges.find { |r| in_range?(r, value) }
      [range&.dig("value"), [form1_evidence("#{row.condition_name} #{value}")]]
    end

    SEVERITY_FLAGS = {
      "4" => :bilateral, "5" => :bilateral, "7" => :bilateral, "6" => :reoperation, "8" => :rehab, "13" => :transfer
    }.freeze

    def resolve_severity(key, _values)
      kinds = Branches::SEVERITY_BY_KIND.select { |_, k| k == key }.keys
      rows = %w[10-1 10-2 10-3 10-4].flat_map { |sheet| conditions(sheet) }.select { |r| kinds.include?(r.condition_kind) }
      return [nil, []] if rows.empty?

      case rows.first.sheet
      when "10-1" then severity_range(rows.first, rows.first.condition_kind == "2" ? input.jcs : input.age)
      when "10-2" then severity_option(rows.first)
      when "10-3" then severity_pancreatitis(rows)
      else severity_category(rows)
      end
    end

    def severity_range(row, value)
      return [nil, []] if value.nil?

      range = row.ranges.find { |r| in_range?(r, value) }
      [range&.dig("value"), [form1_evidence("#{row.condition_name} #{value}")]]
    end

    def severity_option(row)
      flag = input.public_send(SEVERITY_FLAGS.fetch(row.condition_kind))
      return [nil, []] if flag.nil?

      option = row.options[flag ? 1 : 0]
      evidence = row.condition_kind == "8" ? rehab_evidence(flag) : [form1_evidence(option&.dig("label"))]
      [option&.dig("value"), evidence]
    end

    def rehab_evidence(flag)
      return [form1_evidence("リハビリなし")] unless flag

      item = input.items.find { |i| i.code.to_s.match?(/\AH0/) }
      item ? [item_evidence(item)] : [{ source: "performed", note: "リハビリの実施記録" }]
    end

    # 急性膵炎: 予後因子 A の範囲で条件区分 9(0〜2)と 10(3〜9)に分かれ、造影 CT の B で値が決まる。
    def severity_pancreatitis(rows)
      a = input.pancreatitis_a
      b = input.pancreatitis_b
      return [nil, []] if a.nil? || b.nil?

      row = rows.find { |r| r.condition_kind == (a <= 2 ? "9" : "10") }
      range = row&.ranges&.find { |r| in_range?(r, b) }
      [range&.dig("value"), [form1_evidence("急性膵炎 予後因子 #{a}・造影CT #{b}")]]
    end

    def severity_category(rows)
      value =
        case rows.first.condition_kind
        when "14" then input.stroke_onset
        when "12" then input.adrop
        when "15" then input.child_pugh
        end
      return [nil, []] if value.nil?

      row = rows.find { |r| r.category == value.to_s }
      [row&.code_value, [form1_evidence("#{rows.first.condition_name} #{row&.category_name || value}")]]
    end

    # 手術: 実施したコードがそろう行のうち、ツリー図で最も下にある対応コード。
    def resolve_surgery
      codes = effective_codes
      rows = tables.surgeries(mdc6).reject { |row| [SURGERY_NONE, SURGERY_OTHER].include?(row.flag) }
      hit = rows.select { |row| row.codes.all? { |code| codes.include?(code) } }
                .min_by { |row| surgery_tree_order(row.code_value) }
      return [hit.code_value, evidence_for(hit.codes)] if hit

      others = surgery_codes(codes)
      return [SURGERY_OTHER, evidence_for(others)] if others.any?

      [SURGERY_NONE, []]
    end

    def surgery_codes(codes)
      codes.select do |code|
        section = code[SURGERY_CODE, 1]
        section && SURGERY_SECTION_RANGE.cover?(section.to_i) && !code.match?(NOT_SURGERY_CODE)
      end
    end

    # ツリー図で下にあるほど小さい。01 が最も下で、97 は個別の値より上。
    def surgery_tree_order(value)
      value == SURGERY_OTHER ? 98 : value.to_i
    end

    # 処置等・定義副傷病の値はツリー図で下にあるほど大きい(0〜9 の後に A〜E)。
    def tree_order(value)
      value.to_s.match?(/\A\d+\z/) ? value.to_i : 100 + value.to_s.ord
    end

    # 処置等1・2: そろう行(処置等1 は手術との組み合わせ条件も)のうち、ツリー図で最も下にある対応コード。
    def resolve_procedure(kind)
      codes = effective_codes
      hit = tables.procedures(mdc6, kind).select do |row|
        row.codes.all? { |code| codes.include?(code) } &&
          (row.surgery_condition.blank? || codes.include?(row.surgery_condition))
      end.max_by { |row| tree_order(row.code_value) }
      return ["0", []] if hit.nil?

      [hit.code_value, evidence_for(hit.codes + [hit.surgery_condition].compact)]
    end

    # 定義副傷病: フラグ 1 は手術の有無を問わず、2 は手術なし、3 は手術ありのときだけ。
    # 当たる病名が複数あれば、ツリー図で最も下にある値。
    def resolve_comorbidity
      surgery, = resolve_surgery
      surgery = input.overrides.branches["surgery"].presence || surgery
      flags = surgery == SURGERY_NONE ? %w[1 2] : %w[1 3]
      rows = tables.comorbidities(mdc6).select { |row| flags.include?(row.flag) }
      icds = input.comorbidity_icd10s.map { |icd| Master::DpcIcdCode.normalize_icd10(icd) }
      hits = icds.filter_map do |icd|
        row = rows.find { |r| r.match_type == "prefix" ? icd.start_with?(r.icd10) : icd == r.icd10 }
        row && [icd, row]
      end
      return ["0", []] if hits.empty?

      [hits.map { |_, row| row.code_value }.max_by { |value| tree_order(value) },
       hits.map { |icd, row| { source: "form1", code: icd, name: row.icd_name, note: "併存症・続発症" } }]
    end

    # --- 実施したコードと候補 ---

    # 判定に使うコード。実施記録・様式1 の手術と、除外されていない候補・導出・人が足したもの。
    def effective_codes
      @effective_codes ||= begin
        rejected = input.overrides.rejected
        performed = input.items.reject(&:medicine?).map(&:code).compact - rejected
        adopted = candidates.reject { |c| c.status == "rejected" }.map(&:code)
        (performed + adopted + input.overrides.accepted).uniq.to_set
      end
    end

    def build_candidates
      rejected = input.overrides.rejected
      accepted = input.overrides.accepted
      names = procedure_code_names
      status = lambda do |code, default|
        if rejected.include?(code) then "rejected"
        elsif accepted.include?(code) then "accepted"
        else default
        end
      end

      drug_names = names.select { |code, name| DummyRules.single_drug?(code, name) }
      list = DrugMatcher.new(names: drug_names, items: input.items).call.map do |candidate|
        Candidate.new(code: candidate.code, name: candidate.name, status: status.call(candidate.code, "suggested"),
                      basis: candidate.matches.map { |m| item_evidence(m.item).merge(note: MATCH_NOTES[m.via]) },
                      note: candidate.note)
      end

      performed = input.items.reject(&:medicine?).map(&:code).compact - rejected
      DummyRules.from_codes(performed, radiotherapy: input.radiotherapy, rehab: input.rehab).each do |code, basis|
        next unless names.key?(code)

        item = input.items.find { |i| i.code == basis }
        list << Candidate.new(code: code, name: names[code], status: status.call(code, "derived"),
                              basis: [item ? item_evidence(item) : { source: "performed", note: basis }])
      end

      chemo_items = input.items.select { |item| DummyRules.antineoplastic?(item) }
      chemo_codes = [DummyRules::CHEMOTHERAPY, DummyRules::CHEMO_ONLY, DummyRules::CHEMO_AND_RADIO]
      if chemo_items.any? && chemo_codes.any? { |code| names.key?(code) }
        list << Candidate.new(code: DummyRules::CHEMOTHERAPY, name: names[DummyRules::CHEMOTHERAPY] || "化学療法",
                              status: status.call(DummyRules::CHEMOTHERAPY, "suggested"),
                              basis: chemo_items.map { |item| item_evidence(item).merge(note: "腫瘍用薬") })
      end

      add_combined(list, names, status)
      list
    end

    MATCH_NOTES = { "generic" => "一般名", "salt" => "塩を除いた一般名", "yj" => "同じ成分(YJ)" }.freeze

    # 化学療法・放射線療法の組(0046〜0048)と、薬剤の組(「A＋Bあり」)。
    def add_combined(list, names, status)
      adopted = ->(code) { list.any? { |c| c.code == code && c.status != "rejected" } || input.overrides.accepted.include?(code) }
      chemo = adopted.call(DummyRules::CHEMOTHERAPY)
      radio = adopted.call(DummyRules::RADIOTHERAPY)
      combo = DummyRules.chemo_radio(chemo: chemo, radio: radio)
      if combo && names.key?(combo)
        pending = list.any? { |c| c.code == DummyRules::CHEMOTHERAPY && c.status == "suggested" }
        list << Candidate.new(code: combo, name: names[combo], status: status.call(combo, pending ? "suggested" : "derived"),
                              basis: [{ source: "derived", note: { "化学療法" => chemo, "放射線療法" => radio }.select { |_, on| on }.keys.join("・") }])
      end

      names.each do |code, name|
        next unless DummyRules.composite?(name)

        parts = DummyRules.components(name)
        part_codes = parts.map { |part| names.find { |c, n| c != code && n.to_s.unicode_normalize(:nfkc) == part }&.first }
        next if part_codes.any?(&:nil?) || !part_codes.all? { |c| adopted.call(c) }

        pending = part_codes.any? { |c| list.find { |x| x.code == c }&.status == "suggested" }
        list << Candidate.new(code: code, name: name, status: status.call(code, pending ? "suggested" : "derived"),
                              basis: [{ source: "derived", note: parts.join("・") }])
      end
    end

    # この MDC6 の処置等1・2 に出てくるコードと名前(ダミーコード一覧の名前を優先)。
    def procedure_code_names
      dummy = tables.dummy_names
      [1, 2].flat_map { |kind| tables.procedures(mdc6, kind) }.each_with_object({}) do |row, hash|
        row.codes.each_with_index { |code, i| hash[code] ||= dummy[code] || row.names[i] }
      end
    end

    # --- 選択肢・根拠 ---

    def options_for(key, values)
      labels =
        case key
        when "surgery" then item_labels(tables.surgeries(mdc6))
        when "proc1" then item_labels(tables.procedures(mdc6, 1))
        when "proc2" then item_labels(tables.procedures(mdc6, 2))
        when "comorbidity" then { "0" => "なし", "1" => "あり" }
        else {}
        end
      labels["0"] ||= "なし" if %w[proc1 proc2].include?(key)
      values.sort_by { |v| [v.to_i, v] }.map { |value| { value: value, label: labels[value] } }
    end

    def item_labels(rows)
      rows.group_by(&:code_value).transform_values do |group|
        names = group.flat_map(&:names).map { |n| n.sub(/（.+\z/, "") }.uniq
        names.size > 3 ? "#{names.first(3).join('、')} 等" : names.join("、")
      end
    end

    def evidence_for(codes)
      codes.filter_map do |code|
        item = input.items.find { |i| i.code == code }
        next item_evidence(item) if item

        candidate = candidates&.find { |c| c.code == code }
        next { source: candidate.status, code: code, name: candidate.name } if candidate

        { source: "override", code: code } if input.overrides.accepted.include?(code)
      end
    end

    def item_evidence(item)
      { source: item.source, ref: item.ref, date: item.date, code: item.medicine&.code || item.code,
        name: item.medicine&.name || item.name }
    end

    def form1_evidence(note)
      { source: "form1", note: note }
    end

    def conditions(sheet)
      tables.conditions(mdc6).select { |row| row.sheet == sheet }
    end

    def in_range?(range, value)
      range && value.to_i >= range["min"].to_i && value.to_i < range["max"].to_i
    end

    def warnings
      list = []
      ffs = tables.fee_for_service_codes
      hit = effective_codes.select { |code| ffs.key?(code) }
      list << "包括の対象外となる手術・検査があります(#{hit.to_a.join('、')})" if hit.any?
      if candidates.any? { |c| c.status == "suggested" }
        list << "手術・処置等の候補に確定していないものがあります"
      end
      list
    end
  end
end
