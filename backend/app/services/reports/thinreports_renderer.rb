require "stringio"

module Reports
  # QuestionnaireResponse を ThinReports レイアウトへ流し込んで PDF を生成する。
  #
  # レイアウト側のプレースホルダー規約:
  #   - 回答値:      linkId を ItemIdMapper で変換した ID の text-block
  #                  (繰り返し n 回目は "<id>_n")
  #   - シェーマ画像: "<id>_img" の image block("<id>_img_n")
  #   - メタ情報:    pt_* / qr_* の予約 ID(下記 META 参照)
  # レイアウトに存在しないプレースホルダーは黙って捨て、レイアウトにあるが
  # 回答にない項目は空文字にする(text-block のデザイン時初期値を残さない)。
  #
  # 加えて ReportLayout にマッピング定義(Reports::LayoutMapping)があれば、
  # 命名規約に依らない出力先の指定と、choice 回答の code に応じた
  # チェックマーク等(text/ellipse)の表示切替を行う。
  class ThinreportsRenderer
    UNIT_EXT_URL = "http://hl7.org/fhir/StructureDefinition/questionnaire-unit".freeze
    ANNOTATED_IMAGE_EXT_URL =
      "http://fhir-client.local/StructureDefinition/questionnaire-response-annotated-image".freeze
    QR_STATUS_LABELS = {
      "in-progress" => "入力中",
      "completed" => "完了",
      "amended" => "修正済",
      "entered-in-error" => "誤登録",
      "stopped" => "中止"
    }.freeze

    TIME_ZONE = "Asia/Tokyo".freeze

    # layout: ReportLayout、questionnaire/response/patient: パース済み FHIR リソース(Hash)、
    # images: Binary の論理 ID => 画像バイト列
    def initialize(layout:, questionnaire:, response:, patient:, images: {})
      @layout = layout
      @questionnaire = questionnaire
      @response = response
      @patient = patient
      @images = images
    end

    def render
      link_ids = collect_link_ids(@questionnaire["item"])
      mapper = ItemIdMapper.new(link_ids)
      formatter = AnswerFormatter.new(collect_units(@questionnaire["item"]))
      mapping = @layout.parsed_mapping

      text_ids, image_ids, all_ids = layout_item_ids

      values = preset_blank_values(text_ids, link_ids.map { |id| mapper.tlf_id(id) })
      # マッピングの値出力先も、未回答ならデザイン時初期値を残さず空文字にする。
      mapping&.value_target_ids&.each { |id| values[id] = "" if text_ids.include?(id) }
      image_values = {}
      shown_ids = Set.new

      occurrences = Hash.new(0)
      walk(@response["item"]) do |item|
        link_id = item["linkId"]
        occurrence = (occurrences[link_id] += 1)

        answers = item["answer"]
        if answers.present?
          tlf_id = mapper.tlf_id(link_id, occurrence)
          values[tlf_id] = formatter.format(link_id, answers) if text_ids.include?(tlf_id)

          if mapping
            mapping.value_targets(link_id).each do |id|
              values[id] = formatter.format(link_id, answers) if text_ids.include?(id)
            end
            shown_ids.merge(mapping.triggered_show_ids(link_id, answers))
          end
        end

        if (binary_id = annotation_binary_id(item)) && @images[binary_id]
          image_id = mapper.image_id(link_id, occurrence)
          image_values[image_id] = @images[binary_id] if image_ids.include?(image_id)

          mapping&.value_targets(link_id)&.each do |id|
            image_values[id] = @images[binary_id] if image_ids.include?(id)
          end
        end
      end

      # 予約プレースホルダーは最後に設定する(linkId 由来の値より優先)。
      meta_values.each do |id, value|
        values[id] = value if text_ids.include?(id)
        mapping&.meta_targets(id)&.each { |alias_id| values[alias_id] = value if text_ids.include?(alias_id) }
      end

      # show ルールの対象は、条件を満たしたら表示・満たさなければ非表示で確定させる
      # (レイアウトの display 設定に依らず、回答だけで出力が決まるようにする)。
      toggle_ids = mapping ? mapping.show_target_ids & all_ids : Set.new

      @layout.with_tlf_file do |path|
        report = Thinreports::Report.new(layout: path)
        report.start_new_page do |page|
          values.each { |id, value| page.item(id).value(value) }
          image_values.each { |id, bytes| page.item(id).src(StringIO.new(bytes)) }
          toggle_ids.each { |id| shown_ids.include?(id) ? page.item(id).show : page.item(id).hide }
        end
        report.generate
      end
    end

    private

    # レイアウト内のアイテム ID を種類別に列挙する(v1 はトップレベルのみ、list 非対応)。
    # 未知の ID へ page.item すると例外になるため、設定対象を積集合に絞るのに使う。
    # 3 つ目の戻り値は ID を持つ全アイテム(text/ellipse 等を含む。表示切替の対象確認用)。
    def layout_item_ids
      items = JSON.parse(@layout.tlf).fetch("items", [])
      text_ids = Set.new
      image_ids = Set.new
      all_ids = Set.new
      items.each do |item|
        id = item["id"].to_s
        next if id.empty?

        all_ids << id
        case item["type"]
        when "text-block" then text_ids << id
        when "image-block" then image_ids << id
        end
      end
      [text_ids, image_ids, all_ids]
    end

    # レイアウトにあるが回答にない項目を空文字で埋める。対象は linkId 由来の ID
    # (繰り返しの "_n" 変形を含む)のみで、レイアウト独自の text-block は触らない。
    def preset_blank_values(text_ids, base_ids)
      bases = base_ids.to_set
      text_ids.each_with_object({}) do |id, values|
        base = id.sub(/_\d+\z/, "")
        values[id] = "" if bases.include?(id) || bases.include?(base)
      end
    end

    def collect_link_ids(items, acc = [])
      Array(items).each do |item|
        acc << item["linkId"]
        collect_link_ids(item["item"], acc)
      end
      acc
    end

    def collect_units(items, acc = {})
      Array(items).each do |item|
        unit = Array(item["extension"]).find { |ext| ext["url"] == UNIT_EXT_URL }&.dig("valueCoding")
        acc[item["linkId"]] = unit["display"] || unit["code"] || "" if unit
        collect_units(item["item"], acc)
      end
      acc
    end

    def walk(items, &block)
      Array(items).each do |item|
        yield item
        walk(item["item"], &block)
      end
    end

    def annotation_binary_id(item)
      attachment = Array(item["extension"])
        .find { |ext| ext["url"] == ANNOTATED_IMAGE_EXT_URL }
        &.dig("valueAttachment")
      attachment&.dig("url")&.match(%r{\ABinary/(.+)\z})&.captures&.first
    end

    # ---- 予約プレースホルダー ----

    def meta_values
      {
        "pt_name" => PatientMeta.display_name(@patient),
        "pt_kana" => PatientMeta.display_kana(@patient),
        "pt_id" => PatientMeta.identifier(@patient),
        "pt_birthdate" => PatientMeta.format_date(@patient["birthDate"]),
        "pt_age" => patient_age.to_s,
        "pt_gender" => PatientMeta.gender_label(@patient),
        "qr_title" => @questionnaire["title"] || @questionnaire["name"] || "",
        "qr_status" => QR_STATUS_LABELS.fetch(@response["status"].to_s, @response["status"].to_s),
        "qr_authored" => format_date_time(@response["authored"]),
        "qr_author" => contained_practitioner_name,
        "qr_institution" => @response.dig("identifier", "value").to_s.split("^").first.to_s,
        "qr_id" => @response["id"].to_s
      }
    end

    # authored 時点(JST)での満年齢。
    def patient_age
      birth_date = @patient["birthDate"]
      return "" if birth_date.blank?

      birth = Date.parse(birth_date)
      as_of = @response["authored"].present? ? time_zone.parse(@response["authored"]).to_date : Date.current
      age = as_of.year - birth.year
      age -= 1 if as_of.month < birth.month || (as_of.month == birth.month && as_of.day < birth.day)
      age.negative? ? "" : age
    rescue ArgumentError
      ""
    end

    def contained_practitioner_name
      practitioner = Array(@response["contained"]).find { |r| r["resourceType"] == "Practitioner" }
      practitioner&.dig("name", 0, "text").to_s
    end

    def format_date_time(value)
      return "" if value.blank?

      time_zone.parse(value).strftime("%Y/%m/%d %H:%M")
    rescue ArgumentError
      value.to_s
    end

    def time_zone
      Time.find_zone!(TIME_ZONE)
    end
  end
end
