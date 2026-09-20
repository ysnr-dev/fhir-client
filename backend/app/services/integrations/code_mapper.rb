module Integrations
  # カルテのコード ↔ 外部システムのコード。
  #
  # 対応表に無いときの扱いは種別ごとに違う。コード体系が同じなら素通しでよく
  # (fallback: :identity)、違うなら送らない・付けないのが正しい。どちらかは
  # アダプタが code_kinds で宣言する。
  class CodeMapper
    def initialize(system_type, kinds)
      @system_type = system_type
      @fallbacks = kinds.to_h { |k| [k[:key].to_s, k[:fallback]] }
    end

    # カルテ → 外部。
    def to_external(kind, local_key)
      return nil if local_key.blank?

      code = ExternalCodeMapping.for_kind(system_type, kind.to_s).where(local_key: local_key).pick(:external_code)
      code || (identity?(kind) ? local_key : nil)
    end

    # 外部 → カルテ。同じ外部コードに複数のカルテ側キーを割り当てる運用は
    # 想定しないので、最初の 1 件を返す。
    def to_local(kind, external_code)
      return nil if external_code.blank?

      local = ExternalCodeMapping.for_kind(system_type, kind.to_s)
                                 .where(external_code: external_code).pick(:local_key)
      local || (identity?(kind) ? external_code : nil)
    end

    private

    attr_reader :system_type, :fallbacks

    def identity?(kind) = fallbacks[kind.to_s] == :identity
  end
end
