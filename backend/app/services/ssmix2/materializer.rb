module Ssmix2
  # 控えた transaction を HL7 メッセージに起こし、ssmix2_messages に積む(docs/ssmix2-export-design.md §5.4)。
  # エージェントのポーリングの中で呼ばれる。確保(building)は短い DB トランザクションで行い、
  # 上流を読む組み立てはロックの外で行う。
  class Materializer
    # 1 回に起こす transaction の数。上流の読み取りを帳票・レセコン送信と分け合うので控えめにする。
    DEFAULT_LIMIT = 5

    def initialize(context: Context.new)
      @context = context
    end

    def run(limit: DEFAULT_LIMIT)
      Ssmix2Transaction.release_stale!
      claim(limit).each { |transaction| process(transaction) }
    end

    private

    attr_reader :context

    def claim(limit)
      Ssmix2Transaction.transaction do
        ids = Ssmix2Transaction.pending.order(:occurred_at, :id).limit(limit).lock("FOR UPDATE SKIP LOCKED").pluck(:id)
        Ssmix2Transaction.where(id: ids).update_all(status: "building", leased_at: Time.current)
        Ssmix2Transaction.where(id: ids).order(:occurred_at, :id).to_a
      end
    end

    def process(transaction)
      seed_written(transaction)
      results = Dispatcher.plan(transaction).filter_map do |plan|
        plan.builder.new(context: context, transaction: transaction, written: plan.written).build
      end
      store(transaction, results)
    rescue Integrations::FhirStore::RateLimited
      # 上流の予算を使い切った。失敗にはせず次のポーリングに回す。
      transaction.update!(status: "pending", leased_at: nil)
    rescue StandardError => e
      fail_transaction(transaction, e)
    end

    def seed_written(transaction)
      Dispatcher.written_resources(transaction).each do |written|
        context.seed(written.resource) if written.method != "DELETE"
      end
    end

    def store(transaction, results)
      Ssmix2Message.transaction do
        results.each_with_index do |result, index|
          encoded = Hl7::Charset.encode(result.hl7)
          warnings = result.warnings.dup
          warnings << "変換できない字を「?」にしました: #{encoded.dropped.join(' ')}" if encoded.dropped.any?
          Ssmix2Message.create!(
            ssmix2_transaction: transaction,
            patient_id: patient_id_of(result),
            service_date: result.service_date,
            data_kind: result.data_kind,
            order_no: result.order_no,
            process: result.process,
            department_code: Codes.file_department_code(result.department_code),
            transaction_at: transaction_at(result, index),
            body: encoded.bytes,
            warnings: warnings,
            status: "pending"
          )
        end
        transaction.update!(status: results.empty? ? "skipped" : "done", processed_at: Time.current,
                            leased_at: nil, error: nil)
      end
    end

    # PID-3 から患者 ID を取る(ファイル名とフォルダに使う)。
    def patient_id_of(result)
      pid = result.hl7.split("\r").find { |segment| segment.start_with?("PID|") }
      value = pid.to_s.split("|")[3].to_s.split("^").first.to_s
      raise "患者 ID が決まりません" if value.empty?

      value
    end

    # YYYYMMDDHHMMSSFFF。同じ患者・診療日・種別・オーダ No の中で重ならないよう 1 ms ずつずらす。
    def transaction_at(result, index)
      base = Hl7::Stamp.now + (index * 0.001)
      20.times do |offset|
        candidate = (base + (offset * 0.001)).strftime("%Y%m%d%H%M%S%L")
        return candidate unless Ssmix2Message.exists?(patient_id: patient_id_of(result), service_date: result.service_date,
                                                      data_kind: result.data_kind, order_no: result.order_no,
                                                      transaction_at: candidate)
      end
      (base + 0.02).strftime("%Y%m%d%H%M%S%L")
    end

    def fail_transaction(transaction, error)
      attempts = transaction.attempts + 1
      status = attempts >= Ssmix2Transaction::MAX_ATTEMPTS ? "failed" : "pending"
      transaction.update!(status: status, attempts: attempts, leased_at: nil,
                          error: "#{error.class}: #{error.message}".first(1000),
                          processed_at: status == "failed" ? Time.current : nil)
      Rails.logger.error("[ssmix2] transaction #{transaction.id} の組み立てに失敗しました: #{error.class}: #{error.message}")
    end
  end
end
