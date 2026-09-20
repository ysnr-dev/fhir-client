namespace :integrations do
  namespace :receipt do
    # 通知を取りこぼしても、これを流せば必ず追いつく。
    # PUSH 通知は未接続中のぶんが再配達されないので、整合性はこちら側で担保する。
    #
    #   bin/rails integrations:receipt:resync                 # 取り込み済みの患者を洗い直す
    #   bin/rails integrations:receipt:resync[00002]          # 患者番号を指定
    #   DRY_RUN=true bin/rails integrations:receipt:resync    # 件数を数えるだけ
    desc "レセコンから患者・保険を取り直す"
    task :resync, [:patient_number] => :environment do |_t, args|
      dry_run = ENV["DRY_RUN"] == "true"
      limit = ENV.fetch("LIMIT", "500").to_i
      # 上流は 1 トークン 300 件/分。1 患者で数リクエスト使うので間隔を空ける。
      interval = ENV.fetch("INTERVAL", "0.3").to_f

      numbers = args[:patient_number].present? ? [args[:patient_number]] : target_numbers(limit)
      handler = Integrations::ReceiptComputer::EventHandler.new
      counts = Hash.new(0)

      numbers.each do |number|
        if dry_run
          counts[:planned] += 1
          next
        end

        begin
          handler.import_patient(number)
          counts[:imported] += 1
        rescue Integrations::ReceiptComputer::NotFound
          # レセコンから消えた患者。カルテ側の記録は残す。
          counts[:missing] += 1
        rescue StandardError => e
          counts[:failed] += 1
          warn "[resync] #{number}: #{e.class} #{e.message}"
        end
        sleep interval
      end

      puts({ total: numbers.length, **counts }.to_json)
    end

    # カルテに居る患者の番号。レセコンには「全患者一覧」の API が無いので、
    # 既に取り込んだ患者を洗い直す形にする。新規患者は通知で入ってくる。
    def target_numbers(limit)
      Integrations::FhirStore.new
                             .search("Patient", { "_count" => "500" }, limit: limit)
                             .filter_map { |p| Integrations::ReceiptComputer::PatientResource.number_of(p) }
                             .uniq
    end
  end
end
