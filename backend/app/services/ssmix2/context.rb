module Ssmix2
  # 1 回の組み立てで使う上流のデータ。読み取りは FhirStore で、同じリソースは ResourceCache から返す。
  # 入院(現在の在院)は患者ごとに 1 回だけ検索し、この Context の中だけで持つ。
  class Context
    def initialize(store: Integrations::FhirStore.new, cache: ResourceCache.shared)
      @store = store
      @cache = cache
      @admissions = {}
    end

    # "Patient/123" のような参照か、種別と id で引く。無ければ nil。
    def resource(type, id)
      return nil if type.blank? || id.blank?

      key = "#{type}/#{id}"
      cached = @cache.fetch(key)
      return cached unless cached.nil?

      found = @store.read_or_nil(type, id)
      @cache.put(key, found) if found
      found
    end

    def by_reference(reference)
      type, id = Fhir.split_reference(reference)
      resource(type, id)
    end

    # 書いた内容をそのままキャッシュに置く(読み直しを省き、同じ transaction の他のメッセージも
    # 書いた直後の値を見る)。
    def seed(resource)
      return if resource.nil? || resource["id"].blank? || resource["resourceType"].blank?

      @cache.put(Fhir.reference_of(resource), resource)
    end

    # 検索して資源の配列を返す(件数は控えめに)。
    def search(type, params, limit: 200)
      @store.search(type, params, limit: limit)
    end

    # 消されたリソースの最後の中身(DELETE の transaction が何を消したか)。_history から取る。
    def last_version(type, id)
      entries = @store.search("#{type}/#{id}/_history", {}, limit: 50)
      entries.reverse.find { |r| r["resourceType"] == type }
    end

    # まとめて読んで、キャッシュに置く。参照("Observation/1")の配列を受ける。
    def preload(type, ids)
      missing = ids.compact.uniq.reject { |id| @cache.fetch("#{type}/#{id}") }
      return if missing.empty?

      @store.search(type, { "_id" => missing.join(","), "_count" => [missing.size, 500].min }, limit: missing.size)
            .each { |resource| seed(resource) }
    end

    # 版を指定して読む(Encounter の前の版)。無ければ nil。版は変わらないので、同じ transaction の
    # 複数の builder が同じ前版を読んでも上流には 1 回しか行かない。
    def vread(type, id, version)
      return nil if version.to_i < 1

      key = "#{type}/#{id}/_history/#{version}"
      cached = @cache.fetch(key)
      return cached unless cached.nil?

      found = @store.read_or_nil("#{type}/#{id}/_history", version)
      @cache.put(key, found) if found
      found
    end

    # 患者の現在の入院(in-progress の IMP)。無ければ nil。
    def current_admission(patient_id)
      return nil if patient_id.blank?

      @admissions.fetch(patient_id) do
        found = @store.search("Encounter", { "patient" => "Patient/#{patient_id}", "status" => "in-progress",
                                             "class" => "IMP", "_count" => 1 }, limit: 1).first
        @admissions[patient_id] = found
      end
    end

    # ベッドの Location から病室・病棟を partOf で辿る。
    def location_chain(location_reference)
      chain = { "bd" => nil, "ro" => nil, "wa" => nil }
      current = by_reference(location_reference)
      3.times do
        break if current.nil?

        type = Fhir.physical_type(current) || chain.find { |_, v| v.nil? }&.first
        chain[type] = current if chain.key?(type)
        current = by_reference(current.dig("partOf", "reference"))
      end
      chain
    end

    # 自院の Organization。施設設定の自院、無ければ保険医療機関番号を持つ先頭の 1 件。
    def institution
      return @institution if defined?(@institution)

      self_id = FacilitySettings.self_organization_id
      @institution =
        if self_id
          resource("Organization", self_id)
        else
          @store.search("Organization", { "identifier" => "#{Fhir::INSTITUTION_NO_SYSTEM}|", "_count" => 1 },
                        limit: 1).first
        end
    end
  end
end
