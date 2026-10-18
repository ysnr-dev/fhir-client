module Admin
  # 警告の集計と設定(docs/advisory-design.md §3.3)。種別 × 月の発火数・無視数と無視理由の内訳。
  class AdvisoryStatsController < BaseController
    MAX_MONTHS = 24
    DEFAULT_MONTHS = 6
    # occurred_at は timestamp without time zone(UTC)なので、日本時間に直してから月で切る。
    MONTH = Arel.sql("to_char(occurred_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM')")

    # GET /admin/advisory_stats?from=YYYY-MM&to=YYYY-MM
    #   → { from, to, rows: [{ kind, month, fired, overridden, reasons: { code => n } }] }
    def show
      to_month = parse_month(params[:to]) || FacilityClock.today.beginning_of_month
      from_month = parse_month(params[:from]) || (to_month << (DEFAULT_MONTHS - 1))
      return render json: { error: "from は to 以前の月にしてください" }, status: :bad_request if from_month > to_month
      if months_between(from_month, to_month) > MAX_MONTHS
        return render json: { error: "期間は #{MAX_MONTHS} か月までです" }, status: :bad_request
      end

      range = FacilityClock::ZONE.local(from_month.year, from_month.month, 1)...FacilityClock::ZONE.local(to_month.year, to_month.month, 1).next_month
      scope = AdvisoryEvent.where(occurred_at: range)
      counts = scope.group(:kind, MONTH, :outcome).count
      reasons = scope.where(outcome: "overridden").where.not(reason_code: nil).group(:kind, MONTH, :reason_code).count

      rows = Hash.new { |hash, key| hash[key] = { kind: key[0], month: key[1], fired: 0, overridden: 0, reasons: {} } }
      counts.each { |(kind, month, outcome), count| rows[[kind, month]][outcome.to_sym] = count }
      reasons.each { |(kind, month, code), count| rows[[kind, month]][:reasons][code] = count }

      render json: {
        from: from_month.strftime("%Y-%m"),
        to: to_month.strftime("%Y-%m"),
        rows: rows.values.sort_by { |row| [row[:kind], row[:month]] }
      }
    end

    private

    def parse_month(value)
      return nil unless value.to_s.match?(/\A\d{4}-\d{2}\z/)
      Date.strptime(value.to_s, "%Y-%m")
    rescue ArgumentError
      nil
    end

    def months_between(from, to)
      (to.year - from.year) * 12 + (to.month - from.month) + 1
    end
  end
end
