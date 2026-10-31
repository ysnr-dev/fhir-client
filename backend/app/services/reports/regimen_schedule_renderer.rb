module Reports
  # 患者向けの化学療法スケジュール表を lib/report_layouts/regimen_schedule.tlf へ流し込む
  # (docs/report-mappings/regimen-01.md)。1 ページ = 1 か月の暦で、登録済みのクールの
  # 最初の Day 1 からクールの最終日までを刷る。
  #
  # マスに書くのは「C2 Day1」と、その日にすること(「点滴: 前投薬、オキサリプラチン」
  # 「内服: カペシタビン」)、休薬期間なら「休薬」。薬剤名ではなくステップ名を出すのは、
  # 暦と同じく規格まで入った医薬品名がマスの幅で読めないため(chemo-regimen-design §7.5)。
  # 内服は処方日から投与日数ぶんの日に出す。中止した日オーダーは呼び出し側で除いてある。
  class RegimenScheduleRenderer
    WEEKS = 6
    # マスの本文の桁数(半角換算)と行数。7.5pt の IPAGothic でマスの幅(69pt)・高さ(70pt)に入る量。
    CELL_MAX_COLS = 18
    CELL_MAX_LINES = 7

    def initialize(layout_path:, application:, patient:, organization:, orders:, cycle_starts:, printed_on:)
      @layout_path = layout_path
      @application = application
      @patient = patient
      @organization = organization
      @orders = orders
      @cycle_starts = cycle_starts
      @printed_on = printed_on
    end

    def render
      text_ids, = ReportText.layout_item_ids(@layout_path)
      months = month_range
      report = Thinreports::Report.new(layout: @layout_path.to_s)
      months.each_with_index do |month, index|
        report.start_new_page do |page|
          values = page_values.merge(
            "month_label" => "#{month.year}年#{month.month}月",
            "page_no" => "#{index + 1} / #{months.size}"
          ).merge(cell_values(month))
          values.each { |id, value| page.item(id).value(value) if text_ids.include?(id) }
        end
      end
      report.generate
    end

    private

    def first_day
      @cycle_starts.values.min
    end

    # 最後のクールの最終日。1 クールの日数が分からなければ最後の投与日(内服は投与日数の終わり)。
    def last_day
      ends = activity.keys
      last_cycle = @cycle_starts.keys.max
      if @application.cycle_days.positive?
        ends << @cycle_starts[last_cycle] + (@application.cycle_days - 1)
      end
      ends.max
    end

    def month_range
      months = []
      month = first_day.beginning_of_month
      while month <= last_day
        months << month
        month = month.next_month
      end
      months
    end

    def cell_values(month)
      start = month - month.wday
      values = {}
      WEEKS.times do |row|
        7.times do |col|
          date = start + (row * 7) + col
          in_month = date.month == month.month
          values["d#{row}#{col}"] = in_month ? date.day.to_s : ""
          values["c#{row}#{col}"] = in_month ? cell_text(date) : ""
        end
      end
      values
    end

    def cell_text(date)
      position = cycle_position(date)
      lines = []
      lines << "C#{position[0]} Day#{position[1]}" if position && (activity[date] || position[1] == 1)
      Array(activity[date]).each { |item| lines.concat(wrap(item)) }
      lines << "休薬" if position && activity[date].nil? && resting?(position[1])
      lines.first(CELL_MAX_LINES).join("\n")
    end

    # その日がどのクールの何日目か。登録済みのクールの範囲だけを見る(frontend の cyclePositionOf と同じ)。
    def cycle_position(date)
      return nil unless @application.cycle_days.positive?

      @cycle_starts.each do |cycle, start|
        offset = (date - start).to_i
        return [cycle, offset + 1] if offset >= 0 && offset < @application.cycle_days
      end
      nil
    end

    def resting?(day)
      @application.treatment_days.positive? && day > @application.treatment_days
    end

    # 日付 → その日にすること。注射は投与日だけ、内服は投与日数ぶん続ける。
    def activity
      @activity ||= begin
        result = Hash.new { |h, k| h[k] = [] }
        @orders.each do |order|
          date = Date.parse(order.date)
          if order.kind == :injection
            names = order.steps.map { |s| step_label(s) }.uniq
            result[date] << "点滴: #{names.join('、')}" if names.any?
          else
            order.steps.each do |step|
              days = [step.supply_days.to_i, 1].max
              days.times { |i| result[date + i] << "内服: #{step_label(step)}" }
            end
          end
        end
        result.transform_values(&:uniq).to_h
      end
    end

    # マスは狭く、ReportText.wrap の字下げ(全角 1 字)で語の途中に空白が入ると読みにくいので、字下げせずに折り返す。
    def wrap(text)
      text.each_char.each_with_object([+""]) do |char, chunks|
        width = char.ascii_only? ? 1 : 2
        chunks << +"" if chunk_cols(chunks.last) + width > CELL_MAX_COLS
        chunks.last << char
      end
    end

    def chunk_cols(chunk)
      chunk.each_char.sum { |char| char.ascii_only? ? 1 : 2 }
    end

    def step_label(step)
      step.name.presence || step.drugs.first&.name.to_s
    end

    def page_values
      org = @organization || {}
      phone = Array(org["telecom"]).find { |t| t["system"] == "phone" }&.dig("value")
      {
        "pt_name" => "#{PatientMeta.display_name(@patient)} 様",
        "printed_on" => "発行 #{@printed_on.strftime('%Y/%m/%d')}",
        "regimen_line" => "治療: #{@application.name}",
        "contact" => [org["name"].to_s, phone.present? ? "TEL #{phone}" : nil].compact_blank.join("　")
      }
    end
  end
end
