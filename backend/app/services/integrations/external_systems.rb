module Integrations
  # 管理画面「外部システム連携」に並べる外部システムの定義。設定は
  # external_system_connections の 1 行に入り、画面はこの宣言を見て描く。
  module ExternalSystems
    # 設定ページに出す区画。どれも持たないシステムは fields だけを持つ。
    SECTIONS = %i[connection inbound_token code_mappings].freeze

    class Definition
      attr_reader :key, :label, :description, :sections, :adapters, :fields

      def initialize(key:, label:, description: nil, sections: [], adapters: {}, fields: [])
        @key = key.to_s
        @label = label.to_s
        @description = description
        @sections = sections.map(&:to_sym).freeze
        @adapters = adapters.transform_keys(&:to_s).freeze
        @fields = fields.map { |field| field.symbolize_keys.freeze }.freeze
      end

      def section?(name) = sections.include?(name.to_sym)

      # 製品(アダプタ)の選択肢。API で繋がないシステムは空。
      def system_types = adapters.keys

      def default_system_type = system_types.first.to_s

      def adapter_class(system_type) = adapters[system_type.to_s]&.constantize

      # 製品固有の設定項目。アダプタが宣言し、値は options に入る。
      def option_fields(system_type) = adapter_class(system_type)&.option_fields || []

      def code_kinds(system_type)
        return [] unless section?(:code_mappings)

        adapter_class(system_type)&.code_kinds || []
      end

      def required_field_keys = fields.select { |field| field[:required] }.map { |field| field[:key].to_s }

      def as_json(*)
        {
          key: key,
          label: label,
          description: description,
          sections: sections.map(&:to_s),
          system_types: system_types,
          fields: fields
        }
      end
    end

    DEFINITIONS = [
      Definition.new(
        key: "receipt_computer",
        label: "医事会計",
        description: "患者・保険・受付を取り込み、病名と診療行為(会計)を送る",
        sections: %i[connection inbound_token code_mappings],
        adapters: { "orca" => "Integrations::Orca::Adapter" }
      )
    ].freeze

    INDEX = DEFINITIONS.index_by(&:key).freeze

    module_function

    def all = DEFINITIONS

    def keys = INDEX.keys

    def find(key) = INDEX[key.to_s]

    def find!(key) = find(key) || raise(ActiveRecord::RecordNotFound)
  end
end
